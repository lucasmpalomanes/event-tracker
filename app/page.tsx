import Link from "next/link";
import type { TFunction } from "i18next";
import { getCurrentUser } from "@/lib/dal";
import { listEvents, type EventListItem } from "@/lib/events";
import { formatDay } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import { requestAccess } from "@/app/actions";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function EventRow({
  event,
  isAdmin,
  t,
  tCommon,
  locale,
}: {
  event: EventListItem;
  isAdmin: boolean;
  t: TFunction<"home">;
  tCommon: TFunction<"common">;
  locale: Locale;
}) {
  const canEnter = isAdmin || event.membership === "approved";

  const body = (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <span className="font-medium">{event.title}</span>
        <Badge variant="outline">{tCommon(`status.${event.status}`)}</Badge>
        {isAdmin && event.pendingCount > 0 && (
          <Badge className="bg-warning text-warning-foreground">
            {t("pendingBadge", { count: event.pendingCount })}
          </Badge>
        )}
      </div>
      <span className="text-sm text-muted-foreground">
        {event.status === "finalized" && event.finalized_date
          ? t("happeningOn", { date: formatDay(event.finalized_date, locale) })
          : `${formatDay(event.window_start, locale)} – ${formatDay(event.window_end, locale)}`}
        {event.location ? ` · ${event.location}` : ""}
      </span>
    </div>
  );

  return (
    <li>
      <Card className="flex-row items-center justify-between gap-4 p-4">
        {canEnter ? (
          <Link
            href={`/events/${event.id}`}
            className="flex-1 hover:opacity-80"
          >
            {body}
          </Link>
        ) : (
          <div className="flex-1">{body}</div>
        )}

        {!canEnter && event.membership === null && (
          <form action={requestAccess.bind(null, event.id)}>
            {/* Auto-approve events grant access on the spot, so the button
                reads "Join" to set expectations (specs/spec.md §5.1). */}
            <Button type="submit" size="sm">
              {event.auto_approve_members ? t("join") : t("requestToEnter")}
            </Button>
          </form>
        )}
        {!canEnter && event.membership === "pending" && (
          <span className="text-sm text-muted-foreground">
            {t("awaitingApproval")}
          </span>
        )}
        {!canEnter && event.membership === "rejected" && (
          <form action={requestAccess.bind(null, event.id)}>
            <Button type="submit" size="sm" variant="outline">
              {t("requestAgain")}
            </Button>
          </form>
        )}
      </Card>
    </li>
  );
}

export default async function Home() {
  const user = await getCurrentUser();
  const { t, locale } = await getT("home");
  const { t: tCommon } = await getT("common");

  if (!user) {
    return (
      <div className="flex flex-col flex-1">
        {/* Logged-out visitors get a minimal top bar with just the language
            selector (specs/i18n.md §4). */}
        <header className="flex w-full items-center justify-end px-8 py-4">
          <LanguageSwitcher />
        </header>
        <div className="flex flex-col flex-1 items-center justify-center">
          <main className="flex w-full max-w-3xl flex-col items-center gap-6 px-16 pb-32 pt-16 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              {tCommon("appName")}
            </h1>
            <p className="max-w-md text-lg leading-8 text-muted-foreground">
              {t("heroLead")}
            </p>
            <Button
              size="lg"
              nativeButton={false}
              render={<a href="/auth/login" />}
            >
              {tCommon("logIn")}
            </Button>
          </main>
        </div>
      </div>
    );
  }

  const events = await listEvents(user);

  return (
    <div className="flex flex-col flex-1">
      <header className="flex w-full items-center justify-between border-b px-8 py-4">
        <span className="font-semibold">{tCommon("appName")}</span>
        <div className="flex items-center gap-4 text-sm pl-5">
          <LanguageSwitcher />
          <span className="text-muted-foreground">
            {user.name ?? user.email}
            {user.is_admin && ` ${tCommon("admin")}`}
          </span>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href="/auth/logout" />}
          >
            {tCommon("logOut")}
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-12">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("events")}
          </h1>
          {user.is_admin && (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href="/events/new" />}
            >
              {t("createEvent")}
            </Button>
          )}
        </div>
        {events.length === 0 ? (
          <p className="text-muted-foreground">
            {t("noEvents")}
            {user.is_admin && ` ${t("createFirst")}`}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                isAdmin={user.is_admin}
                t={t}
                tCommon={tCommon}
                locale={locale}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
