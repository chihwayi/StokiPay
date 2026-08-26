import { SyncStatusIndicator } from "@/components/features/sync/sync-status-indicator";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          StockFlow ZW
        </h1>
        <SyncStatusIndicator />
      </header>
      <p className="text-slate-600 dark:text-slate-400">
        Sprint 0 foundation shell. Product, stock and sales screens are built
        in later sprints per <code>sprints.md</code>.
      </p>
    </main>
  );
}
