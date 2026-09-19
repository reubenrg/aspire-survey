import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { t as globalT, type Lang } from '../i18n/Translations';
import type { SurveyDefinition } from './types';

export { translatableStrings } from './translatable.ts';

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
