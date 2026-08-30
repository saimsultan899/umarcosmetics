"use client";

import { Calendar, Clock } from "lucide-react";
import { useEffect, useState } from "react";

const TZ = "Asia/Karachi";

function formatNow(now: Date) {
  const date = new Intl.DateTimeFormat("en-PK", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  }).format(now);

  const time = new Intl.DateTimeFormat("en-PK", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: TZ,
  }).format(now);

  return { date, time };
}

export function HeaderClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const { date, time } = formatNow(now);

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-[var(--ink)]">
        <Clock className="hidden h-4 w-4 shrink-0 text-[var(--brand)] sm:block" />
        <p className="font-amount text-base font-semibold tabular-nums sm:text-lg">
          {time}
        </p>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--muted)] sm:text-xs">
        <Calendar className="h-3 w-3 shrink-0" />
        <span>{date}</span>
      </div>
    </div>
  );
}
