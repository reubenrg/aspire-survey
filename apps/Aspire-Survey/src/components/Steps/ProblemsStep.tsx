import { useState } from 'react';
import { MISTAKE_RESPONSE_OPTIONS, WORK_LEVEL_OPTIONS } from '../../data/SurveyData';
import RadioSelect from '../RadioSelect';
import NavigationButtons from '../NavigationButtons';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  mistakeResponse: string;
  workLevel: string;
  onMistakeChange: (val: string) => void;
  onWorkLevelChange: (val: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function ProblemsStep({ mistakeResponse, workLevel, onMistakeChange, onWorkLevelChange, onNext, onBack }: Props) {
  const { lang } = useLang();
  const [errors, setErrors] = useState<Set<string>>(new Set());

  const validate = () => {
    const e = new Set<string>();
    if (!mistakeResponse) e.add('mistake');
    if (!workLevel) e.add('workLevel');
    setErrors(e);
    if (e.size === 0) onNext();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-6">{t('How Do You Handle Problems?', lang)}</h2>
      <div className="space-y-8">
        <RadioSelect label="When something goes wrong in your work, which statement best describes what you usually do?" options={MISTAKE_RESPONSE_OPTIONS} value={mistakeResponse} onChange={(v) => { onMistakeChange(v); setErrors((p) => { const n = new Set(p); n.delete('mistake'); return n; }); }} required error={errors.has('mistake')} lang={lang} />
        <RadioSelect label="Which statement best describes how you approach your work today?" options={WORK_LEVEL_OPTIONS} value={workLevel} onChange={(v) => { onWorkLevelChange(v); setErrors((p) => { const n = new Set(p); n.delete('workLevel'); return n; }); }} required error={errors.has('workLevel')} lang={lang} />
      </div>
      <NavigationButtons onBack={onBack} onNext={validate} lang={lang} />
    </div>
  );
}
