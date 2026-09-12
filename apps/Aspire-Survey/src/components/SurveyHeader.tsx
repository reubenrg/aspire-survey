import LanguageToggle from './LanguageToggle';
import { SURVEY_BRAND_NAME } from '../survey.config';

interface Props {
  currentSection: number;
  totalSections: number;
  sectionLabel: string;
}

export default function SurveyHeader({ currentSection, totalSections, sectionLabel }: Props) {
  const progress = Math.round((currentSection / totalSections) * 100);

  return (
    <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
      <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
        <span className="text-sm font-display text-foreground whitespace-nowrap">{SURVEY_BRAND_NAME}</span>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">{sectionLabel}</span>
          <div className="w-20 sm:w-28 h-1.5 bg-muted rounded-full overflow-hidden flex-shrink-0">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs font-medium text-muted-foreground">{progress}%</span>
        </div>
      </div>
    </header>
  );
}
