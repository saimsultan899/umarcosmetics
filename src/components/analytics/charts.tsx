"use client";

import { formatNumber, formatPkr } from "@/lib/utils";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = ["#d65a42", "#e88774", "#f0b5a8", "#c04a34", "#16a34a", "#64748b"];
const BRAND_CHART = "#d65a42";
const BRAND_CHART_LIGHT = "#e88774";

type Point = { name: string; value: number; secondary?: number };

function MoneyTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-[var(--ink)]">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || "var(--brand)" }}>
          {p.name || "Value"}: {formatPkr(p.value)}
        </p>
      ))}
    </div>
  );
}

export function TrendAreaChart({
  data,
  valueLabel = "Amount",
  height = 220,
}: {
  data: Point[];
  valueLabel?: string;
  height?: number;
}) {
  if (!data.length) {
    return <EmptyChart />;
  }
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="brandFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND_CHART} stopOpacity={0.35} />
              <stop offset="100%" stopColor={BRAND_CHART} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e4" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: "#5f6f68", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#5f6f68", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v) => formatNumber(v, 0)}
          />
          <Tooltip content={<MoneyTip />} />
          <Area
            type="monotone"
            dataKey="value"
            name={valueLabel}
            stroke={BRAND_CHART}
            strokeWidth={2.5}
            fill="url(#brandFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CompareBarChart({
  data,
  valueLabel = "Amount",
  secondaryLabel,
  height = 220,
}: {
  data: Point[];
  valueLabel?: string;
  secondaryLabel?: string;
  height?: number;
}) {
  if (!data.length) return <EmptyChart />;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e4" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: "#5f6f68", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#5f6f68", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v) => formatNumber(v, 0)}
          />
          <Tooltip content={<MoneyTip />} />
          {secondaryLabel ? <Legend /> : null}
          <Bar
            dataKey="value"
            name={valueLabel}
            fill={BRAND_CHART}
            radius={[8, 8, 0, 0]}
            maxBarSize={42}
          />
          {secondaryLabel ? (
            <Bar
              dataKey="secondary"
              name={secondaryLabel}
              fill={BRAND_CHART_LIGHT}
              radius={[8, 8, 0, 0]}
              maxBarSize={42}
            />
          ) : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChart({
  data,
  height = 220,
  centerLabel,
  centerValue,
}: {
  data: Point[];
  height?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((s, d) => s + Number(d.value || 0), 0);
  if (!data.length || total <= 0) return <EmptyChart />;

  return (
    <div className="relative" style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={3}
            stroke="none"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => formatPkr(Number(value || 0))}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid var(--border)",
              fontSize: 12,
            }}
          />
          <Legend verticalAlign="bottom" height={28} />
        </PieChart>
      </ResponsiveContainer>
      {centerLabel || centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-6">
          {centerValue ? (
            <p className="font-[family-name:var(--font-display)] text-lg font-semibold">
              {centerValue}
            </p>
          ) : null}
          {centerLabel ? (
            <p className="text-[11px] text-[var(--muted)]">{centerLabel}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RankBars({
  data,
  money = true,
}: {
  data: Array<{ name: string; value: number }>;
  money?: boolean;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  if (!data.length) return <EmptyChart />;

  return (
    <div className="space-y-3">
      {data.map((row) => (
        <div key={row.name}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-medium text-[var(--ink)]">{row.name}</span>
            <span className="shrink-0 text-[var(--muted)]">
              {money ? formatPkr(row.value) : formatNumber(row.value, 0)}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--brand)] transition-all"
              style={{ width: `${Math.max(6, (row.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-sm text-[var(--muted)]">
      No data yet for this chart
    </div>
  );
}
