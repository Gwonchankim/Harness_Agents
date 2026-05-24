// PO Agent — wraps runtime.generateObject with the Phase 2 timeout, prompt
// builders, and Zod schemas. Routes call this module; this module never
// imports @ai-sdk/* directly.

import { generateObject } from '@lib/agents/runtime';
import {
  getEnabledModelOrThrow,
  invalidateProviderAvailability,
  resolveProviderName,
  UnknownProviderError,
} from '@lib/models/catalog';
import { redactString } from '@lib/secrets/redactor';

import type { PoQuestionOption } from '@lib/qa/skipPolicy';
import {
  GenerateTimeoutError,
  resolvePoGenerateTimeoutMs,
  runWithGenerateTimeout,
} from '@lib/qa/timeout';
import { classifyGenerateError } from './providerError';
import {
  buildJudgeMessages,
  buildNextQuestionMessages,
  judgeSchema,
  nextQuestionSchema,
  type JudgePayload,
  type NextQuestionPayload,
} from './po.prompt';

export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    public readonly reason?: string,
  ) {
    super(`provider_unavailable: ${provider}${reason ? ` (${reason})` : ''}`);
    this.name = 'ProviderUnavailableError';
  }
}

export class PoSchemaError extends Error {
  public readonly schemaCause: unknown;
  constructor(schemaCause: unknown) {
    super('po_schema_error: PO model returned a malformed structured response');
    this.name = 'PoSchemaError';
    this.schemaCause = schemaCause;
  }
}

export class PoAuthError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
  ) {
    super(`po_auth_error: provider ${provider} rejected the credentials (${status})`);
    this.name = 'PoAuthError';
  }
}

export class RateLimitError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status?: number,
  ) {
    super(`rate_limit: provider ${provider} is rate limiting${status ? ` (${status})` : ''}`);
    this.name = 'RateLimitError';
  }
}

export class ModelNotFoundError extends Error {
  constructor(
    public readonly provider: string,
    public readonly modelId: string,
  ) {
    super(`model_not_found: provider ${provider} does not recognize model ${modelId}`);
    this.name = 'ModelNotFoundError';
  }
}

export interface PoCtx {
  modelId: string;
  userPrompt: string;
  historyLines: string[];
  signal?: AbortSignal;
}

export interface PoQuestionResult {
  prompt: string;
  kind: string;
  /** Six entries: 4 generated + auto-judge + custom. */
  options: PoQuestionOption[];
  isFinal: boolean;
}

const AUTO_JUDGE_OPTION: PoQuestionOption = { kind: 'auto_judge', label: 'AI auto-judge' };
const CUSTOM_OPTION: PoQuestionOption = { kind: 'custom', label: 'Custom answer' };

/**
 * Generate the next question. The questionNumber comes from the route based on
 * existing rows; `regeneratingOrder` should be set when this call replaces the
 * content of an existing stale question.
 */
export async function generateNextQuestion(
  ctx: PoCtx,
  questionNumber: number,
  options: { regeneratingOrder?: number; minQuestions: number; maxQuestions: number },
): Promise<PoQuestionResult> {
  const { provider } = await resolveAndCheckProvider(ctx.modelId);
  const messages = buildNextQuestionMessages({
    userPrompt: ctx.userPrompt,
    historyLines: ctx.historyLines,
    questionNumber,
    minQuestions: options.minQuestions,
    maxQuestions: options.maxQuestions,
    regeneratingOrder: options.regeneratingOrder,
  });

  let payload: NextQuestionPayload;
  try {
    payload = await callGenerate<NextQuestionPayload>({
      provider,
      modelId: ctx.modelId,
      schema: nextQuestionSchema,
      messages,
      signal: ctx.signal,
    });
  } catch (err) {
    if (!(err instanceof PoSchemaError)) throw err;
    payload = await callGenerate<NextQuestionPayload>({
      provider,
      modelId: ctx.modelId,
      schema: nextQuestionSchema,
      messages: buildNextQuestionMessages({
        userPrompt: ctx.userPrompt,
        historyLines: ctx.historyLines,
        questionNumber,
        minQuestions: options.minQuestions,
        maxQuestions: options.maxQuestions,
        regeneratingOrder: options.regeneratingOrder,
        strict: true,
      }),
      signal: ctx.signal,
    });
  }

  const choiceOptions: PoQuestionOption[] = payload.choices.map((c) => ({
    kind: 'choice',
    label: c.label,
    value: c.value,
  }));

  return {
    prompt: payload.prompt,
    kind: payload.kind,
    options: [...choiceOptions, AUTO_JUDGE_OPTION, CUSTOM_OPTION],
    isFinal: payload.isFinal,
  };
}

