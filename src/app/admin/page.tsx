import Link from "next/link";

import type { Metadata } from "next";

import { AdminShell } from "@/components/adminShell.tsx";
import { Countdown } from "@/components/live.tsx";
import {
  Empty,
  Meta,
  SectionTitle,
  StatusBadge,
  rupiah,
  cx,
} from "@/components/ui.tsx";
import { db } from "@/lib/db.ts";
import { getTableStates } from "@/lib/tableState.ts";
import { getSettings } from "@/lib/settings.ts";
import { expireLapsedHolds } from "@/lib/sweep.ts";
import { fmtRange, fmtTime } from "@/components/ui.tsx";

export const metadata: Metadata = { title: "Floor Ops — Cue & Rail" };
export const dynamic = "force-dynamic";

/**
 * Venue operations — venue_operations_floor_command, then
 * table_operations_spatial_floor_command for the spatial view.
 *
 * The whole point of this screen, per Project.md §54: the cashier understands the
 * venue's condition from a single screen without clicking anything. So occupancy,
 * money, and the verification queue are all above the fold.
 */
export default async function AdminDashboard() {
  // Sweep first so a lapsed hold never shows as "needs attention" (§6).
  await expireLapsedHolds();

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [states, settings, pendingPayments, todayPayments, upcoming, checkingIn, expiring] =
    await Promise.all([
      getTableStates(),
      getSettings(),
      db.payment.findMany({
        where: { status: { in: ["PENDING", "PROOF_SUBMITTED"] }, booking: { status: "AWAITING_DEPOSIT" } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          method: true,
          status: true,
          amount: true,
          createdAt: true,
          booking: {
            select: {
              code: true,
              customerName: true,
              startAt: true,
              endAt: true,
              holdExpiresAt: true,
              table: { select: { code: true } },
            },
          },
        },
      }),
      db.payment.findMany({
        where: { status: "PAID", verifiedAt: { gte: dayStart } },
        select: { amount: true },
      }),
      db.booking.findMany({
        where: {
          status: "CONFIRMED",
          startAt: { gte: new Date(), lte: new Date(Date.now() + 6 * 3_600_000) },
        },
        orderBy: { startAt: "asc" },
        take: 10,
        select: {
          code: true,
          customerName: true,
          startAt: true,
          endAt: true,
          table: { select: { code: true } },
        },
      }),
      db.booking.findMany({
        where: { status: "CONFIRMED", startAt: { lte: new Date(Date.now() + 2 * 3_600_000) } },
        orderBy: { startAt: "asc" },
        take: 8,
        select: { code: true, customerName: true, startAt: true, table: { select: { code: true } } },
      }),
      db.booking.findMany({
        where: { status: "AWAITING_DEPOSIT", holdExpiresAt: { not: null, lt: new Date(Date.now() + 10 * 60_000) } },
        orderBy: { holdExpiresAt: "asc" },
        take: 6,
        select: { code: true, customerName: true, holdExpiresAt: true, table: { select: { code: true } } },
      }),
    ]);

  const counts = states.reduce<Record<string, number>>((acc, t) => {
    acc[t.state] = (acc[t.state] ?? 0) + 1;
    return acc;
  }, {});

  const revenueToday = todayPayments.reduce((s, p) => s + p.amount, 0);
  const occupancy = states.length ? ((counts.OCCUPIED ?? 0) / states.length) * 100 : 0;

  return (
    <AdminShell active="dashboard" pendingPayments={pendingPayments.length}>
      {/* Priority strip */}
      <section className="grid gap-px border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Pendapatan hari ini"
          value={rupiah(revenueToday)}
          sub={`${todayPayments.length} transaksi terverifikasi`}
          accent
        />
        <Metric
          label="Okupansi"
          value={`${Math.round(occupancy)}%`}
          sub={`${counts.OCCUPIED ?? 0} main · ${counts.AVAILABLE ?? 0} kosong`}
        />
        <Metric
          label="Menunggu verifikasi"
          value={String(pendingPayments.length)}
          sub="DP belum dikonfirmasi"
          alert={pendingPayments.length > 0}
        />
        <Metric
          label="Check-in dekat"
          value={String(checkingIn.length)}
          sub="Dalam 2 jam ke depan"
        />
      </section>

      {/* Verification queue */}
      {pendingPayments.length > 0 ? (
        <section className="mt-6">
          <SectionTitle
            eyebrow="Priority"
            title="Antrean verifikasi"
            action={
              <Link
                href="/admin/pembayaran"
                className="font-mono text-label-sm uppercase tracking-[0.06em] text-emerald underline"
              >
                Buka semua
              </Link>
            }
          />
          <ul className="mt-px border border-rule bg-surface">
            {pendingPayments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-4 border-b border-rule px-4 py-3 last:border-0 hover:bg-canvas-recessed"
              >
                <div className="w-28 shrink-0">
                  <div className="font-mono text-label-lg text-ink">{p.booking.table.code}</div>
                  <div className="font-mono text-label-sm text-ink-muted">{p.booking.code}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body-sm text-ink">{p.booking.customerName}</div>
                  <div className="font-mono text-label-sm text-ink-muted">
                    {fmtRange(p.booking.startAt, p.booking.endAt)} ·{" "}
                    {p.method === "QRIS" ? "QRIS" : "Cash"}
                  </div>
                </div>
                {p.booking.holdExpiresAt ? (
                  <Countdown endsAt={p.booking.holdExpiresAt} prefix="Hold" className="text-body-sm" />
                ) : null}
                <span className="font-mono tabular-nums text-body-md text-ink">
                  {rupiah(p.amount)}
                </span>
                <Link
                  href="/admin/pembayaran"
                  className="rounded-core bg-emerald px-3 py-1.5 font-mono text-label-sm font-semibold uppercase tracking-[0.06em] text-white hover:bg-emerald-deep"
                >
                  Verifikasi
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Expiring holds */}
      {expiring.length > 0 ? (
        <section className="mt-6 border border-maint bg-maint-wash px-4 py-3">
          <Meta className="text-maint">Hold akan segera habis</Meta>
          <ul className="mt-2 space-y-1">
            {expiring.map((b) => (
              <li
                key={b.code}
                className="flex flex-wrap items-center gap-3 font-mono text-label-md text-ink-secondary"
              >
                <span className="text-ink">{b.code}</span>
                <span>{b.table.code}</span>
                <span className="truncate text-ink-muted">{b.customerName}</span>
                {b.holdExpiresAt ? <Countdown endsAt={b.holdExpiresAt} className="text-maint" /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Floor */}
      <section className="mt-8">
        <SectionTitle
          eyebrow="Spatial Bay Matrix"
          title="Floor"
          action={<Meta>{states.length} meja</Meta>}
        />
        <ul className="mt-px grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {states.map((t) => (
            <li key={t.tableId} className="bg-surface px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-label-lg text-ink">{t.code}</div>
                  <div className="truncate text-body-sm text-ink-secondary">{t.name}</div>
                </div>
                <StatusBadge state={t.state} />
              </div>

              <div className="mt-3 border-t border-rule pt-2">
                {t.state === "AVAILABLE" ? (
                  <p className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-faint">
                    Siap untuk walk-in
                  </p>
                ) : t.customerName ? (
                  <>
                    <div className="truncate text-body-sm text-ink">{t.customerName}</div>
                    <div className="mt-0.5 flex items-baseline justify-between gap-2">
                      <span className="font-mono text-label-sm text-ink-muted">
                        {t.bookingCode}
                      </span>
                      {/* A held table counts down to the hold lapsing; an occupied
                          one counts down to the session ending. Different
                          questions, so different clocks. */}
                      {t.state === "HELD" && t.holdExpiresAt ? (
                        <Countdown endsAt={t.holdExpiresAt} prefix="Hold" className="text-label-md" />
                      ) : t.busyUntil ? (
                        <Countdown endsAt={t.busyUntil} prefix="Sisa" className="text-label-md" />
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Upcoming */}
      <section className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          <SectionTitle eyebrow="Ledger" title="Check-in akan datang" />
          {upcoming.length === 0 ? (
            <div className="mt-px">
              <Empty>Tidak ada booking CONFIRMED dalam 6 jam ke depan.</Empty>
            </div>
          ) : (
            <ul className="mt-px border border-rule bg-surface">
              {upcoming.map((b) => (
                <li
                  key={b.code}
                  className="flex items-center gap-3 border-b border-rule px-4 py-2.5 last:border-0 hover:bg-canvas-recessed"
                >
                  <span className="w-12 shrink-0 font-mono text-label-md tabular-nums text-emerald">
                    {fmtTime(b.startAt)}
                  </span>
                  <span className="font-mono text-label-md text-ink">{b.table.code}</span>
                  <span className="min-w-0 flex-1 truncate text-body-sm text-ink-secondary">
                    {b.customerName}
                  </span>
                  <Link
                    href={`/admin/booking/${b.code}`}
                    className="font-mono text-label-sm uppercase tracking-[0.06em] text-emerald underline"
                  >
                    {b.code}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <SectionTitle eyebrow="Policy" title="Aturan operasional" />
          <dl className="mt-px border border-rule bg-surface px-4 py-3">
            <Policy label="DP" value={`${settings.depositPercent}% min ${rupiah(settings.depositMinIdr)}`} />
            <Policy label="Hold" value={`${settings.holdDurationMinutes} menit`} />
            <Policy label="Buffer antar sesi" value={`${settings.bufferMinutes} menit`} />
            <Policy label="Grace overrun" value={`${settings.graceMinutes} menit`} />
            <Policy
              label="Extension"
              value={`${settings.extensionIncrementsMinutes.join(" / ")} menit`}
            />
            <Policy label="Batal gratis" value={`> ${settings.cancelFreeUntilHours} jam sebelum mulai`} />
          </dl>
          <p className="mt-2 text-body-sm text-ink-muted">
            Semua nilai ini bisa diubah owner tanpa deploy — baca dari tabel{" "}
            <span className="font-mono">settings</span>.
          </p>
        </div>
      </section>
    </AdminShell>
  );
}

function Metric({
  label,
  value,
  sub,
  accent,
  alert,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  alert?: boolean;
}) {
  return (
    <div className={cx("bg-surface px-4 py-4", alert && "bg-maint-wash")}>
      <Meta className={alert ? "text-maint" : undefined}>{label}</Meta>
      <div
        className={cx(
          "mt-1 font-mono text-headline-md tabular-nums",
          alert ? "text-maint" : accent ? "text-emerald" : "text-ink",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-body-sm text-ink-muted">{sub}</div>
    </div>
  );
}

function Policy({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5 last:border-0">
      <dt className="text-body-sm text-ink-muted">{label}</dt>
      <dd className="font-mono tabular-nums text-body-sm text-ink-secondary">{value}</dd>
    </div>
  );
}
