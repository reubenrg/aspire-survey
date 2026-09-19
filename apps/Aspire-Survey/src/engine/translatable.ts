import type { Question, Section, SurveyDefinition } from './types.ts';

/**
 * Every distinct piece of respondent-facing text in a survey, in reading order.
 * The translations screen is built from this, so adding a question type that
 * introduces new text means adding it here too or it will not be translatable.
 */
export function translatableStrings(def: SurveyDefinition): string[] {
  const out: string[] = [];
  const push = (v?: string) => { if (v && v.trim() !== '' && !out.includes(v)) out.push(v); };

  push(def.title);
  push(def.brand);
  push(def.welcome.heading);
  def.welcome.body.forEach(push);
  push(def.welcome.note);
  push(def.welcome.startLabel);

  const fromQuestion = (q: Question) => {
    push(q.label);
    push(q.hint);
    if ('placeholder' in q) push(q.placeholder);
    if ('options' in q) q.options.forEach(push);
    if ('lowLabel' in q) { push(q.lowLabel); push(q.highLabel); }
    if ('unit' in q) push(q.unit);
    if (q.type === 'yesno') { push(q.yesLabel); push(q.noLabel); }
    if (q.type === 'text') push(q.patternMessage);
    if (q.type === 'matrix') {
      q.rows.forEach(push);
      q.scale.forEach(push);
      Object.values(q.rowsByAnswer?.map ?? {}).forEach(rows => rows.forEach(push));
      Object.values(q.titleByAnswer ?? {}).forEach(push);
    }
  };

  def.sections.forEach((s: Section) => {
    push(s.title);
    push(s.intro);
    push(s.note);
    s.questions.forEach(fromQuestion);
  });

  push(def.thankYou.heading);
  push(def.thankYou.body);
  return out;
}
