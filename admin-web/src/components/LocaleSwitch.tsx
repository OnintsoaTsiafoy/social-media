import { LOCALES, useI18n, type Locale } from "@/i18n";

const NAMES: Record<Locale, string> = { fr: "Français", en: "English" };

/** Choix de la langue de l'interface (mémorisé dans le navigateur). */
export function LocaleSwitch() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="locale-switch" role="group" aria-label={t("common.language")}>
      {LOCALES.map((code) => (
        <button
          type="button"
          key={code}
          className="locale-switch__option"
          lang={code}
          title={NAMES[code]}
          aria-label={NAMES[code]}
          aria-pressed={locale === code}
          onClick={() => setLocale(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
