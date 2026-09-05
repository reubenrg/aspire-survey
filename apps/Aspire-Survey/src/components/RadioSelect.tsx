import { cn } from '@project/components/lib/utils';
import { t, type Lang } from '../i18n/Translations';

interface Props {
  label: string;
  options: string[];
  value: string;
  onChange: (val: string) => void;
  otherText?: string;
  onOtherTextChange?: (val: string) => void;
  required?: boolean;
  error?: boolean;
  lang?: Lang;
}

export default function RadioSelect({ label, options, value, onChange, otherText, onOtherTextChange, required, error, lang = 'en' }: Props) {
  const isOtherSelected = value === 'Other';

  return (
    <div className="space-y-2.5">
      <label className={cn('text-sm font-medium block', error ? 'text-destructive' : 'text-foreground')}>
        {t(label, lang)}{required && ' *'}
      </label>
      <div className="space-y-1.5">
        {options.map((opt) => (
          <div key={opt}>
            <label
              className={cn(
                'flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors text-sm',
                value === opt
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border hover:border-primary/40 text-foreground'
              )}
            >
              <input
                type="radio"
                checked={value === opt}
                onChange={() => onChange(opt)}
                className="w-4 h-4 accent-primary flex-shrink-0"
              />
              <span className="leading-snug">{t(opt, lang)}</span>
            </label>
            {opt === 'Other' && isOtherSelected && onOtherTextChange && (
              <input
                type="text"
                value={otherText || ''}
                onChange={(e) => onOtherTextChange(e.target.value)}
                placeholder={t('Please specify…', lang)}
                className="mt-1.5 ml-7 w-[calc(100%-1.75rem)] border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

