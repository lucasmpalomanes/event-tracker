// Shared i18n constants — importable from client and server code
// (specs/i18n.md §3). pt-BR is default and fallback: the audience is
// Brazilian (specs/i18n.md §7).
export const locales = ["pt-BR", "en", "zh-CN", "bs"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "pt-BR";

export const localeNames: Record<Locale, string> = {
  "pt-BR": "Português",
  en: "English",
  "zh-CN": "中文",
  bs: "Bosanski",
};

export const LOCALE_COOKIE = "NEXT_LOCALE";

export const namespaces = [
  "common",
  "home",
  "event",
  "budget",
  "payment",
] as const;
export type Namespace = (typeof namespaces)[number];

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
