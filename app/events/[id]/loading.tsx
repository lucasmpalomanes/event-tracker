import { Skeleton } from "@/components/ui/skeleton";

// Streaming fallback while the date page fetches event data
// (loading.tsx file convention). Mirrors the page's layout: back button,
// title row, calendar grid, and ranking panel.
export default function Loading() {
  return (
    <div className="flex flex-col flex-1">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-12">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-36" />
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-24 rounded-2xl" />
          </div>
          <Skeleton className="h-4 w-72" />
        </div>

        <div className="flex flex-col gap-8 lg:flex-row">
          <section className="flex-1">
            <Skeleton className="mb-3 h-5 w-60" />
            <div className="grid gap-6 sm:grid-cols-2">
              {[0, 1].map((month) => (
                <div key={month}>
                  <Skeleton className="mb-2 h-4 w-28" />
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: 35 }).map((_, i) => (
                      <Skeleton key={i} className="aspect-square rounded-lg" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside className="flex w-full flex-col gap-3 lg:w-72">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-3xl" />
            ))}
          </aside>
        </div>
      </main>
    </div>
  );
}
