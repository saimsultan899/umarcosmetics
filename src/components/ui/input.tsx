"use client";

import { cn, fieldControlClass, isExactZeroAmount } from "@/lib/utils";
import {
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  forwardRef,
  useCallback,
  useState,
} from "react";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input(
  { className, type, value, defaultValue, onFocus, onBlur, onChange, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const isNumber = type === "number";
  const controlled = value !== undefined;

  // Amount/qty number fields: show blank instead of 0 when idle so users
  // do not have to delete a zero before typing.
  const displayValue = controlled
    ? isNumber && !focused && isExactZeroAmount(value)
      ? ""
      : value
    : undefined;

  const handleFocus = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      setFocused(true);
      if (isNumber && isExactZeroAmount(controlled ? value : e.currentTarget.value)) {
        e.currentTarget.value = "";
        if (controlled && onChange) {
          const event = {
            ...e,
            target: e.currentTarget,
            currentTarget: e.currentTarget,
          } as ChangeEvent<HTMLInputElement>;
          onChange(event);
        }
      }
      onFocus?.(e);
    },
    [controlled, isNumber, onChange, onFocus, value],
  );

  const handleBlur = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      setFocused(false);
      onBlur?.(e);
    },
    [onBlur],
  );

  return (
    <input
      ref={ref}
      type={type}
      className={cn(fieldControlClass, "h-10 w-full px-3", className)}
      value={displayValue}
      defaultValue={defaultValue}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={onChange}
      {...props}
    />
  );
});
