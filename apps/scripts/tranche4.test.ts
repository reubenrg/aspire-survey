/** Tests for quiz scoring and the columns it and hidden fields add. Run with `npm test`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandFor, computeScore, fillScoreTokens, questionMax, questionScore } from '../Aspire-Survey/src/engine/scoring.ts';
import { buildSubmissionRow } from '../Aspire-Survey/src/engine/submission.ts';
import { columnsFor } from '../Aspire-Survey/src/engine/definition.ts';
import { validateSurveyStructure } from '../Aspire-Survey/src/admin/builderValidation.ts';
import { questionColumns } from '../Aspire-Survey/src/admin/questionMeta.ts';
import { translatableStrings } from '../Aspire-Survey/src/engine/translatable.ts';
import type { Question, SurveyDefinition } from '../Aspire-Survey/src/engine/types.ts';

const capital: Question = { id: 'capital', type: 'radio', label: 'Capital of France?', options: ['Paris', 'Rome', 'Oslo'], optionScores: { Paris: 5 } };
const langs: Question = { id: 'langs', type: 'checkbox', label: 'Which are programming languages?', options: ['Python', 'HTML', 'Rust', 'Excel'], optionScores: { Python: 2, Rust: 2, HTML: -1 } };
const sure: Question = { id: 'sure', type: 'yesno', label: 'Sure?', optionScores: { Yes: 1, No: 0 } };
const conf: Question = { id: 'conf', type: 'rating', label: 'Confidence', max: 5, scoreWeight: 2 };

const quiz = (extra: Partial<SurveyDefinition> = {}, questions: Question[] = [capital, langs, sure, conf]): SurveyDefinition => ({
  slug: 'q', title: 'Quiz', welcome: { heading: 'h', body: [] }, thankYou: { heading: 't', body: 'You scored {{score}} of {{maxscore}}: {{result}}' },
  hiddenFields: ['quiz_score'],
  scoring: { enabled: true, showResult: true, bands: [{ min: 0, label: 'Beginner' }, { min: 6, label: 'Good', message: 'Nice.' }, { min: 10, label: 'Expert' }] },
  sections: [{ id: 's', title: 'S', questions }],
  ...extra,
});

test('a choice scores its option; unlisted options and unanswered questions score zero', () => {
  assert.equal(questionScore(capital, 'Paris'), 5);
  assert.equal(questionScore(capital, 'Rome'), 0);
  assert.equal(questionScore(capital, undefined), 0);
  assert.equal(questionScore(sure, 'Yes'), 1);
  assert.equal(questionScore(sure, 'Maybe'), 0);
});

test('multi-select sums the chosen options, and a negative option takes points away', () => {
  assert.equal(questionScore(langs, ['Python', 'Rust']), 4);
  assert.equal(questionScore(langs, ['Python', 'HTML']), 1);
  assert.equal(questionScore(langs, []), 0);
});

test('numeric answers score value x weight; no weight means no points', () => {
  assert.equal(questionScore(conf, '4'), 8);
  assert.equal(questionScore({ ...conf, scoreWeight: undefined } as Question, '4'), 0);
  assert.equal(questionScore(conf, 'abc'), 0);
});

test('the maximum counts only what can actually be earned', () => {
  assert.equal(questionMax(capital), 5);
  assert.equal(questionMax(langs), 4, 'a penalty option is not part of the maximum');
  assert.equal(questionMax(sure), 1);
  assert.equal(questionMax(conf), 10);
  assert.equal(questionMax({ id: 'x', type: 'radio', label: 'x', options: ['a'] }), 0);
});

test('the total and the band', () => {
  const r = computeScore(quiz(), { capital: 'Paris', langs: ['Python', 'Rust'], sure: 'Yes', conf: '5' });
  assert.deepEqual([r.score, r.max, r.band?.label], [20, 20, 'Expert']);
  const low = computeScore(quiz(), { capital: 'Rome', langs: ['HTML'], sure: 'No', conf: '1' });
  assert.deepEqual([low.score, low.band?.label], [1, 'Beginner']);
  const mid = computeScore(quiz(), { capital: 'Paris', sure: 'Yes' });
  assert.deepEqual([mid.score, mid.band?.label, mid.band?.message], [6, 'Good', 'Nice.']);
});

test('bands: the highest minimum reached wins, and no band means none', () => {
  const bands = [{ min: 50, label: 'B' }, { min: 0, label: 'A' }, { min: 90, label: 'C' }];
  assert.equal(bandFor(bands, 49)?.label, 'A');
  assert.equal(bandFor(bands, 50)?.label, 'B');
  assert.equal(bandFor(bands, 1000)?.label, 'C');
  assert.equal(bandFor(bands, -5), undefined);
  assert.equal(bandFor(undefined, 5), undefined);
});

test('a hidden question, or one on a page the respondent was routed past, earns and counts nothing', () => {
  const hidden: Question = { id: 'bonus', type: 'yesno', label: 'Bonus', optionScores: { Yes: 10 }, showIf: { questionId: 'sure', equals: ['Yes'] } };
  const def = quiz({}, [sure, hidden]);
  assert.deepEqual([computeScore(def, { sure: 'No', bonus: 'Yes' }).score, computeScore(def, { sure: 'No', bonus: 'Yes' }).max], [0, 1]);
  assert.equal(computeScore(def, { sure: 'Yes', bonus: 'Yes' }).score, 11);

  const routed: SurveyDefinition = {
    ...quiz(), sections: [
      { id: 'a', title: 'A', questions: [sure], jumps: [{ when: { questionId: 'sure', equals: ['No'] }, to: 'c' }] },
      { id: 'b', title: 'B', questions: [capital] },
      { id: 'c', title: 'C', questions: [{ id: 'z', type: 'text', label: 'Z' }] },
    ],
  };
  assert.equal(computeScore(routed, { sure: 'No', capital: 'Paris' }).score, 0, 'page B was skipped, so its answer does not count');
  assert.equal(computeScore(routed, { sure: 'Yes', capital: 'Paris' }).score, 6);
});

test('score tokens fill in the thank-you message', () => {
  const r = computeScore(quiz(), { capital: 'Paris', langs: ['Python', 'Rust'], sure: 'Yes', conf: '5' });
  assert.equal(fillScoreTokens('You scored {{score}} of {{maxscore}}: {{ result }}', r), 'You scored 20 of 20: Expert');
  assert.equal(fillScoreTokens('no tokens', r), 'no tokens');
});

test('the submitted row carries the computed score - a score in the link is ignored', () => {
  const def = quiz();
  const row = buildSubmissionRow(def, { capital: 'Paris', sure: 'Yes', quiz_score: '999' });
  assert.equal(row.quiz_score, '6');
  assert.equal(columnsFor(def).some(c => c.name === 'quiz_score'), true);
  // scoring off: nothing is written even if the field is listed
  const off = buildSubmissionRow({ ...def, scoring: { enabled: false } }, { capital: 'Paris', quiz_score: '999' });
  assert.notEqual(off.quiz_score, '5');
  assert.equal(off.quiz_score, '999' , 'listed as an ordinary hidden field it carries the link value, which is why the builder warns about it');
});

test('builder validation: scoring needs its hidden field, unique bands with labels, and points somewhere', () => {
  const errs = (def: SurveyDefinition) => validateSurveyStructure(def).filter(i => i.severity === 'error').map(i => i.message).join('|');
  assert.equal(errs(quiz()), '');
  assert.match(errs(quiz({ hiddenFields: undefined })), /"quiz_score" field is missing/);
  assert.match(errs(quiz({ scoring: { enabled: true, bands: [{ min: 5, label: 'A' }, { min: 5, label: 'B' }] } })), /same score/);
  assert.match(errs(quiz({ scoring: { enabled: true, bands: [{ min: 0, label: '  ' }] } })), /needs a label/);
  assert.match(errs(quiz({ scoring: { enabled: true, bands: [{ min: NaN, label: 'A' }] } })), /numeric minimum/);
  const warn = validateSurveyStructure(quiz({}, [{ id: 'q', type: 'text', label: 'Q' }])).filter(i => i.severity === 'warning').map(i => i.message).join('|');
  assert.match(warn, /no question awards any points/);
  const stale = validateSurveyStructure(quiz({ scoring: undefined })).filter(i => i.severity === 'warning').map(i => i.message).join('|');
  assert.match(stale, /scoring is off/);
});

test('the score and link fields appear in analytics as columns, and band text is translatable', () => {
  const def = quiz({ hiddenFields: ['source', 'quiz_score'] });
  const meta = questionColumns(def).filter(c => c.questionId === 'source' || c.questionId === 'quiz_score');
  assert.deepEqual(meta.map(c => [c.column, c.kind]), [['source', 'choice'], ['quiz_score', 'numeric']]);
  const strings = translatableStrings(def);
  for (const s of ['Beginner', 'Good', 'Nice.', 'Expert']) assert.ok(strings.includes(s), s);
});
