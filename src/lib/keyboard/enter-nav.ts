/** Focusable controls used for Enter→Next field navigation (desktop billing style). */
const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isVisible(el: HTMLElement) {
  if (el.getAttribute("aria-hidden") === "true") return false;
  if ((el as HTMLInputElement).type === "hidden") return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  return el.getClientRects().length > 0;
}

export function getFocusableFields(
  root: ParentNode,
  opts?: { includeHiddenTabIndex?: boolean },
) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => {
      if (!isVisible(el)) return false;
      if (el.closest("[data-enter-skip]")) return false;
      if (el.getAttribute("data-enter-skip") != null) return false;
      // Decorative / portal search fields are opted in via data-enter-field
      if (el.tabIndex < 0 && !opts?.includeHiddenTabIndex) return false;
      return true;
    },
  );
}

export function focusNextField(
  from: HTMLElement,
  root?: ParentNode | null,
): boolean {
  const container =
    root ||
    from.closest<HTMLElement>("[data-enter-root]") ||
    from.closest("form") ||
    document.body;
  const fields = getFocusableFields(container);
  const idx = fields.indexOf(from);
  if (idx < 0) {
    // Maybe focus is inside a composite (e.g. select button wrapper)
    const owner = from.closest<HTMLElement>("[data-enter-field]");
    const ownerIdx = owner ? fields.indexOf(owner) : -1;
    if (ownerIdx >= 0 && ownerIdx < fields.length - 1) {
      fields[ownerIdx + 1]?.focus();
      return true;
    }
    return false;
  }
  if (idx >= fields.length - 1) return false;
  fields[idx + 1]?.focus();
  return true;
}

export function focusField(el: HTMLElement | null | undefined) {
  if (!el) return;
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    try {
      el.select();
    } catch {
      // ignore non-selectable inputs
    }
  }
}

type EnterKeyEvent = {
  key: string;
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  preventDefault: () => void;
  target: EventTarget | null;
};

/**
 * Form-level Enter acts like Tab / "Next" in desktop accounting software.
 * Children that fully handle Enter should call preventDefault() (and ideally stopPropagation).
 */
export function handleEnterAsNext(e: EnterKeyEvent, root?: ParentNode | null) {
  if (e.key !== "Enter") return;
  if (e.defaultPrevented) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;

  const target = e.target as HTMLElement | null;
  if (!target) return;

  if (target.tagName === "TEXTAREA") return;
  if (target.isContentEditable) return;
  if (target.closest("[data-enter-own]")) return;
  if (target.closest("[role='listbox']")) return;

  const asButton = target.closest("button, [type='submit']");
  if (asButton) {
    const type = (asButton as HTMLButtonElement).type;
    if (type === "submit" || asButton.getAttribute("type") === "submit") return;
  }

  e.preventDefault();
  focusNextField(target, root);
}
