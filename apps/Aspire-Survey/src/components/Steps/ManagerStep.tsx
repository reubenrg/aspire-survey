import { useState } from 'react';
import { MANAGER_ROWS, AGREE_SCALE, MANAGER_FREQUENCY_OPTIONS } from '../../data/SurveyData';
import LikertMatrix from '../LikertMatrix';
import RadioSelect from '../RadioSelect';
import NavigationButtons from '../NavigationButtons';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  matrixAnswers: Record<string, string>;
  frequency: string;
  onMatrixChange: (row: string, val: string) => void;
  onFrequencyChange: (val: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function ManagerStep({ matrixAnswers, frequency, onMatrixChange, onFrequencyChange, onNext, onBack }: Props) {
  const { lang } = useLang();
  const [errors, setErrors] = useState<Set<string>>(new Set());

  const validate = () => {
    const e = new Set<string>();
    MANAGER_ROWS.forEach((r) => { if (!matrixAnswers[r]) e.add(r); });
    if (!frequency) e.add('frequency');
    setErrors(e);
    if (e.size === 0) onNext();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const statements = MANAGER_ROWS.map((r, i) => ({ id: i, text: r }));
  const matrixById: Record<number, string> = {};
  MANAGER_ROWS.forEach((r, i) => { if (matrixAnswers[r]) matrixById[i] = matrixAnswers[r]; });
  const errorIds = new Set<number>();
  MANAGER_ROWS.forEach((r, i) => { if (errors.has(r)) errorIds.add(i); });

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-1">{t('Work Environment & Manager Support', lang)}</h2>
      <p className="text-sm text-muted-foreground mb-6">{t('Please rate the following statements about your immediate manager.', lang)}</p>
      <LikertMatrix statements={statements} scaleLabels={AGREE_SCALE} answers={matrixById} onChange={(id, val) => { onMatrixChange(MANAGER_ROWS[id], val); setErrors((p) => { const n = new Set(p); n.delete(MANAGER_ROWS[id]); return n; }); }} errors={errorIds} lang={lang} />
      <div className="mt-8">
        <RadioSelect label="How often does your manager discuss the behaviour behind your Aspire Program habits during normal work?" options={MANAGER_FREQUENCY_OPTIONS} value={frequency} onChange={(v) => { onFrequencyChange(v); setErrors((p) => { const n = new Set(p); n.delete('frequency'); return n; }); }} required error={errors.has('frequency')} lang={lang} />
      </div>
      <NavigationButtons onBack={onBack} onNext={validate} lang={lang} />
    </div>
  );
}
