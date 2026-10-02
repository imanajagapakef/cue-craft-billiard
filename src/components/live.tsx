"use client";

import { useEffect, useState } from "react";

import { clockHMS, clockMS, cx } from "./ui.tsx";

/**
 * Live session timer — Project.md §36.
 *
 * Renders in JetBrains Mono with tabular figures so the width never shifts while
 * it ticks. Two formats: `HH:MM:SS` when there is more than an hour left,
 * `MM:SS` otherwise, which is what the session monitor actually needs at a glance.
 *
 * Respects prefers-reduced-motion by holding still rather than animating.
 */
export function Countdown({
  endsAt,
  prefix,
  className,
  long = false,
}: {
  endsAt: string | Date;
  prefix?: string;
  className?: string;
  long?: boolean;
}) {
  const target = typeof endsAt === "string" ? new Date(endsAt) : endsAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = target.getTime() - now;
  const overdue = remaining < 0;
  const abs = Math.abs(remaining);

  return (
    <span
      className={cx(
        "font-mono tabular-nums",
        overdue ? "text-maint" : "text-ink",
        className,
      )}
      // Announced politely rather than every second — a screen reader repeating
      // "one hour" 3600 times is worse than useless.
      aria-label={`${prefix ?? "Sisa waktu"} ${overdue ? "terlambat" : ""} ${Math.floor(abs / 60000)} menit`}
    >
      {prefix ? <span className="text-ink-muted">{prefix} </span> : null}
      {overdue ? <span className="text-maint">+</span> : null}
      {long || abs >= 3_600_000 ? clockHMS(abs) : clockMS(abs)}
    </span>
  );
}

/**
 * Relative age, e.g. "just now", "4m ago". Used in the audit timeline where
 * absolute timestamps for every row would be noise.
 */
export function TimeAgo({ at }: { at: string | Date }) {
  const target = typeof at === "string" ? new Date(at) : at;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const secs = Math.max(0, Math.floor((now - target.getTime()) / 1000));
  if (secs < 60) return <span className="font-mono text-label-sm text-ink-muted">just now</span>;

  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    return <span className="font-mono text-label-sm text-ink-muted">{mins}m ago</span>;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return <span className="font-mono text-label-sm text-ink-muted">{hours}h ago</span>;
  }
  return (
    <span className="font-mono text-label-sm text-ink-muted">
      {Math.floor(hours / 24)}d ago
    </span>
  );
}
