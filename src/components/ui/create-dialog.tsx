"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { createContext, useContext, useState } from "react";

const CreateDialogCloseContext = createContext<(() => void) | null>(null);

/** Call inside a form mounted in CreateDialogButton to close after save. */
export function useCreateDialogClose() {
  return useContext(CreateDialogCloseContext);
}

export function CreateDialogButton({
  label = "Add new",
  title,
  description,
  children,
  disabled,
  disabledHint,
  size = "lg",
}: {
  label?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  disabled?: boolean;
  disabledHint?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const sizeClass =
    size === "full"
      ? "max-w-[98vw] sm:max-w-[98vw] max-h-[96vh] w-full"
      : size === "2xl"
        ? "max-w-[98vw] sm:max-w-6xl lg:max-w-7xl xl:max-w-[1440px] w-full"
        : size === "xl"
          ? "max-w-[96vw] sm:max-w-6xl lg:max-w-7xl xl:max-w-[1360px] w-full"
          : size === "lg"
            ? "max-w-[94vw] sm:max-w-3xl lg:max-w-4xl w-full"
            : size === "sm"
              ? "max-w-md w-full"
              : "max-w-[94vw] sm:max-w-2xl w-full";

  return (
    <>
      <Button
        type="button"
        variant="accent"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={disabled ? disabledHint : undefined}
      >
        <Plus className="h-4 w-4" />
        {label}
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title={title}
        description={description}
        className={sizeClass}
      >
        {disabled ? (
          <p className="text-sm text-[var(--muted)]">
            {disabledHint || "Complete required masters first."}
          </p>
        ) : (
          <CreateDialogCloseContext.Provider value={close}>
            {children}
          </CreateDialogCloseContext.Provider>
        )}
      </Dialog>
    </>
  );
}

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-header flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--brand)]">
          Umar Distribution
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-[var(--ink)] sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
