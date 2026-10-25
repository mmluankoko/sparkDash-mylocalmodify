import { useSyncExternalStore } from "react";
import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import chinese from "./zh-CN.json";
import enSettings from "../locales/en/settings.json";
import zhSettings from "../locales/zh-CN/settings.json";
import enLanguage from "../locales/en/language.json";
import zhLanguage from "../locales/zh-CN/language.json";

export type Locale = "en" | "zh-CN";
export type Language = Locale;
export const LOCALE_STORAGE_KEY = "sparkdash-locale";

export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const tag = value.toLowerCase().replace(/_/g, "-");
  if (tag === "en" || tag.startsWith("en-")) return "en";
  if (tag === "zh" || tag === "zh-cn" || tag === "zh-sg" || tag === "zh-my" || tag === "zh-hans" || tag.startsWith("zh-hans-")) return "zh-CN";
  return null;
}

export function detectLocale(): Locale {
  try {
    const stored = normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
    if (stored) return stored;
  } catch { /* Browser storage is optional. */ }
  return normalizeLocale(typeof navigator === "undefined" ? null : navigator.language) ?? "en";
}

const initialLocale = detectLocale();

// One bundled loader for this small foundation. English catalogs are the source
// of truth; subsequent pages add namespaces rather than parallel loaders.
export const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources: {
    en: { settings: enSettings, language: enLanguage },
    "zh-CN": { settings: zhSettings, language: zhLanguage },
  },
  lng: initialLocale,
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"],
  load: "currentOnly",
  defaultNS: "settings",
  ns: ["settings", "language"],
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  initAsync: false,
});

let language: Language = initialLocale;
let chosenByUser = false;
const listeners = new Set<() => void>();

export function isLanguage(value: unknown): value is Language {
  return value === "zh-CN" || value === "en";
}

function publish(next: Language) {
  language = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

/** Initial page language comes from settings.json unless a locale was saved. */
export function initializeLanguage(value: unknown) {
  if (chosenByUser) return;
  let next = isLanguage(value) ? value : "zh-CN";
  try {
    next = normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY)) ?? next;
  } catch { /* Browser storage is optional. */ }
  publish(next);
  void i18n.changeLanguage(next);
}

/** Switching affects this open page; reload uses the configured default again. */
export function setLanguage(next: Language) {
  chosenByUser = true;
  publish(next);
  void i18n.changeLanguage(next);
}

export function translate(text: string, locale: Language, ...values: unknown[]): string {
  const key = text.trim();
  if (!key) return text;
  const dictionary = chinese as Record<string, string>;
  const translated = locale === "zh-CN" ? dictionary[key] ?? key : key;
  const prefix = text.match(/^\s*/)?.[0] ?? "";
  const suffix = text.match(/\s*$/)?.[0] ?? "";
  return prefix + translated.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? "") : match
  ) + suffix;
}

export function t(text: string, ...values: unknown[]): string {
  return translate(text, language, ...values);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useI18n() {
  const current = useSyncExternalStore(subscribe, () => language, () => "en" as Language);
  return { language: current, setLanguage, t };
}

function updateDocumentLanguage() {
  publish(isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : "en");
}
i18n.on("languageChanged", updateDocumentLanguage);
updateDocumentLanguage();

export async function setLocale(locale: Locale): Promise<void> {
  chosenByUser = true;
  await i18n.changeLanguage(locale);
  publish(locale);
  try { localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Switching still works without storage. */ }
}
