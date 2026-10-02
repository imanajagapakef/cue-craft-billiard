import type { ReactNode } from "react";

/**
 * Cue & Rail primitives — built from KITAB DESIGN/cue_rail_system/DESIGN.md.
 *
 * Rules encoded here rather than repeated per screen: architectural 4px corners,
 * no pills, 1px hairline rules instead of shadows, one floating shadow only for
 * genuinely floating things, and every number rendered in JetBrains Mono so digits
 * do not shift width during live updates.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── Status ────────────────────────────────────────────────────────────────────

export type TableState = "AVAILABLE" | "HELD" | "RESERVED" | "OCCUPIED" | "MAINTENANCE";

/**
 * Each status couples a tone with a geometric anchor, per DESIGN.md "Table
 * Status Tokens". The glyph carries the meaning for anyone who cannot rely on
 * colour alone.
 */
const STATE_STYLE: Record<TableState, { bg: string; fg: string; glyph: ReactNode; label: string }> = {
  AVAILABLE: {
    bg: "bg-open-wash",
    fg: "text-open",
    glyph: <span className="h-2 w-2 rounded-full bg-current" />,
    label: "Open",
  },
  HELD: {
    bg: "bg-reserved-wash",
    fg: "text-reserved",
    glyph: <span className="diamond" />,
    label: "Held",
  },
  RESERVED: {
    bg: "bg-reserved-wash",
    fg: "text-reserved",
    glyph: <span className="diamond" />,
    label: "Reserved",
  },
  OCCUPIED: {
    bg: "bg-inplay-wash",
    fg: "text-inplay",
    glyph: <span className="h-2 w-2 rounded-full bg-current" />,
    label: "In Play",
  },
  MAINTENANCE: {
    bg: "bg-maint-wash",
    fg: "text-maint",
    glyph: <span className="text-[13px] leading-none">—</span>,
    label: "Maintenance",
  },
};

export function StatusBadge({ state, label }: { state: TableState; label?: string }) {
  const s = STATE_STYLE[state];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.06em]",
        s.bg,
        s.fg,
      )}
    >
      <span
        className={cx(
          "inline-flex items-center",
          // The occupied dot pulses; nothing else animates.
          state === "OCCUPIED" && "motion-safe:animate-pulse",
        )}
        aria-hidden
      >
        {s.glyph}
      </span>
      {label ?? s.label}
    </span>
  );
}

const BOOKING_STYLE: Record<string, { bg: string; fg: string }> = {
  PENDING: { bg: "bg-surface-accent", fg: "text-ink-muted" },
  AWAITING_DEPOSIT: { bg: "bg-reserved-wash", fg: "text-reserved" },
  CONFIRMED: { bg: "bg-open-wash", fg: "text-open" },
  CHECKED_IN: { bg: "bg-inplay-wash", fg: "text-inplay" },
  COMPLETED: { bg: "bg-surface-accent", fg: "text-ink-muted" },
  CANCELLED: { bg: "bg-maint-wash", fg: "text-maint" },
  EXPIRED: { bg: "bg-maint-wash", fg: "text-maint" },
  NO_SHOW: { bg: "bg-maint-wash", fg: "text-maint" },
};

const PAYMENT_STYLE: Record<string, { bg: string; fg: string }> = {
  PENDING: { bg: "bg-surface-accent", fg: "text-ink-muted" },
  PROOF_SUBMITTED: { bg: "bg-inplay-wash", fg: "text-inplay" },
  PAID: { bg: "bg-open-wash", fg: "text-open" },
  REJECTED: { bg: "bg-maint-wash", fg: "text-maint" },
  REFUNDED: { bg: "bg-reserved-wash", fg: "text-reserved" },
};