/**
 * Run the auto-judge on a current question. Returns the chosen 1..4 + rationale.
 * Caller is responsible for persisting the resolved value into QaAnswer.
 */
export async function judgeAnswer(
  ctx: PoCtx,
  question: { prompt: string; options: readonly PoQuestionOption[] },
): Promise<JudgePayload> {
  const { provider } = await resolveAndCheckProvider(ctx.modelId);
  const choices = question.options
    .filter((o) => o.kind === 'choice')
    .map((o) => ({ label: o.label, value: o.value as unknown }));
  if (choices.length !== 4) {
    throw new PoSchemaError(
      new Error(`question must have exactly 4 substantive choices, got ${choices.length}`),
    );
  }
  const messages = buildJudgeMessages({
    userPrompt: ctx.userPrompt,
    historyLines: ctx.historyLines,
    question: { prompt: question.prompt, choices },
  });
  try {
    return await callGenerate<JudgePayload>({
      provider,
      modelId: ctx.modelId,
      schema: judgeSchema,
      messages,
      signal: ctx.signal,
    });
  } catch (err) {
    if (!(err instanceof PoSchemaError)) throw err;
    return callGenerate<JudgePayload>({
      provider,
      modelId: ctx.modelId,
      schema: judgeSchema,
      messages: buildJudgeMessages({
        userPrompt: ctx.userPrompt,
        historyLines: ctx.historyLines,
        question: { prompt: question.prompt, choices },
        strict: true,
      }),
      signal: ctx.signal,
    });
  }
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

async function resolveAndCheckProvider(modelId: string) {
  const row = await getEnabledModelOrThrow(modelId);
  const provider = resolveProviderName(row.provider);
  if (!provider) throw new UnknownProviderError(row.provider);
  return { provider, modelId: row.modelId };
}

interface CallGenerateArgs<T> {
  provider: 'openai' | 'anthropic' | 'google' | 'ollama';
  modelId: string;
  schema: import('zod').ZodType<T>;
  messages: ReturnType<typeof buildNextQuestionMessages>;
  signal?: AbortSignal;
}

async function callGenerate<T>(args: CallGenerateArgs<T>): Promise<T> {
  const timeoutMs = resolvePoGenerateTimeoutMs(args.provider);
  try {
    const result = await runWithGenerateTimeout(
      args.signal,
      async (signal) => {
        return generateObject<T>({
          provider: args.provider,
          modelId: args.modelId,
          schema: args.schema,
          messages: args.messages,
          temperature: 0.4,
          maxTokens: 1024,
          signal,
        });
      },
      timeoutMs,
    );
    return (result as { object: T }).object;
  } catch (err) {
    raiseProviderError(err, { provider: args.provider, modelId: args.modelId });
  }
}

/**
 * Map a raw generate/stream error to the right typed error and throw it. Single
 * source of truth shared by po / lead / team / leadRevise / worker. Mirrors the
 * pre-Phase-7 catch chain (auth + provider_unavailable invalidate the provider
 * availability cache; schema does not) and adds rate_limit + model_not_found.
 */
export function raiseProviderError(
  err: unknown,
  ctx: { provider: string; modelId: string },
): never {
  const c = classifyGenerateError(err);
  switch (c.kind) {
    case 'abort':
      throw err;
    case 'timeout':
      throw new GenerateTimeoutError((err as GenerateTimeoutError).timeoutMs, {
        provider: ctx.provider,
        modelId: ctx.modelId,
      });
    case 'auth':
      invalidateProviderAvailability(ctx.provider);
      throw new PoAuthError(ctx.provider, c.status ?? 401);
    case 'rate_limit':
      throw new RateLimitError(ctx.provider, c.status);
    case 'model_not_found':
      throw new ModelNotFoundError(ctx.provider, ctx.modelId);
    case 'schema':
      throw new PoSchemaError(err);
    case 'provider_unavailable':
    default:
      invalidateProviderAvailability(ctx.provider);
      throw new ProviderUnavailableError(
        ctx.provider,
        err instanceof Error ? redactString(err.message).slice(0, 240) : String(err),
      );
  }
}
