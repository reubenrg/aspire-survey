import { useLang } from '../i18n/LanguageContext';
import { LANG_LABELS, type Lang } from '../i18n/Translations';

export default function LanguageToggle() {
  const { lang, setLang } = useLang();
  const langs: Lang[] = ['en', 'ta', 'hi'];

  return (
    <div className="flex items-center gap-1 bg-muted/60 rounded-full p-0.5">
      {langs.map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            lang === l
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
