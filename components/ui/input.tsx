import { type InputHTMLAttributes, forwardRef } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`min-h-14 w-full rounded-2xl border-2 border-border bg-surface px-4 text-base text-foreground placeholder:text-foreground-muted/60 outline-none transition-colors focus:border-marigold ${className}`}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-sm font-semibold uppercase tracking-wide text-foreground-muted"
    >
      {children}
    </label>
  );
}
