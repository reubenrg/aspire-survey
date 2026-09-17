import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import EngineHeader from './EngineHeader';
import SurveyToaster from '../components/SurveyToaster';
import NavigationButtons from '../components/NavigationButtons';
import LanguageToggle from '../components/LanguageToggle';
import { Button } from '../components/ui/button';
import { LanguageProvider, useLang } from '../i18n/LanguageContext';
import { TranslateProvider, useT } from './translate';
import QuestionField from './QuestionField';
import { missingAnswers, visibleQuestions } from './definition';
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

function SurveyBody({ definition, onSubmit, privacyMode, onStart }: Props) {
  const { lang } = useLang();
  const t = useT();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const total = definition.sections.length;
  // 0 = welcome, 1..total = sections, total + 1 = thank you
  const thankYouStep = total + 1;

  const setAnswer = useCallback((key: string, value: AnswerValue) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
    setErrors(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const go = useCallback((to: number) => {
    setStep(to);
    setErrors(new Set());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const section = step >= 1 && step <= total ? definition.sections[step - 1] : null;
  const shown = useMemo(
    () => (section ? visibleQuestions(section, answers) : []),
    [section, answers],
  );

  const advance = async () => {
    if (!section) return;
    const missing = missingAnswers(section, answers);
    if (missing.length > 0) {
      setErrors(new Set(missing));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (step < total) { go(step + 1); return; }

    setIsSubmitting(true);
    try {
      await onSubmit(answers);
      go(thankYouStep);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === 0) {
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
          {privacyMode && (
            <div className="my-6 rounded-lg border-l-4 border-l-primary/50 border border-border/60 bg-muted/40 px-4 py-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {RESPONDENT_PRIVACY_NOTICE[privacyMode]}
              </p>
            </div>
          )}
          <div className="flex justify-center mt-8">
            <Button onClick={() => { onStart?.(); go(1); }}>{t(definition.welcome.startLabel || 'Begin Survey', lang)}</Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === thankYouStep) {
    return (
      <div className="min-h-screen bg-background grid place-items-center px-6">
        <div className="max-w-xl text-center">
          <h2 className="text-2xl font-display text-foreground mb-4">{t(definition.thankYou.heading, lang)}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{t(definition.thankYou.body, lang)}</p>
        </div>
      </div>
    );
  }

  if (!section) return null;

  return (
    <div className="min-h-screen bg-background">
      <EngineHeader brand={definition.brand || definition.title} currentSection={step} totalSections={total} />
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
              error={errors.has(q.id)}
              lang={lang}
            />
          ))}
        </div>
        <NavigationButtons
          onBack={step > 1 ? () => go(step - 1) : undefined}
          showBack={step > 1}
          onNext={advance}
          nextLabel={step === total ? 'Submit Survey' : 'Next'}
          isSubmitting={isSubmitting}
          lang={lang}
        />
      </div>
    </div>
  );
}
