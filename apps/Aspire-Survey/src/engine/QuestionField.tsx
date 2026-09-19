import type { ReactNode } from 'react';
import RadioSelect from '../components/RadioSelect';
import CheckboxSelect from '../components/CheckBoxSelect';
import LikertMatrix from '../components/LikertMatrix';
import TextArea from '../components/TextArea';
import { NpsInput, RankingInput, RatingInput, SliderInput, YesNoInput } from '../components/ScaleInputs';
import { FileUpload, FullNameInput, ImageChoice, MultiTextInput, SignaturePad, SumInput } from '../components/RichInputs';
import { cn } from '../lib/utils';
import type { Lang } from '../i18n/Translations';
import { useT } from './translate';
import type { Answers, AnswerValue, Question } from './types';
import { matrixRows, matrixTitle, namePartKey, otherKey } from './definition';
import { pipe } from './logic';
import { shuffleOptions } from './randomize';

interface Props {
  question: Question;
  answers: Answers;
  onChange: (key: string, value: AnswerValue) => void;
  /** The message to show under the field, when there is a problem with the answer. */
  error?: string;
  /** Per-session seed for randomised option order. */
  seed: number;
  /** The options on offer right now, when they are computed (carry-forward or per-option rules). */
  resolvedOptions?: string[];
  lang: Lang;
}

const inputCls = (error: boolean) => cn(
  'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors',
  'placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/30',
  error ? 'border-destructive' : 'border-border focus:border-primary/60',
);

/**
 * Renders one question of any type. The original types delegate to the
 * existing input components, so the engine inherits their styling and
 * translation behaviour rather than reimplementing them; the newer scale types
 * use components/ScaleInputs. Labels are translated first and piped second,
 * because the translation table is keyed by the label as authored.
 */
