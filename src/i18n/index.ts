import { useSyncExternalStore } from "react";
import chinese from "./zh-CN.json";

export type Language = "zh-CN" | "en";
let language: Language = "en";
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

/** Initial page language comes from settings.json, not a browser preference. */
export function initializeLanguage(value: unknown) {
  if (!chosenByUser) publish(isLanguage(value) ? value : "zh-CN");
}

/** Switching affects this open page; reload uses the configured default again. */
export function setLanguage(next: Language) {
  chosenByUser = true;
  publish(next);
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
