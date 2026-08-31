"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function ReportFiltersForm({
  branches,
  dateFrom,
  dateTo,
  branchId,
}: {
  branches: { id: string; name: string }[];
  dateFrom: string;
  dateTo: string;
  branchId: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [branch, setBranch] = useState(branchId);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams({ from, to });
    if (branch) params.set("branch", branch);
    router.push(`/reports?${params.toString()}`);
  }

  return (
    <Card className="animate-rise-in flex flex-col gap-3">
      <form onSubmit={apply} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-11 flex-1" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-h-11 flex-1" />
        </div>
        {branches.length > 1 && (
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="min-h-11 rounded-xl border-2 border-border bg-surface px-3 text-sm"
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <Button type="submit" variant="secondary" className="min-h-11">
          Apply filters
        </Button>
      </form>
    </Card>
  );
}
