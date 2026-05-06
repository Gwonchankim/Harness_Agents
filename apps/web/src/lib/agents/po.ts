// PO Agent — wraps runtime.generateObject with the Phase 2 timeout, prompt
// builders, and Zod schemas. Routes call this module; this module never
// imports @ai-sdk/* directly.

import { generateObject } from '@lib/agents/runtime';
import {
  getEnabledModelOrThrow,
  getProviderAvailability,
  invalidateProviderAvailability,
  resolveProviderName,
  UnknownProviderError,
} from '@lib/models/catalog';
import { redactString } from '@lib/secrets/redactor';

import type { PoQuestionOption } from '@lib/qa/skipPolicy';
import {
  GenerateAbortedError,
  GenerateTimeoutError,
  runWithGenerateTimeout,
} from '@lib/qa/timeout';
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

  const payload = await callGenerate<NextQuestionPayload>({
    provider,
    modelId: ctx.modelId,
    schema: nextQuestionSchema,
    messages,
    signal: ctx.signal,
  });

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
  return callGenerate<JudgePayload>({
    provider,
    modelId: ctx.modelId,
    schema: judgeSchema,
    messages,
    signal: ctx.signal,
  });
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

async function resolveAndCheckProvider(modelId: string) {
  const row = await getEnabledModelOrThrow(modelId);
  const provider = resolveProviderName(row.provider);
  if (!provider) throw new UnknownProviderError(row.provider);
  const availability = await getProviderAvailability(provider);
  if (!availability.available) {
    throw new ProviderUnavailableError(provider, availability.reason);
  }
  return { provider, modelId: row.modelId };
}

interface CallGenerateArgs<T> {
  provider: 'openai' | 'anthropic' | 'ollama';
  modelId: string;
  schema: import('zod').ZodType<T>;
  messages: ReturnType<typeof buildNextQuestionMessages>;
  signal?: AbortSignal;
}

async function callGenerate<T>(args: CallGenerateArgs<T>): Promise<T> {
  try {
    const result = await runWithGenerateTimeout(args.signal, async (signal) => {
      return generateObject<T>({
        provider: args.provider,
        modelId: args.modelId,
        schema: args.schema,
        messages: args.messages,
        temperature: 0.4,
        maxTokens: 1024,
        signal,
      });
    });
    return (result as { object: T }).object;
  } catch (err) {
    if (err instanceof GenerateAbortedError || err instanceof GenerateTimeoutError) {
      throw err;
    }
    const status = extractAuthStatus(err);
    if (status != null) {
      invalidateProviderAvailability(args.provider);
      throw new PoAuthError(args.provider, status);
    }
    if (looksLikeSchemaError(err)) {
      throw new PoSchemaError(err);
    }
    invalidateProviderAvailability(args.provider);
    throw new ProviderUnavailableError(
      args.provider,
      err instanceof Error ? redactString(err.message).slice(0, 240) : String(err),
    );
  }
}

function extractAuthStatus(err: unknown): number | null {
  const candidate =
    err && typeof err === 'object'
      ? ((err as { statusCode?: unknown; status?: unknown }).statusCode ??
        (err as { status?: unknown }).status)
      : undefined;
  if (typeof candidate === 'number' && (candidate === 401 || candidate === 403)) {
    return candidate;
  }
  if (err instanceof Error) {
    if (/\b401\b|unauthorized/i.test(err.message)) return 401;
    if (/\b403\b|forbidden/i.test(err.message)) return 403;
  }
  return null;
}

function looksLikeSchemaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'AI_NoObjectGeneratedError' ||
    err.name === 'NoObjectGeneratedError' ||
    /no object generated|invalid object|zod/i.test(err.message)
  );
}
