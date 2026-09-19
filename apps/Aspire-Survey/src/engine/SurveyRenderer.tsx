import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import EngineHeader from './EngineHeader';
import SurveyToaster from '../components/SurveyToaster';
import NavigationButtons from '../components/NavigationButtons';
import LanguageToggle from '../components/LanguageToggle';
import { Button } from '../components/ui/button';
import { LanguageProvider, useLang } from '../i18n/LanguageContext';
import { TranslateProvider, useT } from './translate';
import QuestionField from './QuestionField';
import { firstSectionIndex, nextSectionIndex, sectionPath, visibleQuestions } from './definition';
import { validateSection } from './validation';
import { pipe } from './logic';
import { newSeed, seededShuffle } from './randomize';
import { clearProgress, loadProgress, progressFits, saveProgress, type SavedProgress } from './progress';
import { RESPONDENT_PRIVACY_NOTICE, type EnginePrivacyMode } from './privacyNotices';
import type { Answers, AnswerValue, SurveyDefinition } from './types';

interface Props {
  definition: SurveyDefinition;
  /** Receives the flattened row. Resolve to finish, reject with a message to stay put. */
  onSubmit: (answers: Answers) => Promise<void>;
  /** When known, shows the matching privacy notice on the welcome screen. Omit for contexts (e.g. the Builder's own Preview) where no real invitation/privacy mode applies yet. */
  privacyMode?: EnginePrivacyMode;
  /** Fired once, the moment the respondent leaves the welcome screen. Omit where there's no invitation to mark (e.g. an open /s/:slug survey, or the Builder's Preview). */
  onStart?: () => void;
  /**
   * Identifies this respondent's saved place (the survey slug, or the invitation
   * token). Omit where saving makes no sense, e.g. the Builder's own Preview.
   */
  progressKey?: string;
  /** Values from the survey link for the definition's hidden fields. */
  hiddenValues?: Record<string, string>;
}

export default function SurveyRenderer(props: Props) {
  return (
    <LanguageProvider>
      <TranslateProvider definition={props.definition}>
        <SurveyToaster />
        <SurveyBody {...props} />
      </TranslateProvider>
    </LanguageProvider>
  );
}

