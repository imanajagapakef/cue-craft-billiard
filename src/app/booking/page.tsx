import type { Metadata } from "next";

import { PublicFooter, PublicHeader } from "@/components/shell.tsx";
import { BookingLookup } from "@/components/bookingLookup.tsx";
import { SectionTitle } from "@/components/ui.tsx";
import { db } from "@/lib/db.ts";
import { getSettings } from "@/lib/settings.ts";

export const metadata: Metadata = {
  title: "Booking Saya — Cue & Rail",
};

export const dynamic = "force-dynamic";

/**
 * Booking lookup — my_bookings_match_ledger.
 *
 * Recent confirmed bookings are listed publicly as a convenience. Names are not
 * shown: a venue's booking list is public information nobody should be able to
 * scrape. The customer reaches their own detail through code + phone.
 */
export default async function BookingIndexPage() {
  const [upcoming, settings] = await Promise.all([
    db.booking.findMany({
      where: {
        status: { in: ["AWAITING_DEPOSIT", "CONFIRMED", "CHECKED_IN"] },
        startAt: { gte: new Date() },
      },
      orderBy: { startAt: "asc" },
      take: 8,
      select: {
        code: true,
        startAt: true,
        endAt: true,
        status: true,
        table: { select: { code: true, type: true } },
      },
    }),
    getSettings(),
  ]);

  return (
    <>
      <PublicHeader />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 md:px-10 md:py-10">
        <SectionTitle
          eyebrow="Ledger"
          title="Booking saya"
          action={
            <span className="font-mono text-label-sm text-ink-muted">
              {settings.venueName}
            </span>
          }
        />

        <div className="mt-6">
          <BookingLookup />
        </div>

        {upcoming.length > 0 ? (
          <section className="mt-10">
            <h3 className="border-b border-rule pb-2 font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
              akan datang
            </h3>
            {/* Codes and times only — no customer names. */}
            <ul className="mt-px border border-rule bg-surface">
              {upcoming.map((b) => (
                <li
                  key={b.code}
                  className="flex items-center justify-between gap-4 border-b border-rule px-4 py-2.5 last:border-0"
                >
                  <span className="font-mono text-label-lg text-ink">{b.code}</span>
                  <span className="font-mono text-label-sm text-ink-secondary">
                    {b.table.code} · {b.table.type}
                  </span>
                  <span className="font-mono text-label-sm tabular-nums text-ink-muted">
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
            <p className="mt-2 text-body-sm text-ink-muted">
              Untuk membuka salah satu, masukkan kode dan nomor HP di atas.
            </p>
          </section>
        ) : null}
      </main>
      <PublicFooter />
    </>
  );
}
