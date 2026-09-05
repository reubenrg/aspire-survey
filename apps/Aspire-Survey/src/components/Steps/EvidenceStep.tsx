import { useState } from 'react';
import { EVIDENCE_ATTRIBUTION_OPTIONS, ASPIRE_ATTRIBUTION_OPTIONS } from '../../data/SurveyData';
import TextArea from '../TextArea';
import RadioSelect from '../RadioSelect';
import NavigationButtons from '../NavigationButtons';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  oneThing: string;
  example: string;
  contributedMost: string;
  aspireContribution: string;
  aspireDetail: string;
  contributedMostOther: string;
  onContributedMostOtherChange: (val: string) => void;
  onChange: (key: string, val: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function EvidenceStep({ oneThing, example, contributedMost, aspireContribution, aspireDetail, contributedMostOther, onContributedMostOtherChange, onChange, onNext, onBack }: Props) {
  const { lang } = useLang();
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const showDetail = aspireContribution === 'Yes, significantly' || aspireContribution === 'Yes, to some extent';

  const validate = () => {
    const e = new Set<string>();
    if (!oneThing.trim()) e.add('oneThing');
    if (!example.trim()) e.add('example');
    if (!contributedMost) e.add('contributedMost');
    if (!aspireContribution) e.add('aspireContribution');
    setErrors(e);
    if (e.size === 0) onNext();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clear = (key: string) => setErrors((p) => { const n = new Set(p); n.delete(key); return n; });

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-6">{t('Real Evidence of Change', lang)}</h2>
      <div className="space-y-6">
        <TextArea label="What is ONE thing you do differently at work today compared with April 2026?" value={oneThing} onChange={(v) => { onChange('oneThing', v); clear('oneThing'); }} required error={errors.has('oneThing')} lang={lang} />
        <TextArea label="Give one real example where doing this differently helped you or your team." value={example} onChange={(v) => { onChange('example', v); clear('example'); }} required error={errors.has('example')} hint="For example, it may have helped you solve a problem, avoid an issue, complete work better, improve reliability, save time, communicate better, support someone else or improve a process." lang={lang} />
        <RadioSelect label="What do you believe contributed most to this specific change?" options={EVIDENCE_ATTRIBUTION_OPTIONS} value={contributedMost} onChange={(v) => { onChange('contributedMost', v); clear('contributedMost'); }} otherText={contributedMostOther} onOtherTextChange={onContributedMostOtherChange} required error={errors.has('contributedMost')} lang={lang} />
        <RadioSelect label="Did any Aspire Program habit, task or activity contribute to this specific change?" options={ASPIRE_ATTRIBUTION_OPTIONS} value={aspireContribution} onChange={(v) => { onChange('aspireContribution', v); clear('aspireContribution'); }} required error={errors.has('aspireContribution')} lang={lang} />
        {showDetail && (
          <div className="p-4 bg-muted/50 rounded-lg border border-border/60">
            <TextArea label="Which Aspire Program habit/task/activity helped, and what did it change in the way you work?" value={aspireDetail} onChange={(v) => onChange('aspireDetail', v)} lang={lang} />
          </div>
        )}
      </div>
      <NavigationButtons onBack={onBack} onNext={validate} lang={lang} />
    </div>
  );
}
