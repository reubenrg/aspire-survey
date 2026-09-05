import { useState } from 'react';
import { IMPACT_AREAS } from '../../data/SurveyData';
import CheckboxSelect from '../CheckboxSelect';
import NavigationButtons from '../NavigationButtons';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  impacts: string[];
  onImpactsChange: (val: string[]) => void;
  otherText: string;
  onOtherTextChange: (val: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function ImpactSeenStep({ impacts, onImpactsChange, otherText, onOtherTextChange, onNext, onBack }: Props) {
  const { lang } = useLang();
  const [error, setError] = useState(false);

  const validate = () => {
    if (impacts.length === 0) { setError(true); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    onNext();
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-6">{t('What Type of Impact Have You Seen?', lang)}</h2>
      <CheckboxSelect label="Where have you noticed the most improvement in your work? (Select up to 3)" options={IMPACT_AREAS} selected={impacts} onChange={(v) => { onImpactsChange(v); setError(false); }} otherText={otherText} onOtherTextChange={onOtherTextChange} maxSelections={3} required error={error} lang={lang} />
      <NavigationButtons onBack={onBack} onNext={validate} lang={lang} />
    </div>
  );
}
