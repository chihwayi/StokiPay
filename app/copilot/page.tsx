"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

type Turn = { question: string; answer: string; toolCalls: { name: string; input: unknown }[] };

const SUGGESTIONS = ["What was our profit this month?", "What are our best and worst sellers this month?", "How much do customers owe us?"];

// Read-only Q&A over this tenant's own figures only — every tool the
// model can call (lib/ai/copilot-tools.ts) is scoped server-side to the
// caller's own tenant_id and can never write. See
// tests/integration/copilot.test.ts for the adversarial proof of that.
export default function CopilotPage() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/ai/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error === "not-configured" ? "AI copilot isn't set up yet — use Reports for these figures." : "Couldn't answer that");
      return;
    }
    setTurns((prev) => [...prev, { question: q, answer: body.text, toolCalls: body.toolCalls ?? [] }]);
    setQuestion("");
  }

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-6 py-10">
      <header className="animate-rise-in">
        <Link href="/dashboard" className="text-sm font-semibold text-teal hover:underline">
          ← Dashboard
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Copilot</h1>
        <p className="text-xs text-foreground-muted">
          Answers profit, best/worst seller and debt questions from your own figures — never guesses, never changes anything.
        </p>
      </header>

      {turns.length === 0 && !error && (
        <Card accent className="animate-rise-in flex flex-col gap-3">
          <p className="text-sm font-semibold text-foreground">Try asking:</p>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="rounded-xl border-2 border-border px-3 py-2 text-left text-sm text-foreground-muted hover:border-marigold hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </Card>
      )}

      {error && <Card className="border-2 border-clay/40 text-sm text-clay">{error}</Card>}

      <div className="flex flex-col gap-3">
        {turns.map((t, i) => (
          <div key={i} className="flex flex-col gap-2">
            <p className="self-end rounded-2xl bg-marigold-soft px-4 py-2 text-sm font-medium text-foreground">{t.question}</p>
            <Card className="flex flex-col gap-2">
              <p className="whitespace-pre-wrap text-sm text-foreground">{t.answer}</p>
              {t.toolCalls.length > 0 && (
                <p className="text-xs text-foreground-muted">
                  Checked: {t.toolCalls.map((c) => c.name.replace(/_/g, " ")).join(", ")}
                </p>
              )}
            </Card>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="sticky bottom-6 flex gap-2"
      >
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about profit, sellers or debt…"
          className="flex-1"
        />
        <Button type="submit" disabled={busy} className="px-5">
          {busy ? "…" : "Ask"}
        </Button>
      </form>
    </main>
  );
}
