import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createInstance, type i18n } from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  locales,
  namespaces,
  type Locale,
  type Namespace,
} from "./config";

// Active locale for this request (specs/i18n.md §3): NEXT_LOCALE cookie,
// then Accept-Language negotiation, then pt-BR. No locale in the URL —
// language is a user preference, not content identity.
export const resolveLocale = cache(async (): Promise<Locale> => {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (fromCookie && isLocale(fromCookie)) return fromCookie;

  const acceptLanguage = (await headers()).get("accept-language");
  if (acceptLanguage) {
    const requested = new Negotiator({
      headers: { "accept-language": acceptLanguage },
    }).languages();
    try {
      return match(requested, locales, defaultLocale) as Locale;
    } catch {
      // Malformed header — fall through to the default.
    }
  }
  return defaultLocale;
});

const loadResources = resourcesToBackend(
  (language: string, namespace: string) =>
    import(`@/locales/${language}/${namespace}.json`)
);

// One instance per locale per request, with every namespace loaded — the
// bundles are five small JSON files (specs/i18n.md §3).
const getInstance = cache(async (locale: Locale): Promise<i18n> => {
  const instance = createInstance();
  await instance.use(loadResources).init({
    lng: locale,
    fallbackLng: defaultLocale,
    supportedLngs: [...locales],
    ns: [...namespaces],
    defaultNS: "common",
    fallbackNS: "common",
    interpolation: { escapeValue: false },
  });
  return instance;
});

export async function getT(ns: Namespace = "common") {
  const locale = await resolveLocale();
  const instance = await getInstance(locale);
  return { t: instance.getFixedT(locale, ns), locale };
}

// The initial resources the client provider hydrates with — every namespace
// of the active locale, so client components render synchronously without a
// flash of untranslated content (specs/i18n.md §3).
export async function getClientResources(locale: Locale) {
  const instance = await getInstance(locale);
  return Object.fromEntries(
    namespaces.map((ns) => [ns, instance.getResourceBundle(locale, ns)])
  );
}
