import { cn } from '@project/components/lib/utils';
import { t, type Lang } from '../i18n/Translations';

interface Props {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  otherText?: string;
  onOtherTextChange?: (val: string) => void;
  maxSelections?: number;
  required?: boolean;
  error?: boolean;
  lang?: Lang;
}

export default function CheckboxSelect({ label, options, selected, onChange, otherText, onOtherTextChange, maxSelections, required, error, lang = 'en' }: Props) {
  const atMax = maxSelections ? selected.length >= maxSelections : false;
  const isOtherSelected = selected.includes('Other');

  const toggle = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((s) => s !== opt));
    } else if (!atMax) {
      onChange([...selected, opt]);
    }
  };

  return (
    <div className="space-y-2.5">
      <label className={cn('text-sm font-medium block', error ? 'text-destructive' : 'text-foreground')}>
        {t(label, lang)}{required && ' *'}
      </label>
      {atMax && (
        <p className="text-xs text-muted-foreground">{lang === 'en' ? `Maximum ${maxSelections} selections reached.` : lang === 'ta' ? `அதிகபட்சம் ${maxSelections} தேர்வுகள் எட்டப்பட்டன.` : `अधिकतम ${maxSelections} चयन हो चुके हैं।`}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {options.map((opt) => {
          const checked = selected.includes(opt);
          const disabled = atMax && !checked;
          return (
            <div key={opt} className={opt === 'Other' ? 'sm:col-span-2' : ''}>
              <label
                className={cn(
                  'flex items-center gap-2.5 p-2.5 rounded-md border text-sm cursor-pointer transition-colors',
                  checked ? 'border-primary bg-primary/5' : 'border-border',
                  disabled && 'opacity-40 cursor-not-allowed'
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                  disabled={disabled}
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
          );
        })}
      </div>
    </div>
  );
}
