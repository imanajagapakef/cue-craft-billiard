import type { Metadata, Viewport } from "next";

import { MobileShell } from "@/components/mobile.tsx";
import { BookingLookup } from "@/components/bookingLookup.tsx";
import { getSettings } from "@/lib/settings.ts";
import { db } from "@/lib/db.ts";
import { Meta } from "@/components/ui.tsx";

export const metadata: Metadata = { title: "Booking Saya — Cue & Rail" };
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#fbf9f5",
};

/**
 * Mobile booking lookup — reuses the desktop form, which is already a single
 * column and fits a phone unchanged.
 */
export default async function MobileBookingIndex() {
  const [settings, upcoming] = await Promise.all([
    getSettings(),
    db.booking.findMany({
      where: {
        status: { in: ["AWAITING_DEPOSIT", "CONFIRMED", "CHECKED_IN"] },
        startAt: { gte: new Date() },
      },
      orderBy: { startAt: "asc" },
      take: 6,
      select: { code: true, startAt: true, table: { select: { code: true } } },
    }),
  ]);

  return (
    <MobileShell active="/m/booking" title="Booking Saya" subtitle={settings.venueName}>
      <BookingLookup />

      {upcoming.length > 0 ? (
        <section className="mt-6">
          <Meta>akan datang</Meta>
          <ul className="mt-2 space-y-2">
            {upcoming.map((b) => (
              <li
                key={b.code}
                className="flex items-center justify-between gap-3 border border-rule bg-surface px-3 py-2"
              >
                <span className="font-mono text-label-lg text-ink">{b.code}</span>
                <span className="font-mono text-label-sm text-ink-muted">{b.table.code}</span>
                <span className="font-mono text-label-sm tabular-nums text-ink-secondary">
                  {b.startAt.toLocaleString("id-ID", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Jakarta",
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </MobileShell>
  );
}
