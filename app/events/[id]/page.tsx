import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { getCurrentUser } from "@/lib/dal";
import {
  canEnterEvent,
  getEvent,
  getMembership,
  listAvailability,
  listParticipants,
  listPendingRequests,
} from "@/lib/events";
import { getChargeSettings, listBudgetItems } from "@/lib/budget";
import { listEventCompanions } from "@/lib/companions";
import {
  listEventCharges,
  reopenBlocker,
  type PixChargeWithUser,
} from "@/lib/charges";
import { formatDay } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { updateEventDetails } from "@/app/actions";
import { BudgetTab } from "./budget-tab";
import { DatesTab } from "./dates-tab";
import { EventTabs } from "./event-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  const event = await getEvent(id);
  if (!event) notFound();

  const membership = await getMembership(id, user.id);
  if (!canEnterEvent(user, event, membership)) redirect("/");

  const { tab } = await searchParams;
  const initialTab = tab === "budget" ? "budget" : "dates";

  const { t, locale } = await getT("event");
  const { t: tCommon } = await getT("common");

  // Participants feed both the admin list and the budget shares
  // (specs/event-budget.md §5), so every viewer loads them.
  const [availability, participants, budgetItems, chargeSettings, companions] =
    await Promise.all([
      listAvailability(id),
      listParticipants(event),
      listBudgetItems(id),
      getChargeSettings(id),
      // Companions count as billable units in the split (specs/companions.md §5).
      listEventCompanions(id),
    ]);
  const pendingRequests = user.is_admin ? await listPendingRequests(id) : [];
  // Loaded regardless of charging being active: `paid` rows outlive
  // deactivation, and the reopen gate reads exactly that case — charges
  // standing with no settings row (specs/reopen-finalized.md §4).
  const charges: PixChargeWithUser[] = await listEventCharges(id);
  // What blocks sending a finalized event back to `open`, if anything.
  const blocker = reopenBlocker(chargeSettings, charges);

  return (
    <div className="flex flex-col flex-1">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-12">
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="self-start text-muted-foreground"
            nativeButton={false}
            render={<Link href="/" />}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            {tCommon("backToEvents")}
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {event.title}
            </h1>
            <Badge variant="outline">
              {event.status === "finalized"
                ? tCommon("status.finalizedOn", {
                    date: formatDay(event.finalized_date!, locale),
                  })
                : tCommon(`status.${event.status}`)}
            </Badge>
          </div>
          {event.description && (
            <p className="text-muted-foreground">{event.description}</p>
          )}
          {event.location && (
            <p className="text-sm text-muted-foreground">📍 {event.location}</p>
          )}
          {user.is_admin && (
            <Collapsible className="mt-1">
              <CollapsibleTrigger
                render={
                  <Button
                    variant="link"
                    size="sm"
                    className="px-0 text-muted-foreground"
                  />
                }
              >
                {t("editDetails")}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <form
                  action={updateEventDetails.bind(null, event.id)}
                  className="mt-3 flex max-w-md flex-col gap-3"
                >
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="description">
                      {t("form.descriptionPlain")}
                    </Label>
                    <Textarea
                      id="description"
                      name="description"
                      rows={3}
                      defaultValue={event.description ?? ""}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="location">{t("form.locationPlain")}</Label>
                    <Input
                      id="location"
                      name="location"
                      defaultValue={event.location ?? ""}
                    />
                  </div>
                  <Button type="submit" size="sm" className="self-start">
                    {tCommon("save")}
                  </Button>
                </form>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>

        {/* Everything below the event header sits in Dates/Budget tabs
            (specs/event-budget.md §6.1). */}
        <EventTabs
          initialTab={initialTab}
          dates={
            <DatesTab
              event={event}
              viewerId={user.id}
              isAdmin={user.is_admin}
              pendingRequests={pendingRequests}
              participants={participants}
              availability={availability}
              reopenBlockedBy={blocker}
            />
          }
          budget={
            <BudgetTab
              event={event}
              viewerId={user.id}
              isAdmin={user.is_admin}
              participants={participants}
              companions={companions}
              items={budgetItems}
              chargeSettings={chargeSettings}
              charges={charges}
            />
          }
        />
      </main>
    </div>
  );
}
