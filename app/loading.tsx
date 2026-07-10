import { Skeleton } from "@/components/ui/skeleton";

// Streaming fallback while the event list loads: header bar plus a few
// event-row placeholders matching the Card layout.
export default function Loading() {
  return (
    <div className="flex flex-col flex-1">
      <header className="flex w-full items-center justify-between border-b px-8 py-4">
        <span className="font-semibold">Gagasco</span>
        <div className="flex items-center gap-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-7 w-20 rounded-2xl" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-12">
        <div className="flex items-center justify-between">
          {/* The heading is a skeleton too — the locale isn't resolved here,
              and a hardcoded word would flash untranslated (specs/i18n.md). */}
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-7 w-28 rounded-2xl" />
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[86px] rounded-3xl" />
          ))}
        </div>
      </main>
    </div>
  );
}