/** Booking and payment statuses are separate vocabularies, never merged. */
export function BookingBadge({ status }: { status: string }) {
  const s = BOOKING_STYLE[status] ?? BOOKING_STYLE.PENDING;
  return (
    <span
      className={cx(
        "inline-block px-2 py-0.5 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.06em]",
        s.bg,
        s.fg,
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function PaymentBadge({ status }: { status: string }) {
  const s = PAYMENT_STYLE[status] ?? PAYMENT_STYLE.PENDING;
  return (
    <span
      className={cx(
        "inline-block px-2 py-0.5 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.06em]",
        s.bg,
        s.fg,
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ── Numbers ───────────────────────────────────────────────────────────────────

const rupiah = (n: number) =>
  `Rp${Math.round(n).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;

export function Rupiah({ value, className }: { value: number; className?: string }) {
  // Financial data is strictly right-aligned with tabular figures, per DESIGN.md.
  return <span className={cx("font-mono tabular-nums", className)}>{rupiah(value)}</span>;
}

export { rupiah };

/** `HH:MM:SS`, monospaced so width never changes between updates. */
export function clockHMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/** `MM:SS`, for durations under an hour. */
export function clockMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

const timeFmt = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Jakarta",
});

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

export const fmtTime = (d: Date) => timeFmt.format(d);
export const fmtDate = (d: Date) => dateFmt.format(d);

export function fmtRange(a: Date, b: Date): string {
  return `${fmtTime(a)}–${fmtTime(b)}`;
}

/** Minutes from local midnight, the unit the whole domain speaks. */
export function minutesOfDay(d: Date): number {
  const shifted = new Date(d.getTime() + 7 * 60 * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function fromMinutesOfDay(dateStr: string, minutes: number): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - 7 * 60 * 60_000);
}

/** `YYYY-MM-DD` for the venue's local day, not UTC. */
export function localDateStr(d: Date): string {
  return new Date(d.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 10);
}

// ── Buttons ───────────────────────────────────────────────────────────────────

type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const BUTTON_VARIANT = {
  // Solid emerald, chalk text, architectural 4px corner. Press insets 1px.
  primary: "bg-emerald text-white hover:bg-emerald-deep active:translate-y-px disabled:bg-ink-faint",
  secondary: "bg-surface text-ink border border-rule-strong hover:bg-surface-accent active:translate-y-px",
  ghost: "bg-transparent text-ink-secondary hover:bg-surface-accent",
  danger: "bg-transparent text-maint border border-maint hover:bg-maint-wash",
} as const;

export function Button({
  children,
  variant = "primary",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        "rounded-core px-4 py-2 font-sans text-body-sm font-semibold transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald",
        "disabled:cursor-not-allowed disabled:opacity-60",
        BUTTON_VARIANT[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── Form controls ─────────────────────────────────────────────────────────────

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block font-mono text-label-sm text-ink-muted uppercase tracking-[0.06em]">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
      {hint ? <span className="mt-1 block text-body-sm text-ink-muted">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        "w-full rounded-core border border-rule-strong bg-surface px-3 py-2 text-body-md text-ink",
        "placeholder:text-ink-faint",
        // 1px emerald border plus a soft outer ring. Never a thick blue focus ring.
        "focus:border-emerald focus:outline-none focus:ring-[3px] focus:ring-emerald/15",
        className,
      )}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cx(
        "w-full rounded-core border border-rule-strong bg-surface px-3 py-2 text-body-md text-ink",
        "focus:border-emerald focus:outline-none focus:ring-[3px] focus:ring-emerald/15",
        className,
      )}
    >
      {children}
    </select>
  );
}

// ── Structure ─────────────────────────────────────────────────────────────────

/** Sections are joined by hairlines, never by empty gaps. */
export function Rule({ className }: { className?: string }) {
  return <hr className={cx("border-0 border-t border-rule", className)} />;
}

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx("border border-rule bg-surface", className)}>{children}</div>;
}

export function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-rule pb-3">
      <div>
        {eyebrow ? (
          <div className="font-mono text-label-sm uppercase tracking-[0.06em] text-emerald">
            {eyebrow}
          </div>
        ) : null}
        <h2 className="text-headline-sm font-semibold tracking-tight text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/** Small uppercase monospace meta label — the DESIGN.md operational voice. */
export function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="border border-dashed border-rule-strong bg-surface px-4 py-10 text-center text-body-md text-ink-muted">
      {children}
    </div>
  );
}

/** Inline error surface for a form-level failure. */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="border border-maint bg-maint-wash px-3 py-2 text-body-sm text-maint"
    >
      {children}
    </div>
  );
}