export default function QuestionField({ question: q, answers, onChange, error, seed, lang, resolvedOptions }: Props) {
  const t = useT();
  const hasError = !!error;
  const value = answers[q.id];
  const otherText = (answers[otherKey(q.id)] as string) || '';
  const setOther = (v: string) => onChange(otherKey(q.id), v);
  const label = pipe(t(q.label, lang), answers);
  const hint = q.hint ? pipe(t(q.hint, lang), answers) : undefined;
  const choices = (options: string[]) => resolvedOptions ?? options;
  const opts = (options: string[], randomize?: boolean) => {
    const list = choices(options);
    return randomize ? shuffleOptions(list, seed, q.id) : list;
  };

  const shell = (control: ReactNode, extra?: { labelFor?: string }) => (
    <div className="space-y-2">
      <label htmlFor={extra?.labelFor} className={cn('block text-sm font-medium', hasError ? 'text-destructive' : 'text-foreground')}>
        {label}{q.required && ' *'}
      </label>
      {control}
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      <Problem message={error} lang={lang} />
    </div>
  );

  switch (q.type) {
    case 'text':
      return shell(
        <input
          id={q.id} type="text"
          value={(value as string) || ''}
          maxLength={q.maxLength}
          placeholder={q.placeholder ? t(q.placeholder, lang) : undefined}
          onChange={e => onChange(q.id, e.target.value)}
          aria-invalid={hasError || undefined}
          className={inputCls(hasError)}
        />,
        { labelFor: q.id },
      );

    case 'email':
      return shell(
        <input
          id={q.id} type="email" inputMode="email" autoComplete="email"
          value={(value as string) || ''}
          placeholder={q.placeholder ? t(q.placeholder, lang) : undefined}
          onChange={e => onChange(q.id, e.target.value)}
          aria-invalid={hasError || undefined}
          className={inputCls(hasError)}
        />,
        { labelFor: q.id },
      );

    case 'number':
      return shell(
        <div className="flex items-center gap-2">
          <input
            id={q.id} type="number" inputMode={q.integer ? 'numeric' : 'decimal'}
            value={(value as string) || ''}
            min={q.min} max={q.max} step={q.step ?? (q.integer ? 1 : 'any')}
            placeholder={q.placeholder ? t(q.placeholder, lang) : undefined}
            onChange={e => onChange(q.id, e.target.value)}
            aria-invalid={hasError || undefined}
            className={cn(inputCls(hasError), 'max-w-[12rem]')}
          />
          {q.unit && <span className="text-sm text-muted-foreground">{t(q.unit, lang)}</span>}
        </div>,
        { labelFor: q.id },
      );

    case 'date':
      return shell(
        <input
          id={q.id} type="date"
          value={(value as string) || ''}
          min={q.min} max={q.max}
          onChange={e => onChange(q.id, e.target.value)}
          aria-invalid={hasError || undefined}
          className={cn(inputCls(hasError), 'max-w-[12rem]')}
        />,
        { labelFor: q.id },
      );

    case 'select':
      return shell(
        <select
          id={q.id}
          value={(value as string) || ''}
          onChange={e => onChange(q.id, e.target.value)}
          aria-invalid={hasError || undefined}
          className={inputCls(hasError)}
        >
          <option value="">{q.placeholder ? t(q.placeholder, lang) : ''}</option>
          {opts(q.options, q.randomize).map(opt => (
            <option key={opt} value={opt}>{t(opt, lang)}</option>
          ))}
        </select>,
        { labelFor: q.id },
      );

    case 'textarea':
      return (
        <div className="space-y-2">
          <TextArea
            label={label}
            hint={hint}
            value={(value as string) || ''}
            onChange={v => onChange(q.id, v)}
            required={q.required}
            error={hasError}
            lang={lang}
          />
          <Problem message={error} lang={lang} />
        </div>
      );

    case 'radio':
      return (
        <div className="space-y-2">
          <RadioSelect
            label={label}
            options={opts(q.options, q.randomize)}
            value={(value as string) || ''}
            onChange={v => onChange(q.id, v)}
            otherText={q.otherColumn ? otherText : undefined}
            onOtherTextChange={q.otherColumn ? setOther : undefined}
            required={q.required}
            error={hasError}
            lang={lang}
          />
          {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
          <Problem message={error} lang={lang} />
        </div>
      );

    case 'checkbox':
      return (
        <div className="space-y-2">
          <CheckboxSelect
            label={label}
            options={opts(q.options, q.randomize)}
            selected={(value as string[]) || []}
            onChange={v => onChange(q.id, v)}
            otherText={q.otherColumn ? otherText : undefined}
            onOtherTextChange={q.otherColumn ? setOther : undefined}
            maxSelections={q.maxSelections}
            required={q.required}
            error={hasError}
            lang={lang}
          />
          {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
          <Problem message={error} lang={lang} />
        </div>
      );

    case 'yesno':
      return shell(
        <YesNoInput
          value={(value as string) || ''} label={label}
          yes={t(q.yesLabel || 'Yes', lang)} no={t(q.noLabel || 'No', lang)}
          onChange={v => onChange(q.id, v)}
        />,
      );

    case 'rating':
      return shell(
        <RatingInput
          value={(value as string) || ''} label={label}
          max={Math.min(10, Math.max(3, q.max ?? 5))} shape={q.shape ?? 'star'}
          low={q.lowLabel ? t(q.lowLabel, lang) : undefined} high={q.highLabel ? t(q.highLabel, lang) : undefined}
          onChange={v => onChange(q.id, v)}
        />,
      );

    case 'nps':
      return shell(
        <NpsInput
          value={(value as string) || ''} label={label}
          low={q.lowLabel ? t(q.lowLabel, lang) : undefined} high={q.highLabel ? t(q.highLabel, lang) : undefined}
          onChange={v => onChange(q.id, v)}
        />,
      );

    case 'slider':
      return shell(
        <SliderInput
          value={(value as string) || ''} label={label} error={hasError}
          min={q.min ?? 0} max={q.max ?? 100} step={q.step && q.step > 0 ? q.step : 1}
          unit={q.unit ? t(q.unit, lang) : undefined}
          low={q.lowLabel ? t(q.lowLabel, lang) : undefined} high={q.highLabel ? t(q.highLabel, lang) : undefined}
          onChange={v => onChange(q.id, v)}
        />,
      );

    case 'ranking': {
      const given = Array.isArray(value) ? (value as string[]) : null;
      return shell(
        <RankingInput
          label={label} options={choices(q.options)}
          order={given ?? opts(q.options, q.randomize)}
          confirmed={!!given}
          showOption={o => t(o, lang)}
          onChange={next => onChange(q.id, next)}
        />,
      );
    }

    case 'heading':
      return (
        <div className="space-y-1.5 border-b border-border pb-3 pt-2">
          <h3 className="font-display text-lg text-foreground">{label}</h3>
          {hint && <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
      );

    case 'phone':
      return shell(
        <input
          id={q.id} type="tel" inputMode="tel" autoComplete="tel"
          value={(value as string) || ''}
          placeholder={q.placeholder ? t(q.placeholder, lang) : undefined}
          onChange={e => onChange(q.id, e.target.value)}
          aria-invalid={hasError || undefined}
          className={inputCls(hasError)}
        />,
        { labelFor: q.id },
      );

    case 'fullname': {
      const first = (answers[namePartKey(q.id, 'first')] as string) || '';
      const last = (answers[namePartKey(q.id, 'last')] as string) || '';
      return shell(
        <FullNameInput
          first={first} last={last} error={hasError}
          onChange={(f, l) => {
            onChange(namePartKey(q.id, 'first'), f);
            onChange(namePartKey(q.id, 'last'), l);
            onChange(q.id, `${f.trim()} ${l.trim()}`.trim());
          }}
        />,
      );
    }

    case 'sum':
      return shell(
        <SumInput
          rows={q.rows} total={q.total} unit={q.unit} label={label} error={hasError}
          values={(value as Record<string, string>) || {}}
          onChange={next => onChange(q.id, next)}
        />,
      );

    case 'multitext':
      return shell(
        <MultiTextInput
          rows={q.rows} label={label} error={hasError}
          values={(value as Record<string, string>) || {}}
          onChange={next => onChange(q.id, next)}
        />,
      );

    case 'image': {
      const list = opts(q.options, q.randomize);
      const chosen = Array.isArray(value) ? (value as string[]) : typeof value === 'string' && value ? [value] : [];
      return shell(
        <ImageChoice
          options={list} images={q.images ?? []} multiple={!!q.multiple} value={chosen} label={label}
          showOption={o => t(o, lang)}
          onChange={next => onChange(q.id, q.multiple ? next : next[0])}
        />,
      );
    }

    case 'file':
      return shell(
        <FileUpload
          value={(value as string) || ''} maxSizeMb={q.maxSizeMb ?? 5} accept={q.accept ?? 'any'} label={label} error={hasError}
          onChange={path => onChange(q.id, path)}
        />,
      );

    case 'signature':
      return shell(<SignaturePad value={(value as string) || ''} label={label} error={hasError} onChange={path => onChange(q.id, path)} />);

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
          <p className={cn('text-sm', hasError ? 'text-destructive' : 'text-muted-foreground')}>
            {label}{q.required && ' *'}
          </p>
          <LikertMatrix
            statements={statements}
            scaleLabels={q.scale}
            answers={answersById}
            onChange={(id, val) => onChange(q.id, { ...given, [rows[id]]: val })}
            errors={hasError ? new Set(statements.filter(s => !given[s.text]).map(s => s.id)) : undefined}
            lang={lang}
          />
          <Problem message={error} lang={lang} />
        </div>
      );
    }
  }
}

function Problem({ message, lang }: { message?: string; lang: Lang }) {
  const t = useT();
  if (!message) return null;
  return <p role="alert" className="text-xs text-destructive">{t(message, lang)}</p>;
}
