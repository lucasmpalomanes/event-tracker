import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { getCurrentUser } from "@/lib/dal";
import { getT } from "@/lib/i18n/server";
import { createEvent } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default async function NewEventPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");
  if (!user.is_admin) redirect("/");

  const { t } = await getT("event");
  const { t: tCommon } = await getT("common");

  return (
    <div className="flex flex-col flex-1">
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-8 py-12">
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
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("createEvent")}
        </h1>
        <form action={createEvent} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">{t("form.title")}</Label>
            <Input id="title" name="title" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">{t("form.description")}</Label>
            <Textarea id="description" name="description" rows={3} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="location">{t("form.location")}</Label>
            <Input id="location" name="location" />
          </div>
          <div className="flex gap-4">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="window_start">{t("form.firstDay")}</Label>
              <Input
                id="window_start"
                name="window_start"
                type="date"
                required
              />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="window_end">{t("form.lastDay")}</Label>
              <Input id="window_end" name="window_end" type="date" required />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("form.windowCap")}</p>
          <div className="flex items-start gap-2">
            <Checkbox
              id="auto_approve_members"
              name="auto_approve_members"
              className="mt-0.5"
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="auto_approve_members">
                {t("form.autoApprove")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("form.autoApproveHint")}
              </p>
            </div>
          </div>
          <Button type="submit" size="lg" className="mt-2">
            {t("createEvent")}
          </Button>
        </form>
      </main>
    </div>
  );
}
