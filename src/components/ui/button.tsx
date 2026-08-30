import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "accent" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-md border border-transparent font-semibold transition disabled:opacity-50 disabled:pointer-events-none",
          variant === "primary" &&
            "bg-[var(--brand)] text-white hover:bg-[var(--brand-strong)]",
          variant === "accent" &&
            "bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)]",
          variant === "secondary" &&
            "border-[var(--border)] bg-white text-[var(--ink)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]",
          variant === "ghost" && "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
          variant === "danger" && "bg-[var(--danger)] text-white hover:bg-[#b91c1c]",
          size === "sm" && "h-8 px-3 text-xs",
          size === "md" && "h-10 px-4 text-sm",
          size === "lg" && "h-11 px-5 text-sm",
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
