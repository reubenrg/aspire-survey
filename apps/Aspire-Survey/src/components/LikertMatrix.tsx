import { cn } from '@project/components/lib/utils';
import { t, type Lang } from '../i18n/Translations';

interface Props {
  statements: { id: number; text: string }[];
  scaleLabels: string[];
  answers: Record<number, string>;
  onChange: (questionId: number, value: string) => void;
  errors?: Set<number>;
  lang?: Lang;
}

export default function LikertMatrix({ statements, scaleLabels, answers, onChange, errors, lang = 'en' }: Props) {
  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-sm min-w-[600px]">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 pr-3 w-[40%]" />
            {scaleLabels.map((label) => (
              <th key={label} className="text-center py-2 px-1 text-[11px] font-medium text-muted-foreground leading-tight max-w-[80px]">
                {t(label, lang)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {statements.map((s) => {
            const hasError = errors?.has(s.id);
            return (
              <tr key={s.id} className={cn('border-b border-border/60 transition-colors', hasError && 'bg-destructive/5')}>
                <td className={cn('py-3 pr-3 text-foreground text-[13px] leading-snug', hasError && 'text-destructive')}>
                  {t(s.text, lang)}
                </td>
                {scaleLabels.map((label) => (
                  <td key={label} className="text-center py-3 px-1">
                    <label className="flex items-center justify-center cursor-pointer">
                      <input
                        type="radio"
                        name={`q${s.id}`}
                        checked={answers[s.id] === label}
                        onChange={() => onChange(s.id, label)}
                        className="w-4 h-4 accent-primary cursor-pointer"
                      />
                    </label>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
