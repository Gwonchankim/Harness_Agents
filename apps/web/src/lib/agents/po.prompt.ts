// PO agent prompt builders and Zod schemas. The schemas describe ONLY what the
// model should return (positions 1..4 + isFinal). The server injects positions
// 5 (auto-judge) and 6 (custom) before persistence so the model can't
// hallucinate them.

import { z } from 'zod';

const choiceSchema = z.object({
  label: z.string().min(1).max(160),
  value: z.string().min(1).max(400),
});

export const nextQuestionSchema = z.object({
  prompt: z.string().min(1).max(400),
  kind: z.enum(['single', 'multi', 'free']),
  choices: z.array(choiceSchema).length(4),
  isFinal: z.boolean(),
});

export type NextQuestionPayload = z.infer<typeof nextQuestionSchema>;

export const judgeSchema = z.object({
  choiceIndex: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  rationale: z.string().min(1).max(240),
});

export type JudgePayload = z.infer<typeof judgeSchema>;

export interface PoPromptInput {
  userPrompt: string;
  historyLines: string[];
  questionNumber: number;
  minQuestions: number;
  maxQuestions: number;
  /** When regenerating a stale question, the prior question is included so the
   *  PO can avoid asking the same thing in a different order. */
  regeneratingOrder?: number;
}

const SYSTEM_NEXT_QUESTION = `You are the Product-Owner Agent for the Harness Agents app.
Your job is to drive a 5-to-6 question clarification flow over the user's request.
Each question must:
- be focused, single-thought, and answerable without prose,
- propose exactly 4 substantive choices (positions 1..4),
- avoid yes/no when a graded choice is more useful,
- never ask for proper nouns the user has not mentioned,
- mark isFinal=true only when no further information would change the team design.
DO NOT include positions 5 or 6 in your output — the server adds those.
Reply ONLY in the structured schema you are given.`;

const SYSTEM_JUDGE = `You are the Product-Owner Agent's auto-judge.
You must choose ONE of the four substantive choices that is most consistent with
the user's original prompt and prior answers. Provide a short rationale (<=240 chars)
that the user could read at a glance.`;

export function buildNextQuestionMessages(input: PoPromptInput) {
  const finalGate =
    input.questionNumber >= input.minQuestions
      ? `You may set isFinal=true if you have enough information.`
      : `Set isFinal=false (we have not reached the minimum of ${input.minQuestions} questions yet).`;

  const lines = [
    `User prompt: ${input.userPrompt}`,
    '',
    `Questions answered so far: ${input.historyLines.length / 2}`,
    ...(input.historyLines.length ? input.historyLines : ['(none yet)']),
    '',
    `You are generating question ${input.questionNumber} of at most ${input.maxQuestions}.`,
    finalGate,
  ];
  if (input.regeneratingOrder != null) {
    lines.push(
      '',
      `NOTE: This is a regeneration of question ${input.regeneratingOrder} after an upstream answer change. Ask a fresh, useful question that fits the new context.`,
    );
  }

  return [
    { role: 'system' as const, content: SYSTEM_NEXT_QUESTION },
    { role: 'user' as const, content: lines.join('\n') },
  ];
}

export interface JudgePromptInput {
  userPrompt: string;
  historyLines: string[];
  question: {
    prompt: string;
    choices: Array<{ label: string; value: unknown }>;
  };
}

export function buildJudgeMessages(input: JudgePromptInput) {
  const choices = input.question.choices
    .map((c, i) => `  ${i + 1}. ${c.label} -> ${JSON.stringify(c.value)}`)
    .join('\n');
  const lines = [
    `User prompt: ${input.userPrompt}`,
    '',
    'Prior answers:',
    ...(input.historyLines.length ? input.historyLines : ['(none yet)']),
    '',
    `Current question: ${input.question.prompt}`,
    'Choices:',
    choices,
  ];
  return [
    { role: 'system' as const, content: SYSTEM_JUDGE },
    { role: 'user' as const, content: lines.join('\n') },
  ];
}
