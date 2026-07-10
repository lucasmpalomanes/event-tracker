"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createInstance, type Resource, type ResourceLanguage } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import {
  defaultLocale,
  locales,
  namespaces,
  type Locale,
} from "@/lib/i18n/config";

// Client-side i18next, hydrated with the active locale's bundles rendered by
// the server (specs/i18n.md §3). Because the resources arrive as props, init
// is synchronous and the first client render matches the server HTML.
export function I18nProvider({
  locale,
  resources,
  children,
}: {
  locale: Locale;
  resources: ResourceLanguage;
  children: ReactNode;
}) {
  const [i18n] = useState(() => {
    const instance = createInstance();
    instance.use(initReactI18next).init({
      lng: locale,
      fallbackLng: defaultLocale,
      supportedLngs: [...locales],
      ns: [...namespaces],
      defaultNS: "common",
      fallbackNS: "common",
      resources: { [locale]: resources } as Resource,
      interpolation: { escapeValue: false },
    });
    return instance;
  });

  // After the language switcher sets the cookie and refreshes, the layout
  // re-renders with the new locale and bundles — feed them to the live
  // instance so client components follow without a reload.
  useEffect(() => {
    for (const [ns, bundle] of Object.entries(resources)) {
      if (!i18n.hasResourceBundle(locale, ns)) {
        i18n.addResourceBundle(locale, ns, bundle);
      }
    }
    if (i18n.language !== locale) void i18n.changeLanguage(locale);
  }, [i18n, locale, resources]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
