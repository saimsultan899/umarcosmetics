export type ProfitPreset = "today" | "week" | "month" | "last_month" | "custom";

export type ProfitPeriod = {
  preset: ProfitPreset;
  from: string;
  to: string;
  label: string;
};

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function todayIso() {
  return iso(new Date());
}

export function monthStartIso(d = new Date()) {
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
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
      from: iso(start),
      to: todayIso(),
      label: "This week (7 days)",
    };
  }

  if (preset === "last_month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      preset,
      from: iso(start),
      to: iso(end),
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
