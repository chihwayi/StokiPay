import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-marigold text-white shadow-[0_4px_0_0_var(--marigold-strong)] hover:brightness-105 active:translate-y-1 active:shadow-[0_1px_0_0_var(--marigold-strong)]",
  secondary:
    "bg-teal text-white shadow-[0_4px_0_0_var(--teal-strong)] hover:brightness-105 active:translate-y-1 active:shadow-[0_1px_0_0_var(--teal-strong)]",
  ghost:
    "bg-transparent text-foreground border-2 border-border hover:border-marigold hover:text-marigold active:translate-y-0.5",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(({ variant = "primary", className = "", disabled, children, ...props }, ref) => {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={`inline-flex min-h-14 items-center justify-center rounded-2xl px-6 text-base font-semibold tracking-tight transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});
Button.displayName = "Button";
