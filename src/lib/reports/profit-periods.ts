import {
  localDateIso,
  monthEndLocal,
  monthStartLocal,
} from "@/lib/dates";

export type ProfitPreset = "today" | "week" | "month" | "last_month" | "custom";

export type ProfitPeriod = {
  preset: ProfitPreset;
  from: string;
  to: string;
  label: string;
};

export function todayIso() {
  return localDateIso();
}

export function monthStartIso(d = new Date()) {
  return monthStartLocal(d);
}

export const PROFIT_PRESETS: { id: ProfitPreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "custom", label: "Custom dates" },
];

export function resolveProfitPeriod(input: {
  preset?: string;
  from?: string;
  to?: string;
}): ProfitPeriod {
  const now = new Date();
  const preset = (input.preset || "month") as ProfitPreset;

  if (preset === "today") {
    const d = todayIso();
    return { preset, from: d, to: d, label: "Today" };
  }

  if (preset === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return {
      preset,
      from: localDateIso(start),
      to: todayIso(),
      label: "This week (7 days)",
    };
  }

  if (preset === "last_month") {
    const anchor = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return {
      preset,
      from: monthStartLocal(anchor),
      to: monthEndLocal(anchor),
      label: "Last month (full)",
    };
  }

  if (preset === "custom" && input.from && input.to) {
    return {
      preset,
      from: input.from,
      to: input.to,
      label: `${input.from} to ${input.to}`,
    };
  }

  return {
    preset: "month",
    from: monthStartIso(now),
    to: todayIso(),
    label: "This month (to date)",
  };
}
