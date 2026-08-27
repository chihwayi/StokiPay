export function Card({
  children,
  className = "",
  accent = false,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-3xl border-2 border-border bg-surface p-6 shadow-[0_2px_0_0_var(--border)] ${className}`}
    >
      {accent && (
        <span className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-marigold via-clay to-teal" />
      )}
      {children}
    </div>
  );
}
