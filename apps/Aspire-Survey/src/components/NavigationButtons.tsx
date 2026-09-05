import { Button } from '@project/components/ui/button';
import { t, type Lang } from '../i18n/Translations';

interface Props {
  onBack?: () => void;
  onNext?: () => void;
  showBack?: boolean;
  nextLabel?: string;
  isSubmitting?: boolean;
  lang?: Lang;
}

export default function NavigationButtons({ onBack, onNext, showBack = true, nextLabel, isSubmitting, lang = 'en' }: Props) {
  const submitLabel = nextLabel || 'Next';
  const displayLabel = isSubmitting ? t('Submitting…', lang) : t(submitLabel, lang);

  return (
    <div className="flex items-center justify-between mt-8">
      {showBack && onBack ? (
        <Button variant="ghost" onClick={onBack} type="button">
          {t('Back', lang)}
        </Button>
      ) : <div />}
      {onNext && (
        <Button onClick={onNext} disabled={isSubmitting}>
          {displayLabel}
        </Button>
      )}
    </div>
  );
}

