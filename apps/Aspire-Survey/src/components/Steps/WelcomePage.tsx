import { Button } from '@project/components/ui/button';
import { ClipboardCheck, Clock } from 'lucide-react';
import LanguageToggle from '../LanguageToggle';
import { useLang } from '../../i18n/LanguageContext';
import { t } from '../../i18n/Translations';
import { SURVEY_BRAND_NAME, SURVEY_CONFIG } from '../../survey.config';

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
        <h1 className="text-2xl font-display text-foreground mb-1">{t(SURVEY_BRAND_NAME, lang)}</h1>
        <p className="text-lg text-muted-foreground mb-8">
          {t(SURVEY_CONFIG.title, lang)}
        </p>
        <div className="text-sm text-muted-foreground leading-relaxed mb-6 max-w-lg mx-auto text-left space-y-4">
          <p>
            {t(SURVEY_CONFIG.welcome.introduction, lang)}
          </p>
          <p>{t(SURVEY_CONFIG.welcome.prompt, lang)}</p>
          <ul className="list-disc pl-5 space-y-1">
            {SURVEY_CONFIG.welcome.goals.map((goal) => <li key={goal}>{t(goal, lang)}</li>)}
          </ul>
          <p>
            {t(SURVEY_CONFIG.welcome.privacy, lang)}
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-8">
          <Clock className="w-3.5 h-3.5" />
          <span>{t(`Estimated time: ${SURVEY_CONFIG.estimatedTime}`, lang)}</span>
        </div>
        <Button size="lg" onClick={onStart} className="px-10">
          {t('Begin Survey', lang)}
        </Button>
      </div>
    </div>
  );
}
