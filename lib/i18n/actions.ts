"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "./config";

// Persists the language selector's choice (specs/i18n.md §4). The client
// follows up with router.refresh() so the current tree re-renders in the
// new language.
export async function setLocale(locale: string) {
  if (!isLocale(locale)) throw new Error(`Unsupported locale: ${locale}`);
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
