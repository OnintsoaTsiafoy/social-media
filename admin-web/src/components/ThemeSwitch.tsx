import { useI18n } from "@/i18n";
import { setThemePreference, THEME_PREFERENCES, useThemePreference, type ThemePreference } from "@/lib/theme";

const LABEL_KEYS = {
  system: "theme.system",
  light: "theme.light",
  dark: "theme.dark",
} as const satisfies Record<ThemePreference, string>;

function ThemeGlyph({ value }: { value: ThemePreference }) {
  const common = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true } as const;
  if (value === "light") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (value === "dark") {
    return (
      <svg {...common}>
        <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="1.8" y="2.5" width="12.4" height="8.6" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 13.8h5M8 11.1v2.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Choix du thème de l'interface : système, clair ou sombre (mémorisé dans le navigateur). */
export function ThemeSwitch() {
  const { t } = useI18n();
  const preference = useThemePreference();

  return (
    <div className="locale-switch" role="group" aria-label={t("theme.label")}>
      {THEME_PREFERENCES.map((value) => (
        <button
          type="button"
          key={value}
          className="locale-switch__option theme-switch__option"
          title={t(LABEL_KEYS[value])}
          aria-label={t(LABEL_KEYS[value])}
          aria-pressed={preference === value}
          onClick={() => setThemePreference(value)}
        >
          <ThemeGlyph value={value} />
        </button>
      ))}
    </div>
  );
}
