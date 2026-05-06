import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  coerceSkipToAutoJudge,
  InvalidAnswerInputError,
  isAnswerable,
  valueForChoice,
  type PoQuestionOption,
} from './skipPolicy';

const optionsForFour: PoQuestionOption[] = [
  { kind: 'choice', label: 'Option 1', value: 'one' },
  { kind: 'choice', label: 'Option 2', value: 'two' },
  { kind: 'choice', label: 'Option 3', value: 'three' },
  { kind: 'choice', label: 'Option 4', value: 'four' },
  { kind: 'auto_judge', label: 'AI auto-judge' },
  { kind: 'custom', label: 'Custom answer' },
];

test('skip maps to choiceIndex 5', () => {
  const out = coerceSkipToAutoJudge({ skip: true });
  assert.equal(out.choiceIndex, 5);
});

test('explicit choiceIndex 1..4 passes through', () => {
  for (const idx of [1, 2, 3, 4] as const) {
    const out = coerceSkipToAutoJudge({ choiceIndex: idx });
    assert.equal(out.choiceIndex, idx);
  }
});

test('choiceIndex 6 requires non-empty customText', () => {
  assert.throws(() => coerceSkipToAutoJudge({ choiceIndex: 6 }), InvalidAnswerInputError);
  assert.throws(
    () => coerceSkipToAutoJudge({ choiceIndex: 6, customText: '   ' }),
    InvalidAnswerInputError,
  );
  const out = coerceSkipToAutoJudge({ choiceIndex: 6, customText: '  hello  ' });
  assert.equal(out.choiceIndex, 6);
  assert.equal(out.customText, 'hello');
});

test('out-of-range choiceIndex throws', () => {
  assert.throws(() => coerceSkipToAutoJudge({ choiceIndex: 0 }), InvalidAnswerInputError);
  assert.throws(() => coerceSkipToAutoJudge({ choiceIndex: 7 }), InvalidAnswerInputError);
  assert.throws(() => coerceSkipToAutoJudge({}), InvalidAnswerInputError);
});

test('valueForChoice picks the correct option value', () => {
  assert.equal(valueForChoice(optionsForFour, { choiceIndex: 2 }), 'two');
});

test('valueForChoice for auto-judge requires a judged result', () => {
  assert.throws(
    () => valueForChoice(optionsForFour, { choiceIndex: 5 }),
    InvalidAnswerInputError,
  );
  const judged = { chosenValue: 'three', rationale: 'most consistent with prior answers' };
  assert.deepEqual(valueForChoice(optionsForFour, { choiceIndex: 5 }, judged), judged);
});

test('valueForChoice for custom returns the customText', () => {
  assert.equal(
    valueForChoice(optionsForFour, { choiceIndex: 6, customText: 'free text' }),
    'free text',
  );
});

test('isAnswerable only returns true for active', () => {
  assert.equal(isAnswerable('active'), true);
  assert.equal(isAnswerable('stale'), false);
  assert.equal(isAnswerable('superseded'), false);
});
