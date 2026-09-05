import { Button } from '@project/components/ui/button';
import { ClipboardCheck, Clock } from 'lucide-react';
import LanguageToggle from '../LanguageToggle';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';

interface Props {
  onStart: () => void;
}

export default function WelcomePage({ onStart }: Props) {
  const { lang } = useLang();

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <div className="flex justify-center mb-6">
          <LanguageToggle />
        </div>
        <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <ClipboardCheck className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-2xl font-display text-foreground mb-1">{t('S2M Health × Aspire', lang)}</h1>
        <p className="text-lg text-muted-foreground mb-8">
          {t('Behaviour & Performance Impact Survey — 2026', lang)}
        </p>
        <div className="text-sm text-muted-foreground leading-relaxed mb-6 max-w-lg mx-auto text-left space-y-4">
          <p>
            {t('Since April 2026, the Aspire Program has been working with S2M Health employees through role-specific habit formation programs designed to strengthen day-to-day workplace behaviours and improve how work is approached, managed and completed.', lang)}
          </p>
          <p>{t('This survey is intended to understand:', lang)}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('What has changed in the way you work?', lang)}</li>
            <li>{t('What has helped create that change?', lang)}</li>
            <li>{t('How much the Aspire Program has contributed to those changes?', lang)}</li>
            <li>{t('What is helping or limiting consistent behaviour? and', lang)}</li>
            <li>{t('What support would help you perform your role better?', lang)}</li>
          </ul>
          <p>
            {t('The survey is focused on your actual work experience. There are no right or wrong answers, and honest responses will help S2M Health and the Aspire Program identify what is working well, where stronger support is needed, and how the program can be improved further.', lang)}
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-8">
          <Clock className="w-3.5 h-3.5" />
          <span>{t('Estimated time: 8–10 minutes', lang)}</span>
        </div>
        <Button size="lg" onClick={onStart} className="px-10">
          {t('Begin Survey', lang)}
        </Button>
      </div>
    </div>
  );
}
