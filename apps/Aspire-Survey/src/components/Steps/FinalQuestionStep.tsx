import { useState } from 'react';
import TextArea from '../TextArea';
import NavigationButtons from '../NavigationButtons';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}

export default function FinalQuestionStep({ value, onChange, onSubmit, onBack, isSubmitting }: Props) {
  const { lang } = useLang();
  const [error, setError] = useState(false);

  const validate = () => {
    if (!value.trim()) { setError(true); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    onSubmit();
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-6">{t('Final Question', lang)}</h2>
      <TextArea label="If the Aspire Program or S2M could change ONE thing that would help you perform your role better, what should it be?" value={value} onChange={(v) => { onChange(v); setError(false); }} required error={error} lang={lang} />
      <NavigationButtons onBack={onBack} onNext={validate} nextLabel="Submit Survey" isSubmitting={isSubmitting} lang={lang} />
    </div>
  );
}

