import type { Locale } from "@/lib/i18n/config";

// Shared by server and client components (lib/budget.ts is server-only).
// Money is deliberately NOT localized (specs/i18n.md §5): always BRL in the
// Brazilian convention, so every participant of an event sees the same
// "R$ 1.234,56" whatever their UI language.
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

// "2026-11-21" → numeric date in the active locale: "21/11/2026" (pt-BR),
// "11/21/2026" (en), "2026/11/21" (zh-CN), "21. 11. 2026." (bs).
export function formatDay(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${day}T00:00:00Z`));
}

// Calendar month heading: "julho de 2026" / "July 2026" / "2026年7月".
// `month` is 1-based.
export function formatMonthYear(
  year: number,
  month: number,
  locale: Locale
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

// Sunday-first narrow weekday initials for the calendar header row.
export function weekdayInitials(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "narrow",
  });
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    format.format(new Date(Date.UTC(2023, 0, 1 + i)))
  );
}
