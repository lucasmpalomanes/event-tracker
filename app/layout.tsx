import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { getClientResources, getT, resolveLocale } from "@/lib/i18n/server";
import { I18nProvider } from "@/components/i18n-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

// The preset (base-rhea) ships Inter as the sans font; Geist Mono stays
// wired to --font-mono in globals.css (specs/shadcn-refactor.md §8).
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("common");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Locale comes from the NEXT_LOCALE cookie / Accept-Language
  // (specs/i18n.md §3) — no locale segment in the URL.
  const locale = await resolveLocale();
  const resources = await getClientResources(locale);

  return (
    <html
      lang={locale}
      className={cn(
        "h-full font-sans antialiased",
        inter.variable,
        geistMono.variable
      )}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale} resources={resources}>
          <TooltipProvider>{children}</TooltipProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
