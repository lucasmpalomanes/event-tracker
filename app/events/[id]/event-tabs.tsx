"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// The active tab is reflected in the URL (?tab=budget) so links land on the
// right tab (specs/event-budget.md §6.1). replaceState integrates with the
// Next router without re-rendering the server page.
export function EventTabs({
  initialTab,
  dates,
  budget,
}: {
  initialTab: "dates" | "budget";
  dates: ReactNode;
  budget: ReactNode;
}) {
  const { t } = useTranslation("event");
  const [tab, setTab] = useState<string>(initialTab);

  function handleValueChange(value: unknown) {
    const next = String(value);
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "dates") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      query ? `?${query}` : window.location.pathname,
    );
  }

  return (
    <Tabs value={tab} onValueChange={handleValueChange}>
      <TabsList className="mb-2 self-center">
        <TabsTrigger value="dates">{t("tabs.dates")}</TabsTrigger>
        <TabsTrigger value="budget">{t("tabs.budget")}</TabsTrigger>
      </TabsList>
      <TabsContent value="dates" className="flex flex-col gap-8">
        {dates}
      </TabsContent>
      <TabsContent value="budget" className="flex flex-col gap-8">
        {budget}
      </TabsContent>
    </Tabs>
  );
}
