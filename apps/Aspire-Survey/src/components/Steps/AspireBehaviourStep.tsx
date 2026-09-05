import { useState } from 'react';
import { ASPIRE_BEHAVIOUR_ROWS, AGREE_SCALE } from '../../data/SurveyData';
import LikertMatrix from '../LikertMatrix';
import NavigationButtons from '../NavigationButtons';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  matrixAnswers: Record<string, string>;
  onMatrixChange: (row: string, val: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function AspireBehaviourStep({ matrixAnswers, onMatrixChange, onNext, onBack }: Props) {
  const { lang } = useLang();
  const [errors, setErrors] = useState<Set<string>>(new Set());

  const validate = () => {
    const e = new Set<string>();
    ASPIRE_BEHAVIOUR_ROWS.forEach((r) => { if (!matrixAnswers[r]) e.add(r); });
    setErrors(e);
    if (e.size === 0) onNext();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const statements = ASPIRE_BEHAVIOUR_ROWS.map((r, i) => ({ id: i, text: r }));
  const matrixById: Record<number, string> = {};
  ASPIRE_BEHAVIOUR_ROWS.forEach((r, i) => { if (matrixAnswers[r]) matrixById[i] = matrixAnswers[r]; });
  const errorIds = new Set<number>();
  ASPIRE_BEHAVIOUR_ROWS.forEach((r, i) => { if (errors.has(r)) errorIds.add(i); });

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-1">{t('Aspire Program & Behaviour Change', lang)}</h2>
      <p className="text-sm text-muted-foreground mb-6">{t('Thinking about your Aspire Program experience, how much do you agree with the following?', lang)}</p>
      <LikertMatrix statements={statements} scaleLabels={AGREE_SCALE} answers={matrixById} onChange={(id, val) => { onMatrixChange(ASPIRE_BEHAVIOUR_ROWS[id], val); setErrors((p) => { const n = new Set(p); n.delete(ASPIRE_BEHAVIOUR_ROWS[id]); return n; }); }} errors={errorIds} lang={lang} />
      <NavigationButtons onBack={onBack} onNext={validate} lang={lang} />
    </div>
  );
}
