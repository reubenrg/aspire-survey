import { cn } from '@project/components/lib/utils';
import { t, type Lang } from '../i18n/Translations';

interface Props {
	label: string;
	value: string;
	onChange: (value: string) => void;
	hint?: string;
	required?: boolean;
	error?: boolean;
	lang?: Lang;
}

export default function TextArea({ label, value, onChange, hint, required, error, lang = 'en' }: Props) {
	return (
		<div className="space-y-2">
			<label className={cn('text-sm font-medium block', error ? 'text-destructive' : 'text-foreground')}>
				{t(label, lang)}{required && ' *'}
			</label>
			<textarea
				value={value}
				onChange={(event) => onChange(event.target.value)}
				rows={4}
				aria-invalid={error || undefined}
				className={cn(
					'w-full resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors',
					'placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/30',
					error ? 'border-destructive' : 'border-border focus:border-primary/60',
				)}
			/>
			{hint && <p className="text-xs leading-relaxed text-muted-foreground">{t(hint, lang)}</p>}
			{error && <p className="text-xs text-destructive">{t('Please provide an answer.', lang)}</p>}
		</div>
	);
}
