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
      <h2 className="text-xl font-display text-foreground mb-4">{t('Final Question', lang)}</h2>

      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        {t('Think about what is currently stopping you from performing at your best level at work.', lang)}
      </p>

      {/* Scope sits above the box deliberately: respondents should read the
          constraint before they start writing, not after. */}
      <div className="mb-6 rounded-lg border-l-4 border-l-primary/50 border border-border/60 bg-muted/40 px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('Focus only on your work performance — not facilities, food, transport, or general workplace amenities.', lang)}
        </p>
      </div>

      <TextArea
        label="If ONE thing could change in the way your performance is guided, supported, developed, reviewed, or improved, what should that ONE thing be?"
        hint="Explain what needs to change and how that change would help you deliver better results in your role."
        value={value}
        onChange={(v) => { onChange(v); setError(false); }}
        required
        error={error}
        lang={lang}
      />

      <NavigationButtons onBack={onBack} onNext={validate} nextLabel="Submit Survey" isSubmitting={isSubmitting} lang={lang} />
    </div>
  );
}
