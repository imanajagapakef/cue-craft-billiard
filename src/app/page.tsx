import type { Metadata } from "next";
import Link from "next/link";

import { PublicFooter, PublicHeader } from "@/components/shell.tsx";
import { getTableStates } from "@/lib/tableState.ts";
import { db } from "@/lib/db.ts";
import { getSettings } from "@/lib/settings.ts";
import { rupiah, StatusBadge, SectionTitle } from "@/components/ui.tsx";

export const metadata: Metadata = {
  title: "Cue & Rail — Reservasi Meja Billiard",
  description:
    "Lihat meja yang tersedia, pesan dengan DP, dan datang tanpa harus datang lebih awal untuk mengecek.",
};

// The occupancy strip is live data. Prerendering it would freeze the table states
// into the build output.
export const dynamic = "force-dynamic";

/**
 * Venue home — the customer_booking_venue_home Stitch screen.
 *
 * The live occupancy strip is the whole pitch of the product: it is the answer to
 * "do I have to come down and ask?". Everything else on this page is framing.
 */
export default async function Home() {
  const [states, settings, pricing] = await Promise.all([
    getTableStates(),
    getSettings(),
    db.pricingRule.findMany({ where: { active: true }, orderBy: { hourlyPrice: "asc" } }),
  ]);

  const counts = states.reduce<Record<string, number>>((acc, t) => {
    acc[t.state] = (acc[t.state] ?? 0) + 1;
    return acc;
  }, {});

  const open = counts.AVAILABLE ?? 0;
  const inPlay = counts.OCCUPIED ?? 0;

  return (
    <>
      <PublicHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="border-b border-rule bg-surface">
          <div className="mx-auto w-full max-w-[1200px] px-4 py-10 md:px-10 md:py-14">
            <div className="font-mono text-label-sm uppercase tracking-[0.06em] text-emerald">
              The Rail Club · Precision Rails · 12 Tables
            </div>
            <h1 className="mt-3 max-w-3xl text-display-mobile font-semibold tracking-tight text-ink md:text-headline-lg">
              Meja dulu, baru datang.
            </h1>
            <p className="mt-4 max-w-2xl text-body-lg text-ink-secondary">
              Cek meja yang kosong hari ini, kunci dengan DP, dan datang saat jadwalmu. Tidak
              perlu datang lebih awal untuk bertanya ke kasir.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/meja"
                className="rounded-core bg-emerald px-5 py-2.5 text-body-md font-semibold text-white transition-colors hover:bg-emerald-deep"
              >
                Pesan Meja
              </Link>
              <Link
                href="/booking"
                className="rounded-core border border-rule-strong bg-surface px-5 py-2.5 text-body-md font-semibold text-ink transition-colors hover:bg-surface-accent"
              >
                Cek Booking Saya
              </Link>
            </div>

            {/* Live occupancy — the core product answer. */}
            <dl className="mt-10 grid grid-cols-2 gap-px border border-rule bg-rule md:grid-cols-4">
              <Stat label="Tersedia" value={open} accent />
              <Stat label="Sedang Dimaini" value={inPlay} />
              <Stat label="Ditahan" value={counts.HELD ?? 0} />
              <Stat label="Maintenance" value={counts.MAINTENANCE ?? 0} />
            </dl>
          </div>
        </section>

        {/* Table rail */}
        <section className="border-b border-rule bg-canvas-recessed">
          <div className="mx-auto w-full max-w-[1200px] px-4 py-10 md:px-10">
            <SectionTitle
              eyebrow="Floor Status"
              title="Kondisi meja sekarang"
              action={
                <span className="font-mono text-label-sm text-ink-muted">
                  {states.length} meja terdaftar
                </span>
              }
            />
            <ul className="mt-6 grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
              {states.map((t) => (
                <li key={t.tableId} className="bg-surface px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-label-md text-ink">{t.code}</div>
                      <div className="truncate text-body-sm text-ink-secondary">{t.name}</div>
                    </div>
                    <StatusBadge state={t.state} />
                  </div>
                  {t.zone ? (
                    <div className="mt-2 font-mono text-label-sm uppercase tracking-[0.06em] text-ink-faint">
                      {t.zone}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Pricing */}
        <section>
          <div className="mx-auto w-full max-w-[1200px] px-4 py-10 md:px-10">
            <SectionTitle eyebrow="Rate Card" title="Harga per jam" />
            <div className="mt-6 overflow-x-auto border border-rule bg-surface">
              <table className="w-full border-collapse text-body-md">
                <thead>
                  <tr className="border-b border-rule text-left">
                    <th className="px-4 py-2 font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
                      Tipe
                    </th>
                    <th className="px-4 py-2 font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
                      Periode
                    </th>
                    <th className="px-4 py-2 text-right font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
                      Rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pricing.map((p) => (
                    <tr key={p.id} className="border-b border-rule last:border-0 hover:bg-canvas-recessed">
                      <td className="px-4 py-2.5 text-ink">{p.tableType}</td>
                      <td className="px-4 py-2.5 font-mono text-label-md text-ink-secondary">
                        {p.name.split("·")[1]?.trim() ?? p.name}
                        <span className="ml-2 text-ink-faint">
                          {String(Math.floor(p.startsAtMin / 60)).padStart(2, "0")}:
                          {String(p.startsAtMin % 60).padStart(2, "0")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="font-mono tabular-nums text-ink">{rupiah(p.hourlyPrice)}</span>
                        <span className="ml-1 font-mono text-label-sm text-ink-faint">/hr</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-body-sm text-ink-muted">
              Booking wajib DP {settings.depositPercent}% dengan minimum{" "}
              {rupiah(settings.depositMinIdr)}. Meja ditahan {settings.holdDurationMinutes} menit
              sebelum dilepas otomatis.
            </p>
          </div>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="bg-surface px-4 py-4">
      <dt className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </dt>
      <dd
        className={`mt-1 font-mono text-headline-md tabular-nums ${accent ? "text-emerald" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}
