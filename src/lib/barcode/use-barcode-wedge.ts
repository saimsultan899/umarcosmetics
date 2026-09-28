"use client";

import { useEffect, useRef } from "react";

/**
 * Keyboard-wedge barcode scanners type the code very fast and finish with Enter.
 * Slow typing stays in the focused field (manual fallback).
 * A detected scan is routed to `onScan` and removed from whichever input it leaked into.
 */
const BURST_GAP_MS = 45;
const MIN_SCAN_LENGTH = 4;

function isTextField(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

function writeFieldValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function useBarcodeWedge(
  onScan: (code: string) => void,
  enabled = true,
) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let buffer = "";
    let lastAt = 0;
    let leaked = "";
    let capturing = false;

    function reset() {
      buffer = "";
      leaked = "";
      capturing = false;
      lastAt = 0;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement &&
        (target.type === "password" || target.type === "email")
      ) {
        return;
      }

      const now = Date.now();

      if (event.key === "Enter") {
        if (capturing && buffer.trim().length >= MIN_SCAN_LENGTH) {
          event.preventDefault();
          event.stopPropagation();
          const code = buffer.trim();
          if (isTextField(target) && leaked && target.value.endsWith(leaked)) {
            writeFieldValue(target, target.value.slice(0, -leaked.length));
          }
          reset();
          onScanRef.current(code);
        } else {
          reset();
        }
        return;
      }

      if (event.key.length !== 1) return;

      const fast = lastAt > 0 && now - lastAt <= BURST_GAP_MS;
      lastAt = now;

      if (!fast) {
        buffer = event.key;
        leaked = "";
        capturing = false;
        return;
      }

      buffer += event.key;
      if (buffer.length < MIN_SCAN_LENGTH) return;

      // From here the burst is a scan: keep characters out of the focused field.
      event.preventDefault();
      event.stopPropagation();
      if (!capturing) {
        capturing = true;
        leaked = buffer.slice(0, -1);
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}
