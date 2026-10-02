import Link from "next/link";

import type { ReactNode } from "react";
import { Monogram } from "./shell.tsx";
import { cx } from "./ui.tsx";

/**
 * Mobile shell — bottom tab bar plus a fixed action bar above it.
 *
 * Mirrors the Stitch mobile screens: a compact top rail, content that stops
 * short of the tab bar, and a floating action bar pinned just above it so the
 * primary action is always reachable with a thumb.
 *
 * Two details that are easy to get wrong and expensive to debug:
 *   - `env(safe-area-inset-bottom)` is reserved on the tab bar. Without it the
 *     lowest row sits under the iOS home indicator.
 *   - Content gets bottom padding equal to the tab bar height plus the action bar
 *     when one is present, otherwise the last card is unreachable.
 */

const TAB_H = "h-16";

const TABS = [
  { href: "/m/meja", label: "Meja", glyph: "M" },
  { href: "/m/booking", label: "Booking", glyph: "B" },
  { href: "/", label: "Web", glyph: "W" },
  { href: "/m/admin", label: "Kasir", glyph: "K" },
] as const;

export function MobileShell({
  active,
  title,
  subtitle,
  action,
  children,
}: {
  active: (typeof TABS)[number]["href"];
  title: string;
  subtitle?: string;
  /** Floating bar pinned above the tab bar. Omit for plain pages. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      {/* Top rail — compact, scrolls away */}
      <header className="sticky top-0 z-30 border-b border-rule bg-surface">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link href="/" aria-label="Cue & Rail">
            <Monogram size={26} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-headline-sm font-semibold tracking-tight text-ink">
              {title}
            </h1>
            {subtitle ? (
              <p className="truncate font-mono text-label-sm text-ink-muted">{subtitle}</p>
            ) : null}
          </div>
        </div>
      </header>

      {/* Content stops clear of the tab bar, and of the action bar above it */}
      <main
        className={cx(
          "flex-1 px-4 py-4",
          action ? "pb-36" : "pb-24",
        )}
      >
        {children}
      </main>

      {/* Floating action bar */}
      {action ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 px-4 pb-2">
          <div className="pointer-events-auto border border-rule bg-surface p-3 shadow-[var(--shadow-float)]">
            {action}
          </div>
        </div>
      ) : null}

      {/* Bottom tab bar */}
      <nav
        className={cx(
          "fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-rule bg-surface",
          TAB_H,
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Navigasi"
      >
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active === t.href ? "page" : undefined}
            className={cx(
              "flex min-h-[44px] flex-col items-center justify-center gap-0.5 transition-colors",
              active === t.href ? "text-emerald" : "text-ink-muted",
            )}
          >
            <span
              aria-hidden
              className={cx(
                "flex h-6 w-6 items-center justify-center border font-mono text-[0.625rem] font-semibold",
                active === t.href
                  ? "border-emerald bg-emerald-wash"
                  : "border-rule",
              )}
            >
              {t.glyph}
            </span>
            <span className="font-mono text-[0.5625rem] uppercase tracking-[0.06em]">
              {t.label}
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

/**
 * Horizontal scroller for date and slot chips.
 *
 * No scroll-snap library: `snap-x` plus `overflow-x-auto` is enough for a strip
 * of discrete chips, and it keeps the touch feel native.
 */
export function ChipStrip({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1">
      {children}
    </div>
  );
}

export function Chip({
  active,
  children,
  sub,
}: {
  active?: boolean;
  children: ReactNode;
  sub?: string;
}) {
  return (
    <span
      className={cx(
        "flex min-w-[68px] shrink-0 snap-start flex-col items-center justify-center rounded-core px-2 py-2 text-center transition-colors",
        active ? "bg-emerald text-white" : "bg-surface text-ink hover:bg-canvas-recessed",
      )}
    >
      <span className="font-mono text-label-sm font-semibold">{children}</span>
      {sub ? (
        <span className={cx("text-[0.625rem]", active ? "text-white/75" : "text-ink-muted")}>
          {sub}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A table as a rail-bordered inspection bar — the DESIGN.md mobile collapse
 * pattern. Touch target stays at 44px minimum.
 */
export function TableBar({
  code,
  name,
  zone,
  right,
  disabled,
  active,
  onClick,
}: {
  code: string;
  name: string;
  zone?: string | null;
  right: ReactNode;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  // A div when it is not interactive, so it never appears in the a11y tree as a
  // dead button. Spreading onClick onto a div would also break keyboard access.
  const className = cx(
    "flex min-h-[56px] w-full items-center gap-3 border px-3 py-2 text-left transition-colors",
    active ? "border-emerald bg-emerald-wash" : "border-rule bg-surface",
    onClick && !disabled && "hover:bg-canvas-recessed",
    disabled && "opacity-55",
  );

  const body = (
    <>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-label-lg text-ink">{code}</div>
        <div className="truncate text-body-sm text-ink-secondary">{name}</div>
        {zone ? (
          <div className="font-mono text-[0.625rem] uppercase tracking-[0.06em] text-ink-faint">
            {zone}
          </div>
        ) : null}
      </div>
      <div className="shrink-0 text-right">{right}</div>
    </>
  );

  if (!onClick) {
    return <div className={className}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
      aria-pressed={active}
    >
      {body}
    </button>
  );
}
