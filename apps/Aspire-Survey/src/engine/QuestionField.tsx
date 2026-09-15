import RadioSelect from '../components/RadioSelect';
import CheckboxSelect from '../components/CheckBoxSelect';
import LikertMatrix from '../components/LikertMatrix';
import TextArea from '../components/TextArea';
import { cn } from '../lib/utils';
import { t, type Lang } from '../i18n/Translations';
import type { Answers, AnswerValue, Question } from './types';
import { matrixRows, matrixTitle, otherKey } from './definition';

interface Props {
  question: Question;
  answers: Answers;
  onChange: (key: string, value: AnswerValue) => void;
  error: boolean;
  lang: Lang;
}

/**
 * Renders one question of any type by delegating to the existing input
 * components, so the engine inherits their styling, validation display and
 * translation behaviour rather than reimplementing them.
 */
export default function QuestionField({ question: q, answers, onChange, error, lang }: Props) {
  const value = answers[q.id];
  const otherText = (answers[otherKey(q.id)] as string) || '';
  const setOther = (v: string) => onChange(otherKey(q.id), v);

  switch (q.type) {
    case 'text':
      return (
        <div className="space-y-2">
          <label className={cn('text-sm font-medium block', error ? 'text-destructive' : 'text-foreground')}>
            {t(q.label, lang)}{q.required && ' *'}
          </label>
          <input
            type="text"
            value={(value as string) || ''}
            placeholder={q.placeholder ? t(q.placeholder, lang) : undefined}
            onChange={e => onChange(q.id, e.target.value)}
            aria-invalid={error || undefined}
            className={cn(
              'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors',
              'placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/30',
              error ? 'border-destructive' : 'border-border focus:border-primary/60',
            )}
          />
          {q.hint && <p className="text-xs leading-relaxed text-muted-foreground">{t(q.hint, lang)}</p>}
        </div>
      );

    case 'select':
      return (
        <div className="space-y-2">
          <label className={cn('text-sm font-medium block', error ? 'text-destructive' : 'text-foreground')}>
            {t(q.label, lang)}{q.required && ' *'}
          </label>
          <select
            value={(value as string) || ''}
            onChange={e => onChange(q.id, e.target.value)}
            aria-invalid={error || undefined}
            className={cn(
              'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors',
              error ? 'border-destructive' : 'border-border focus:border-primary/60',
            )}
          >
            <option value="">{q.placeholder ? t(q.placeholder, lang) : ''}</option>
            {q.options.map(opt => (
              <option key={opt} value={opt}>{t(opt, lang)}</option>
            ))}
          </select>
        </div>
      );

    case 'textarea':
      return (
        <TextArea
          label={q.label}
          hint={q.hint}
          value={(value as string) || ''}
          onChange={v => onChange(q.id, v)}
          required={q.required}
          error={error}
          lang={lang}
        />
      );

    case 'radio':
      return (
        <RadioSelect
          label={q.label}
          options={q.options}
          value={(value as string) || ''}
          onChange={v => onChange(q.id, v)}
          otherText={q.otherColumn ? otherText : undefined}
          onOtherTextChange={q.otherColumn ? setOther : undefined}
          required={q.required}
          error={error}
          lang={lang}
        />
      );

    case 'checkbox':
      return (
        <CheckboxSelect
          label={q.label}
          options={q.options}
          selected={(value as string[]) || []}
          onChange={v => onChange(q.id, v)}
          otherText={q.otherColumn ? otherText : undefined}
          onOtherTextChange={q.otherColumn ? setOther : undefined}
          maxSelections={q.maxSelections}
          required={q.required}
          error={error}
          lang={lang}
        />
      );

    case 'matrix': {
      const rows = matrixRows(q, answers);
      const title = matrixTitle(q, answers);
      const given = (value as Record<string, string>) || {};
      const statements = rows.map((text, id) => ({ id, text }));
      const answersById: Record<number, string> = {};
      rows.forEach((row, i) => { if (given[row]) answersById[i] = given[row]; });

      return (
        <div className="space-y-3">
          {title && <h3 className="text-sm font-medium text-foreground">{t(title, lang)}</h3>}
          <p className={cn('text-sm', error ? 'text-destructive' : 'text-muted-foreground')}>
            {t(q.label, lang)}{q.required && ' *'}
          </p>
          <LikertMatrix
            statements={statements}
            scaleLabels={q.scale}
            answers={answersById}
            onChange={(id, val) => onChange(q.id, { ...given, [rows[id]]: val })}
            errors={error ? new Set(statements.filter(s => !given[s.text]).map(s => s.id)) : undefined}
            lang={lang}
          />
        </div>
      );
    }
  }
}
