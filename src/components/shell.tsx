import Link from "next/link";

import { cx } from "./ui.tsx";

/**
 * Cue & Rail monogram, drawn inline rather than loaded as an asset.
 *
 * The DESIGN.md wordmark is a rotated 45° square with a horizontal sighting rule —
 * the same diamond used for table status. Rendering it as two elements avoids a
 * network round-trip and keeps the mark crisp at any size.
 */
export function Monogram({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center border border-emerald"
      style={{ width: size, height: size }}
    >
      <span
        className="bg-emerald"
        style={{ width: size * 0.22, height: size * 0.22, transform: "rotate(45deg)" }}
      />
    </span>
  );
}

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 focus-visible:outline-none">
      <Monogram />
      <span className="text-headline-sm font-semibold uppercase tracking-tight text-ink">
        Cue &amp; Rail
      </span>
    </Link>
  );
}

/**
 * A navigation item. The active one is marked with the Trajectory Line — a
 * 1.5px emerald rule snapping beneath it — rather than a filled pill.
 */
export function NavItem({
  href,
  children,
  active,
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      data-active={active ? "true" : "false"}
      className={cx(
        "trajectory flex h-10 items-center px-1 font-sans text-body-md transition-colors",
        active ? "font-semibold text-emerald" : "text-ink-secondary hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-surface">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-4 md:px-10">
        <Wordmark />
        <nav className="flex items-center gap-6" aria-label="Navigasi utama">
          <NavItem href="/meja">Cari Meja</NavItem>
          <NavItem href="/booking">Booking Saya</NavItem>
          <Link
            href="/admin"
            className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted hover:text-ink"
          >
            Kasir
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="mt-auto border-t border-rule bg-surface">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-2 px-4 py-4 md:px-10">
        <span className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-faint">
          Cue &amp; Rail Club · Reservation &amp; Table Management
        </span>
        <span className="font-mono text-label-sm text-ink-faint">WIB · 10:00–02:00</span>
      </div>
    </footer>
  );
}
