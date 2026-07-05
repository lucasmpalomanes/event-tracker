import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { getCurrentUser } from "@/lib/dal";
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

  return (
    <div className="flex flex-col flex-1">
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-8 py-12">
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          render={<Link href="/" />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Back to events
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Create event</h1>
        <form action={createEvent} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea id="description" name="description" rows={3} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="location">Location (optional)</Label>
            <Input id="location" name="location" />
          </div>
          <div className="flex gap-4">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="window_start">First candidate day</Label>
              <Input
                id="window_start"
                name="window_start"
                type="date"
                required
              />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="window_end">Last candidate day</Label>
              <Input id="window_end" name="window_end" type="date" required />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The window may span at most 6 months.
          </p>
          <div className="flex items-start gap-2">
            <Checkbox
              id="auto_approve_members"
              name="auto_approve_members"
              className="mt-0.5"
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="auto_approve_members">
                Auto-approve new members
              </Label>
              <p className="text-xs text-muted-foreground">
                Anyone who asks to enter gets access immediately, without
                waiting for your approval. You can change this later.
              </p>
            </div>
          </div>
          <Button type="submit" size="lg" className="mt-2">
            Create event
          </Button>
        </form>
      </main>
    </div>
  );
}
