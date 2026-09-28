import { useSyncExternalStore } from "react";

export type WalkInSlipLayout = "thermal" | "standard";

const PREFIX = "umar.walkinReceipt.";

function subscribeWalkInSlip(onChange: () => void) {
  window.addEventListener("umar-walkin-slip", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("umar-walkin-slip", onChange);
    window.removeEventListener("storage", onChange);
  };
}

function subscribeOnce() {
  return () => {};
}

/** False during server render and hydration, true after the client takes over. */
export function useClientReady() {
  return useSyncExternalStore(subscribeOnce, () => true, () => false);
}

export function walkInSlipKey(companyId: string) {
  return `${PREFIX}${companyId}`;
}

/** Saved walk-in print layout. Standard until the shop turns thermal on. */
export function readWalkInSlip(companyId: string): WalkInSlipLayout {
  if (typeof window === "undefined" || !companyId) return "standard";
  try {
    return localStorage.getItem(walkInSlipKey(companyId)) === "thermal"
      ? "thermal"
      : "standard";
  } catch {
    return "standard";
  }
}

export function useWalkInSlip(companyId: string): WalkInSlipLayout {
  return useSyncExternalStore(
    subscribeWalkInSlip,
    () => readWalkInSlip(companyId),
    () => "standard" as WalkInSlipLayout,
  );
}

export function useSlipQuery(): WalkInSlipLayout | null {
  return useSyncExternalStore(
    subscribeOnce,
    () => {
      const slip = new URLSearchParams(window.location.search).get("slip");
      return slip === "thermal" || slip === "standard" ? slip : null;
    },
    () => null,
  );
}

export function writeWalkInSlip(companyId: string, layout: WalkInSlipLayout) {
  if (typeof window === "undefined" || !companyId) return;
  localStorage.setItem(walkInSlipKey(companyId), layout);
  window.dispatchEvent(
    new CustomEvent("umar-walkin-slip", { detail: { companyId, layout } }),
  );
}