function SurveyBody({ definition, onSubmit, privacyMode, onStart, progressKey, hiddenValues }: Props) {
  const { lang } = useLang();
  const t = useT();
  // 'welcome' -> a page (index into definition.sections) -> 'thanks'. Pages are
  // walked by the survey's own skip/display logic, so the respondent's route is
  // a stack of the indices they have actually visited, not "step - 1".
  const [stage, setStage] = useState<'welcome' | 'section' | 'thanks'>('welcome');
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Answers>(() => ({ ...(hiddenValues ?? {}) }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [seed] = useState(newSeed);

  const total = definition.sections.length;

  const canSave = !!progressKey && definition.saveProgress !== false;
  // Read once: a saved place is offered on the welcome screen, never applied silently.
  const [offer, setOffer] = useState<SavedProgress | null>(() => {
    if (!canSave) return null;
    const p = loadProgress(progressKey!);
    return p && progressFits(p, definition) ? p : null;
  });

  useEffect(() => {
    if (!canSave || stage !== 'section') return;
    saveProgress(progressKey!, { answers, index, history });
  }, [canSave, progressKey, stage, answers, index, history]);

  const resume = () => {
    if (!offer) return;
    setAnswers({ ...offer.answers, ...(hiddenValues ?? {}) });
    setIndex(offer.index);
    setHistory(offer.history);
    setStage('section');
    setOffer(null);
    onStart?.();
    window.scrollTo({ top: 0 });
  };

  const startOver = () => {
    if (canSave) clearProgress(progressKey!);
    setOffer(null);
  };

  const setAnswer = useCallback((key: string, value: AnswerValue) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
    setErrors(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const section = stage === 'section' ? definition.sections[index] ?? null : null;
  const shown = useMemo(() => {
    if (!section) return [];
    const visible = visibleQuestions(section, answers);
    return section.randomizeQuestions ? seededShuffle(visible, seed, section.id) : visible;
  }, [section, answers, seed]);

  // Position within the route the current answers imply, so "page 2 of 4" stays
  // honest when a skip rule shortens the survey.
  const path = useMemo(() => sectionPath(definition, answers), [definition, answers]);
  const position = Math.max(1, path.indexOf(index) + 1);
  const routeLength = Math.max(position, path.length);
  const isLast = section ? nextSectionIndex(definition, index, answers) >= total : false;

  const begin = () => {
    onStart?.();
    setIndex(Math.min(firstSectionIndex(definition, answers), Math.max(0, total - 1)));
    setHistory([]);
    setStage('section');
    scrollTop();
  };

  const back = () => {
    const prev = history[history.length - 1];
    if (prev === undefined) return;
    setHistory(h => h.slice(0, -1));
    setIndex(prev);
    setErrors({});
    scrollTop();
  };

  const advance = async () => {
    if (!section) return;
    const problems = validateSection(section, answers);
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      scrollTop();
      return;
    }
    const next = nextSectionIndex(definition, index, answers);
    if (next < total) {
      setHistory(h => [...h, index]);
      setIndex(next);
      setErrors({});
      scrollTop();
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(answers);
      if (canSave) clearProgress(progressKey!);
      setStage('thanks');
      setErrors({});
      scrollTop();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (stage === 'welcome') {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-6 py-10">
          <div className="flex justify-center mb-6"><LanguageToggle /></div>
          <h1 className="text-2xl font-display text-foreground text-center mb-2">
            {t(definition.welcome.heading, lang)}
          </h1>
          <h2 className="text-base text-primary text-center mb-8">{t(definition.title, lang)}</h2>
          {definition.welcome.body.map((p, i) => (
            <p key={i} className="mb-4 text-sm leading-relaxed text-muted-foreground">{t(p, lang)}</p>
          ))}
          {definition.welcome.note && (
            <div className="my-6 rounded-lg border-l-4 border-l-primary/50 border border-border/60 bg-muted/40 px-4 py-3">
              <p className="text-xs leading-relaxed text-muted-foreground">{t(definition.welcome.note, lang)}</p>
            </div>
          )}
          {offer && (
            <div className="my-6 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3" role="status">
              <p className="text-sm font-medium text-foreground">
                {t('You have an unfinished response from', lang)} {new Date(offer.savedAt).toLocaleString()}.
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={resume}>{t('Continue where I left off', lang)}</Button>
                <Button size="sm" variant="ghost" onClick={startOver}>{t('Start over', lang)}</Button>
              </div>
            </div>
          )}
          {privacyMode && (
            <div className="my-6 rounded-lg border-l-4 border-l-primary/50 border border-border/60 bg-muted/40 px-4 py-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {RESPONDENT_PRIVACY_NOTICE[privacyMode]}
              </p>
            </div>
          )}
          <div className="flex justify-center mt-8">
            <Button onClick={begin}>{t(definition.welcome.startLabel || 'Begin Survey', lang)}</Button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'thanks') {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-6">
        <div className="max-w-xl text-center">
          <h2 className="text-2xl font-display text-foreground mb-4">{t(definition.thankYou.heading, lang)}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{pipe(t(definition.thankYou.body, lang), answers)}</p>
        </div>
      </div>
    );
  }

  if (!section) return null;

  return (
    <div className="min-h-screen bg-background">
      <EngineHeader brand={definition.brand || definition.title} currentSection={position} totalSections={routeLength} />
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h2 className="text-xl font-display text-foreground mb-4">{t(section.title, lang)}</h2>
        {section.intro && (
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{t(section.intro, lang)}</p>
        )}
        {section.note && (
          <div className="mb-6 rounded-lg border-l-4 border-l-primary/50 border border-border/60 bg-muted/40 px-4 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">{t(section.note, lang)}</p>
          </div>
        )}
        <div className="space-y-8">
          {shown.map(q => (
            <QuestionField
              key={q.id}
              question={q}
              answers={answers}
              onChange={setAnswer}
              error={errors[q.id]}
              seed={seed}
              lang={lang}
            />
          ))}
        </div>
        {canSave && (
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            {t('Your progress is saved on this device, so you can come back to finish.', lang)}
          </p>
        )}
        <NavigationButtons
          onBack={history.length > 0 ? back : undefined}
          showBack={history.length > 0}
          onNext={advance}
          nextLabel={isLast ? 'Submit Survey' : 'Next'}
          isSubmitting={isSubmitting}
          lang={lang}
        />
      </div>
    </div>
  );
}
