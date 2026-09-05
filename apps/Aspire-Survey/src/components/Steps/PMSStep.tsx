import { useState } from 'react';
import { PMS_CLARITY_OPTIONS } from '../../data/SurveyData';
import RadioSelect from '../RadioSelect';
import NavigationButtons from '../NavigationButtons';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  value: string;
  onChange: (val: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function PMSStep({ value, onChange, onNext, onBack }: Props) {
  const { lang } = useLang();
  const [error, setError] = useState(false);

  const validate = () => {
    if (!value) { setError(true); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    onNext();
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-6">{t('Performance Clarity', lang)}</h2>
      <RadioSelect label="How clear are you today about what you need to improve in your role?" options={PMS_CLARITY_OPTIONS} value={value} onChange={(v) => { onChange(v); setError(false); }} required error={error} lang={lang} />
      <NavigationButtons onBack={onBack} onNext={validate} lang={lang} />
    </div>
  );
}
