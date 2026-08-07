import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes, forwardRef } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 disabled:pointer-events-none",
          variant === "primary" &&
            "bg-[var(--brand)] text-white hover:bg-[var(--brand-strong)] shadow-sm",
          variant === "secondary" &&
            "bg-white border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--surface-2)]",
          variant === "ghost" && "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
          variant === "danger" && "bg-rose-600 text-white hover:bg-rose-700",
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
