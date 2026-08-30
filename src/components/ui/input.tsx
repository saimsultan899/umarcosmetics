import { cn, fieldControlClass } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        fieldControlClass,
        "h-10 w-full px-3",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
