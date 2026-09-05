import { useState } from 'react';
import { ROLE_QUESTIONS, AGREE_SCALE } from '../../data/SurveyData';
import LikertMatrix from '../LikertMatrix';
import NavigationButtons from '../NavigationButtons';
import { Badge } from '@project/components/ui/badge';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  role: string;
  answers: Record<string, string>;
  onChange: (row: string, val: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function RoleStep({ role, answers, onChange, onNext, onBack }: Props) {
  const { lang } = useLang();
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const roleData = ROLE_QUESTIONS[role];

  if (!roleData) return null;

  const statements = roleData.statements.map((s, i) => ({ id: i, text: s }));
  const matrixById: Record<number, string> = {};
  roleData.statements.forEach((s, i) => { if (answers[s]) matrixById[i] = answers[s]; });
  const errorIds = new Set<number>();
  roleData.statements.forEach((s, i) => { if (errors.has(s)) errorIds.add(i); });

  const validate = () => {
    const e = new Set<string>();
    roleData.statements.forEach((s) => { if (!answers[s]) e.add(s); });
    setErrors(e);
    if (e.size === 0) onNext();
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <Badge variant="secondary" className="mb-2">{role}</Badge>
      <h2 className="text-xl font-display text-foreground mb-1">{t('Role-Specific:', lang)} {t(roleData.title, lang)}</h2>
      <p className="text-sm text-muted-foreground mb-6">{t('Indicate how much you agree with each statement.', lang)}</p>
      <LikertMatrix statements={statements} scaleLabels={AGREE_SCALE} answers={matrixById} onChange={(id, val) => { onChange(roleData.statements[id], val); setErrors((p) => { const n = new Set(p); n.delete(roleData.statements[id]); return n; }); }} errors={errorIds} lang={lang} />
      <NavigationButtons onBack={onBack} onNext={validate} lang={lang} />
    </div>
  );
}
