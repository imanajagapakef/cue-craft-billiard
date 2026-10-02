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

  // null until mounted. The server and the browser cannot agree on "now" — the
  // server renders at T, hydration happens at T+n, and any clock-derived text
  // differs between them. React throws that away and rebuilds the tree, which
  // shows up as a visible flash and a console error.
  //
  // suppressHydrationWarning would silence the warning while leaving the markup
  // wrong; the honest fix is to render nothing until we actually know the time.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const shape = long ? "00:00:00" : "00:00";

  if (now === null) {
    // Placeholder keeps the column width so the real value does not shift the
    // layout when it arrives.
    return (
      <span
        className={cx("font-mono tabular-nums text-ink-faint", className)}
        aria-label={prefix ?? "Sisa waktu"}
        suppressHydrationWarning
      >
        {prefix ? <span className="text-ink-muted">{prefix} </span> : null}
        {shape}
      </span>
    );
  }

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
 *
 * Same hydration constraint as Countdown: the age depends on when you look, and
 * the server and the browser look at different moments. Renders "just now" on the
 * server and corrects itself after mount, which is both stable and the least
 * jarring wrong answer — anything longer would be visibly wrong for its first
 * second.
 */
export function TimeAgo({ at }: { at: string | Date }) {
  const target = typeof at === "string" ? new Date(at) : at;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const className = "font-mono text-label-sm text-ink-muted";

  if (now === null) {
    return (
      <span className={className} suppressHydrationWarning>
        just now
      </span>
    );
  }

  const secs = Math.max(0, Math.floor((now - target.getTime()) / 1000));
  if (secs < 60) return <span className={className}>just now</span>;

  const mins = Math.floor(secs / 60);
  if (mins < 60) return <span className={className}>{mins}m ago</span>;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return <span className={className}>{hours}h ago</span>;

  return <span className={className}>{Math.floor(hours / 24)}d ago</span>;
}
