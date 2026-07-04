import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/dal";
import { createEvent } from "@/app/actions";

const inputClass =
  "rounded-lg border border-black/[.08] bg-white px-3 py-2 text-black dark:border-white/[.145] dark:bg-zinc-950 dark:text-zinc-50";

export default async function NewEventPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");
  if (!user.is_admin) redirect("/");

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-8 py-12">
        <Link
          href="/"
          className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
        >
          ← Back to events
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Create event
        </h1>
        <form action={createEvent} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            Title
            <input name="title" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            Description (optional)
            <textarea name="description" rows={3} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            Location (optional)
            <input name="location" className={inputClass} />
          </label>
          <div className="flex gap-4">
            <label className="flex flex-1 flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
              First candidate day
              <input
                name="window_start"
                type="date"
                required
                className={inputClass}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
              Last candidate day
              <input
                name="window_end"
                type="date"
                required
                className={inputClass}
              />
            </label>
          </div>
          <p className="text-xs text-zinc-500">
            The window may span at most 6 months.
          </p>
          <button className="mt-2 h-11 rounded-full bg-black font-medium text-white transition-colors hover:bg-[#383838] dark:bg-zinc-50 dark:text-black dark:hover:bg-[#ccc]">
            Create event
          </button>
        </form>
      </main>
    </div>
  );
}
