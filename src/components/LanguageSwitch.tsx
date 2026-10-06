import { useI18n } from "../i18n";

export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();
  return (
    <div className="flex shrink-0 items-center rounded-full border border-border bg-surface-elevated p-0.5 text-xs" role="group" aria-label={t("Interface language")}>
      {([ ["zh-CN", "中文"], ["en", "EN"] ] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={language === value}
          aria-label={value === "zh-CN" ? "切换为中文" : "Switch to English"}
          onClick={() => setLanguage(value)}
          className={`min-h-8 rounded-full px-2.5 font-medium transition-colors ${language === value ? "bg-accent text-white" : "text-muted hover:bg-surface-hover hover:text-text"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
