import { useState } from 'react';
import { HABIT_LEVELS } from '../../data/SurveyData';
import RadioSelect from '../RadioSelect';
import NavigationButtons from '../NavigationButtons';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  habitLevel: string;
  onHabitChange: (val: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function HabitStep({ habitLevel, onHabitChange, onNext, onBack }: Props) {
  const { lang } = useLang();
  const [errors, setErrors] = useState<Set<string>>(new Set());

  const validate = () => {
    const e = new Set<string>();
    if (!habitLevel) e.add('habit');
    setErrors(e);
    if (e.size === 0) onNext();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-6">{t('Has the Habit Become Part of Your Work?', lang)}</h2>
      <RadioSelect label="Which statement best describes the behaviour you are currently practising through the Aspire Program?" options={HABIT_LEVELS} value={habitLevel} onChange={(v) => { onHabitChange(v); setErrors((p) => { const n = new Set(p); n.delete('habit'); return n; }); }} required error={errors.has('habit')} lang={lang} />
      <NavigationButtons onBack={onBack} onNext={validate} lang={lang} />
    </div>
  );
}
