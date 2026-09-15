import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { t as globalT, type Lang } from '../i18n/Translations';
import type { Question, Section, SurveyDefinition } from './types';

export type Translate = (text: string, lang: Lang) => string;

const TranslateContext = createContext<Translate>(globalT);

export const useT = () => useContext(TranslateContext);

/**
 * Resolves a string against the survey's own translations first, then the
 * app-wide map, then English.
 *
 * Surveys built in the admin carry their translations in the definition, since
 * they cannot add entries to a compiled file. The app-wide map still applies so
 * shared chrome like "Next" and "Back" stays translated without every survey
 * having to repeat it.
 */
export function TranslateProvider({
  definition,
  children,
}: {
  definition: SurveyDefinition;
  children: ReactNode;
}) {
  const translate = useMemo<Translate>(() => {
    const own = definition.i18n ?? {};
    return (text, lang) => {
      if (lang === 'en') return text;
      const mine = own[text]?.[lang];
      if (mine && mine.trim() !== '') return mine;
      return globalT(text, lang);
    };
  }, [definition]);

  return <TranslateContext.Provider value={translate}>{children}</TranslateContext.Provider>;
}

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
    if (q.type === 'select' || q.type === 'text') push(q.placeholder);
    if (q.type === 'radio' || q.type === 'checkbox' || q.type === 'select') q.options.forEach(push);
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
