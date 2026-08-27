const TONE_CLASSES = {
  neutral: "bg-surface-sunken text-foreground-muted",
  positive: "bg-teal-soft text-teal-strong",
  warning: "bg-marigold-soft text-marigold-strong",
  negative: "bg-clay-soft text-clay",
} as const;

export type StatusBadgeTone = keyof typeof TONE_CLASSES;

export function StatusBadge({
  tone,
  children,
}: {
  tone: StatusBadgeTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-black/5 px-3.5 py-1.5 text-sm font-semibold ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}
