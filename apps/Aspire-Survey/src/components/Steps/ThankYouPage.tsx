import { CheckCircle } from 'lucide-react';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

export default function ThankYouPage() {
  const { lang } = useLang();
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-xl font-display text-foreground mb-3">
          {t('Thank You!', lang)}
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t('Your response has been recorded.', lang)}
        </p>
        <p className="text-sm text-muted-foreground mt-4 leading-relaxed">
          {t('Thank you for taking the time to complete this survey. Your honest feedback helps S2M Health and Aspire improve the program for everyone.', lang)}
        </p>
      </div>
    </div>
  );
}
