import { cn } from '@project/components/lib/utils';
import { ROLES, LOCATIONS } from '../../data/SurveyData';
import NavigationButtons from '../NavigationButtons';
import { useState } from 'react';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

export interface AboutYouData {
  employeeId: string;
  employeeName: string;
  role: string;
  location: string;
}

interface Props {
  data: AboutYouData;
  onChange: (data: AboutYouData) => void;
  onNext: () => void;
}

export default function AboutYouStep({ data, onChange, onNext }: Props) {
  const { lang } = useLang();
  const [errors, setErrors] = useState<Set<string>>(new Set());

  const set = (key: keyof AboutYouData, val: string) => {
    onChange({ ...data, [key]: val });
    setErrors((prev) => { const n = new Set(prev); n.delete(key); return n; });
  };

  const validate = () => {
    const e = new Set<string>();
    if (!data.employeeId.trim()) e.add('employeeId');
    if (!data.employeeName.trim()) e.add('employeeName');
    if (!data.role) e.add('role');
    if (!data.location) e.add('location');
    setErrors(e);
    if (e.size === 0) onNext();
  };

  const inputCls = (key: string) => cn(
    'w-full border rounded-md px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/30',
    errors.has(key) ? 'border-destructive' : 'border-border'
  );

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h2 className="text-xl font-display text-foreground mb-1">{t('About You', lang)}</h2>
      <p className="text-sm text-muted-foreground mb-6">{t('All fields are required.', lang)}</p>
      <div className="space-y-5">
        <div>
          <label className={cn('text-sm font-medium block mb-1.5', errors.has('employeeId') ? 'text-destructive' : 'text-foreground')}>{t('Employee ID', lang)} *</label>
          <input className={inputCls('employeeId')} value={data.employeeId} onChange={(e) => set('employeeId', e.target.value)} placeholder="e.g. 1234" />
        </div>
        <div>
          <label className={cn('text-sm font-medium block mb-1.5', errors.has('employeeName') ? 'text-destructive' : 'text-foreground')}>{t('Employee Name', lang)} *</label>
          <input className={inputCls('employeeName')} value={data.employeeName} onChange={(e) => set('employeeName', e.target.value)} placeholder={t('Your full name', lang)} />
        </div>
        <div>
          <label className={cn('text-sm font-medium block mb-1.5', errors.has('role') ? 'text-destructive' : 'text-foreground')}>{t('Aspire Team / Role', lang)} *</label>
          <select className={inputCls('role')} value={data.role} onChange={(e) => set('role', e.target.value)}>
            <option value="">{t('Select your role…', lang)}</option>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className={cn('text-sm font-medium block mb-1.5', errors.has('location') ? 'text-destructive' : 'text-foreground')}>{t('Work Location', lang)} *</label>
          <select className={inputCls('location')} value={data.location} onChange={(e) => set('location', e.target.value)}>
            <option value="">{t('Select location…', lang)}</option>
            {LOCATIONS.map((l) => <option key={l} value={l}>{t(l, lang)}</option>)}
          </select>
        </div>
      </div>
      <NavigationButtons onNext={validate} showBack={false} lang={lang} />
    </div>
  );
}
