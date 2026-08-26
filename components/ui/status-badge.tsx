const TONE_CLASSES = {
  neutral: "bg-slate-200 text-slate-800",
  positive: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  negative: "bg-red-100 text-red-800",
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
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden className="h-2 w-2 rounded-full bg-current" />
      {children}
    </span>
  );
}
