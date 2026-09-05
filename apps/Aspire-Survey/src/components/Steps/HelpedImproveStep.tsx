import { useState } from 'react';
import { IMPROVEMENT_FACTORS } from '../../data/SurveyData';
import CheckboxSelect from '../CheckboxSelect';
import NavigationButtons from '../NavigationButtons';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  factors: string[];
  onFactorsChange: (val: string[]) => void;
  otherText: string;
  onOtherTextChange: (val: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function HelpedImproveStep({ factors, onFactorsChange, otherText, onOtherTextChange, onNext, onBack }: Props) {
  const { lang } = useLang();
  const [error, setError] = useState(false);

  const validate = () => {
    if (factors.length === 0) { setError(true); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    onNext();
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-6">{t('What Has Helped You Improve?', lang)}</h2>
      <CheckboxSelect label="Which factors have contributed most to any improvement in how you work since April? (Select up to 3)" options={IMPROVEMENT_FACTORS} selected={factors} onChange={(v) => { onFactorsChange(v); setError(false); }} otherText={otherText} onOtherTextChange={onOtherTextChange} maxSelections={3} required error={error} lang={lang} />
      <NavigationButtons onBack={onBack} onNext={validate} lang={lang} />
    </div>
  );
}

