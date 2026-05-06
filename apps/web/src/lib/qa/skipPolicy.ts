// Single source of truth for the option-1..6 semantics defined in PLAN.md §10.
//
// Layout:
//   1..4 — model-generated substantive choices.
//   5    — AI auto-judge (server picks one of 1..4 with rationale).
//   6    — custom user input (free-form text).
//
// Skip ⇒ auto-judge (option 5).

export type ChoiceIndex = 1 | 2 | 3 | 4 | 5 | 6;

export interface NormalizedAnswerInput {
  choiceIndex: ChoiceIndex;
  customText?: string;
}

export interface RawAnswerInput {
  choiceIndex?: number;
  customText?: string;
  skip?: boolean;
}

export class InvalidAnswerInputError extends Error {
  constructor(public readonly reason: string) {
    super(`invalid_answer_input: ${reason}`);
    this.name = 'InvalidAnswerInputError';
  }
}

/**
 * Normalize raw client input into a canonical {choiceIndex, customText?} pair.
 * - skip:true       ⇒ choiceIndex 5 (auto-judge)
 * - choiceIndex 1-6 ⇒ passthrough, with customText required for 6
 * - anything else   ⇒ throws InvalidAnswerInputError
 */
export function coerceSkipToAutoJudge(raw: RawAnswerInput): NormalizedAnswerInput {
  if (raw.skip) {
    return { choiceIndex: 5 };
  }
  const idx = raw.choiceIndex;
  if (idx == null || !Number.isInteger(idx) || idx < 1 || idx > 6) {
    throw new InvalidAnswerInputError(`choiceIndex must be 1..6 (got ${idx ?? 'undefined'})`);
  }
  if (idx === 6) {
    const text = (raw.customText ?? '').trim();
    if (text.length === 0) {
      throw new InvalidAnswerInputError('custom answer requires non-empty customText');
    }
    return { choiceIndex: 6, customText: text };
  }
  return { choiceIndex: idx as ChoiceIndex };
}

export interface PoQuestionOption {
  // 1..4 carry substantive content; 5/6 are server-injected sentinels.
  kind: 'choice' | 'auto_judge' | 'custom';
  label: string;
  // For 1..4 only — the canonical answer value if the user picks this option.
  value?: unknown;
}

/**
 * Resolve the canonical value the user committed to. Throws if the input is
 * inconsistent with the question's option layout (e.g. trying to pick 1..4 on
 * a question that has fewer than 4 substantive options).
 */
export function valueForChoice(
  options: readonly PoQuestionOption[],
  input: NormalizedAnswerInput,
  judged?: { chosenValue: unknown; rationale: string },
): unknown {
  if (input.choiceIndex >= 1 && input.choiceIndex <= 4) {
    const option = options[input.choiceIndex - 1];
    if (!option || option.kind !== 'choice') {
      throw new InvalidAnswerInputError(`option ${input.choiceIndex} is not a substantive choice`);
    }
    return option.value;
  }
  if (input.choiceIndex === 5) {
    if (!judged) {
      throw new InvalidAnswerInputError('auto-judge requires a judged result');
    }
    return judged;
  }
  if (input.choiceIndex === 6) {
    return input.customText ?? '';
  }
  throw new InvalidAnswerInputError(`unhandled choiceIndex ${input.choiceIndex}`);
}

/** True when a question is in a state where the user can submit an answer. */
export function isAnswerable(status: string): boolean {
  return status === 'active';
}
