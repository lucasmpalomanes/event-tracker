"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { setLocale } from "@/lib/i18n/actions";
import {
  defaultLocale,
  isLocale,
  localeNames,
  locales,
  type Locale,
} from "@/lib/i18n/config";
import { Flag } from "@/components/flags";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

// The home-toolbar language selector (specs/i18n.md §4): flag-only trigger,
// flag + endonym per option. Picking a language stores the cookie and
// refreshes, so the whole server-rendered tree re-renders in place.
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const current: Locale = isLocale(i18n.language) ? i18n.language : defaultLocale;

  function handleValueChange(value: unknown) {
    const next = String(value);
    if (!isLocale(next) || next === current) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <Select value={current} onValueChange={handleValueChange}>
      <SelectTrigger
        size="sm"
        aria-label={t("language")}
        disabled={isPending}
        className="bg-transparent"
      >
        <Flag locale={current} />
      </SelectTrigger>
      <SelectContent className="min-w-44" alignItemWithTrigger={false}>
        {locales.map((locale) => (
          <SelectItem key={locale} value={locale}>
            <Flag locale={locale} />
            {localeNames[locale]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
