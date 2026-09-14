import { useState } from 'react';
import { HABIT_LEVELS, IMPROVEMENT_FACTORS, IMPACT_AREAS } from '../../data/SurveyData';
import RadioSelect from '../RadioSelect';
import CheckboxSelect from '../CheckBoxSelect';
import NavigationButtons from '../NavigationButtons';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  habitLevel: string;
  onHabitChange: (val: string) => void;
  factors: string[];
  onFactorsChange: (val: string[]) => void;
  factorsOther: string;
  onFactorsOtherChange: (val: string) => void;
  impacts: string[];
  onImpactsChange: (val: string[]) => void;
  impactsOther: string;
  onImpactsOtherChange: (val: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function HabitImpactStep({
  habitLevel, onHabitChange,
  factors, onFactorsChange, factorsOther, onFactorsOtherChange,
  impacts, onImpactsChange, impactsOther, onImpactsOtherChange,
  onNext, onBack,
}: Props) {
  const { lang } = useLang();
  const [errors, setErrors] = useState<Set<string>>(new Set());

  const validate = () => {
    const e = new Set<string>();
    if (!habitLevel) e.add('habit');
    if (factors.length === 0) e.add('factors');
    if (impacts.length === 0) e.add('impacts');
    setErrors(e);
    if (e.size === 0) onNext();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clear = (key: string) => setErrors((p) => { const n = new Set(p); n.delete(key); return n; });

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-6">{t('Habits, Support and Impact', lang)}</h2>
      <div className="space-y-8">
        <RadioSelect label="Which statement best describes the behaviour you are currently practising through the Aspire Program?" options={HABIT_LEVELS} value={habitLevel} onChange={(v) => { onHabitChange(v); clear('habit'); }} required error={errors.has('habit')} lang={lang} />
        <CheckboxSelect label="Which factors have contributed most to any improvement in how you work in the last six months? (Select up to 3)" options={IMPROVEMENT_FACTORS} selected={factors} onChange={(v) => { onFactorsChange(v); clear('factors'); }} otherText={factorsOther} onOtherTextChange={onFactorsOtherChange} maxSelections={3} required error={errors.has('factors')} lang={lang} />
        <CheckboxSelect label="Where have you noticed the most improvement in your work? (Select up to 3)" options={IMPACT_AREAS} selected={impacts} onChange={(v) => { onImpactsChange(v); clear('impacts'); }} otherText={impactsOther} onOtherTextChange={onImpactsOtherChange} maxSelections={3} required error={errors.has('impacts')} lang={lang} />
      </div>
      <NavigationButtons onBack={onBack} onNext={validate} lang={lang} />
    </div>
  );
}
