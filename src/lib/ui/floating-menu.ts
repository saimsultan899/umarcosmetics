import type { CSSProperties } from "react";

type FloatingMenuOptions = {
  minWidth?: number;
  preferredMaxHeight?: number;
  gap?: number;
  edgePad?: number;
  zIndex?: number;
};

/**
 * Viewport-aware fixed position for portaled dropdown menus.
 * Flips above/below the trigger and caps height so the menu never
 * overflows the screen (including inside dialogs).
 */
export function getFloatingMenuStyle(
  trigger: DOMRect,
  {
    minWidth = 220,
    preferredMaxHeight = 288,
    gap = 6,
    edgePad = 8,
    zIndex = 220,
  }: FloatingMenuOptions = {},
): CSSProperties {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const spaceBelow = viewportH - trigger.bottom - gap - edgePad;
  const spaceAbove = trigger.top - gap - edgePad;
  const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
  const available = Math.max(120, openUp ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(preferredMaxHeight, available);

  const width = Math.min(
    Math.max(trigger.width, minWidth),
    Math.max(160, viewportW - edgePad * 2),
  );
  const left = Math.min(
    Math.max(edgePad, trigger.left),
    Math.max(edgePad, viewportW - width - edgePad),
  );

  return {
    position: "fixed",
    left,
    width,
    zIndex,
    maxHeight,
    display: "flex",
    flexDirection: "column",
    ...(openUp
      ? { bottom: viewportH - trigger.top + gap, top: "auto" }
      : { top: trigger.bottom + gap, bottom: "auto" }),
  };
}

export function floatingMenuStyleEqual(a: CSSProperties, b: CSSProperties) {
  return (
    a.left === b.left &&
    a.width === b.width &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.maxHeight === b.maxHeight &&
    a.zIndex === b.zIndex
  );
}
