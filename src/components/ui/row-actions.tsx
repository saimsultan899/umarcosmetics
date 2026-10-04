"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Eye, Pencil, Printer, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type DetailField = {
  label: string;
  value: React.ReactNode;
};

const tableIconBtn =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg p-0";

export function DetailGrid({ fields }: { fields: DetailField[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            {f.label}
          </dt>
          <dd className="mt-1 break-words text-sm text-[var(--ink)]">
            {f.value ?? "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function RowActions({
  viewFields,
  viewTitle = "View details",
  editTitle = "Edit",
  deleteTitle = "Delete",
  deleteDescription = "This will remove the record from this list. It can be restored later if needed.",
  onDelete,
  cancelTitle = "Cancel entry?",
  cancelDescription = "Balance and stock go back to before this entry. Then enter the correct one if needed.",
  onCancel,
  editContent,
  href,
  printHref,
  allowEdit = true,
  allowDelete = true,
  allowCancel = false,
  className,
}: {
  viewFields: DetailField[];
  viewTitle?: string;
  editTitle?: string;
  deleteTitle?: string;
  deleteDescription?: string;
  onDelete?: () => Promise<void> | void;
  cancelTitle?: string;
  cancelDescription?: string;
  onCancel?: () => Promise<void> | void;
  editContent?: (close: () => void) => React.ReactNode;
  href?: string;
  /** Opens the printable slip page (shown next to View). */
  printHref?: string;
  allowEdit?: boolean;
  allowDelete?: boolean;
  /** Soft-cancel a posted trading entry (ledger/stock reversed). */
  allowCancel?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "delete" | "cancel" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action?: () => Promise<void> | void, failLabel = "Failed") {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : failLabel);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-nowrap items-center justify-end gap-0.5", className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={tableIconBtn}
        onClick={() => setMode("view")}
        aria-label="View"
        title="View"
      >
        <Eye className="h-3.5 w-3.5" />
      </Button>

      {printHref ? (
        <Link
          href={`${printHref}${printHref.includes("?") ? "&" : "?"}print=1`}
          aria-label="Print"
          title="Print"
          className={cn(
            tableIconBtn,
            "text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
          )}
        >
          <Printer className="h-3.5 w-3.5" />
        </Link>
      ) : null}

      {allowEdit && editContent ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={tableIconBtn}
          onClick={() => setMode("edit")}
          aria-label="Edit"
          title="Edit / Update"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ) : null}

      {allowCancel && onCancel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(tableIconBtn, "text-amber-700 hover:bg-amber-50 hover:text-amber-800")}
          onClick={() => setMode("cancel")}
          aria-label="Cancel entry"
          title="Cancel / fix mistake"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
      ) : null}

      {allowDelete && onDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(tableIconBtn, "text-rose-600 hover:text-rose-700")}
          onClick={() => setMode("delete")}
          aria-label="Delete"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ) : null}

      <Dialog
        open={mode === "view"}
        onClose={() => setMode(null)}
        title={viewTitle}
      >
        <DetailGrid fields={viewFields} />
        {href ? (
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href={href}
              className="inline-flex h-9 items-center rounded-lg bg-[var(--brand)] px-3 text-sm font-medium text-white"
            >
              Open full page
            </Link>
            {allowCancel && onCancel ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setMode("cancel")}
              >
                Cancel / fix mistake
              </Button>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={mode === "edit"}
        onClose={() => setMode(null)}
        title={editTitle}
        className="sm:max-w-3xl"
      >
        {editContent?.(() => setMode(null))}
      </Dialog>

      <Dialog
        open={mode === "cancel"}
        onClose={() => !busy && setMode(null)}
        title={cancelTitle}
        description={cancelDescription}
      >
        {error ? (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setMode(null)}
          >
            Keep entry
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            loading={busy}
            onClick={() => void runAction(onCancel, "Cancel failed")}
          >
            {busy ? "Cancelling..." : "Cancel this entry"}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={mode === "delete"}
        onClose={() => !busy && setMode(null)}
        title={deleteTitle}
        description={deleteDescription}
      >
        {error ? (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setMode(null)}
          >
            Keep
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            loading={busy}
            onClick={() => void runAction(onDelete, "Delete failed")}
          >
            {busy ? "Deleting..." : "Delete permanently"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
