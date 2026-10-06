import { useI18n } from "../i18n";

export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();
  const next = language === "zh-CN" ? "en" : "zh-CN";
  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      className="icon-circle"
      title={t("Switch language (currently {0})", language === "zh-CN" ? "中文" : "English")}
      aria-label={
        language === "zh-CN"
          ? "Switch to English"
          : "切换为中文"
      }
    >
      <span className="text-[11px] font-semibold leading-none">文A</span>
    </button>
  );
}
