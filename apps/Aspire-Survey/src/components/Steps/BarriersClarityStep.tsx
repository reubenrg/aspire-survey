import { useState } from 'react';
import { BARRIER_OPTIONS, HELP_OPTIONS, PMS_CLARITY_OPTIONS } from '../../data/SurveyData';
import RadioSelect from '../RadioSelect';
import NavigationButtons from '../NavigationButtons';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  barrier: string;
  helpOption: string;
  barrierOther: string;
  helpOther: string;
  pmsClarity: string;
  onBarrierChange: (val: string) => void;
  onHelpChange: (val: string) => void;
  onBarrierOtherChange: (val: string) => void;
  onHelpOtherChange: (val: string) => void;
  onPmsClarityChange: (val: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function BarriersClarityStep({
  barrier, helpOption, barrierOther, helpOther, pmsClarity,
  onBarrierChange, onHelpChange, onBarrierOtherChange, onHelpOtherChange, onPmsClarityChange,
  onNext, onBack,
}: Props) {
  const { lang } = useLang();
  const [errors, setErrors] = useState<Set<string>>(new Set());

  const validate = () => {
    const e = new Set<string>();
    if (!barrier) e.add('barrier');
    if (!helpOption) e.add('help');
    if (!pmsClarity) e.add('pms');
    setErrors(e);
    if (e.size === 0) onNext();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clear = (key: string) => setErrors((p) => { const n = new Set(p); n.delete(key); return n; });

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-6">{t('Barriers and Performance Clarity', lang)}</h2>
      <div className="space-y-8">
        <RadioSelect label="What is the biggest challenge preventing you from practising your Aspire Program behaviour more consistently?" options={BARRIER_OPTIONS} value={barrier} onChange={(v) => { onBarrierChange(v); clear('barrier'); }} otherText={barrierOther} onOtherTextChange={onBarrierOtherChange} required error={errors.has('barrier')} lang={lang} />
        <RadioSelect label="What ONE thing would help you practise the behaviour more consistently?" options={HELP_OPTIONS} value={helpOption} onChange={(v) => { onHelpChange(v); clear('help'); }} otherText={helpOther} onOtherTextChange={onHelpOtherChange} required error={errors.has('help')} lang={lang} />
        <RadioSelect label="How clear are you today about what you need to improve in your role?" options={PMS_CLARITY_OPTIONS} value={pmsClarity} onChange={(v) => { onPmsClarityChange(v); clear('pms'); }} required error={errors.has('pms')} lang={lang} />
      </div>
      <NavigationButtons onBack={onBack} onNext={validate} lang={lang} />
    </div>
  );
}
