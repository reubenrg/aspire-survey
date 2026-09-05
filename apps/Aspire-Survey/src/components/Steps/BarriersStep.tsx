import { useState } from 'react';
import { BARRIER_OPTIONS, HELP_OPTIONS } from '../../data/SurveyData';
import RadioSelect from '../RadioSelect';
import NavigationButtons from '../NavigationButtons';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  barrier: string;
  helpOption: string;
  barrierOther: string;
  helpOther: string;
  onBarrierChange: (val: string) => void;
  onHelpChange: (val: string) => void;
  onBarrierOtherChange: (val: string) => void;
  onHelpOtherChange: (val: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function BarriersStep({ barrier, helpOption, barrierOther, helpOther, onBarrierChange, onHelpChange, onBarrierOtherChange, onHelpOtherChange, onNext, onBack }: Props) {
  const { lang } = useLang();
  const [errors, setErrors] = useState<Set<string>>(new Set());

  const validate = () => {
    const e = new Set<string>();
    if (!barrier) e.add('barrier');
    if (!helpOption) e.add('help');
    setErrors(e);
    if (e.size === 0) onNext();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-6">{t('What Is Getting in the Way?', lang)}</h2>
      <div className="space-y-8">
        <RadioSelect label="What is the biggest challenge preventing you from practising your Aspire Program behaviour more consistently?" options={BARRIER_OPTIONS} value={barrier} onChange={(v) => { onBarrierChange(v); setErrors((p) => { const n = new Set(p); n.delete('barrier'); return n; }); }} otherText={barrierOther} onOtherTextChange={onBarrierOtherChange} required error={errors.has('barrier')} lang={lang} />
        <RadioSelect label="What ONE thing would help you practise the behaviour more consistently?" options={HELP_OPTIONS} value={helpOption} onChange={(v) => { onHelpChange(v); setErrors((p) => { const n = new Set(p); n.delete('help'); return n; }); }} otherText={helpOther} onOtherTextChange={onHelpOtherChange} required error={errors.has('help')} lang={lang} />
      </div>
      <NavigationButtons onBack={onBack} onNext={validate} lang={lang} />
    </div>
  );
}

