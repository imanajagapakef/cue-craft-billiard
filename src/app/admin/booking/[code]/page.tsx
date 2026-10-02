import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminShell } from "@/components/adminShell.tsx";
import { TimeAgo } from "@/components/live.tsx";
import {
  BookingBadge,
  Meta,
  Panel,
  PaymentBadge,
  Rule,
  SectionTitle,
  fmtDate,
  fmtRange,
  rupiah,
} from "@/components/ui.tsx";
import { db } from "@/lib/db.ts";
import { expireLapsedHolds } from "@/lib/sweep.ts";

export const metadata: Metadata = { title: "Dossier Booking — Cue & Rail" };
export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  "booking.created": "Booking dibuat",
  "booking.hold_expired": "Hold kedaluwarsa",
  "booking.checked_in": "Check-in",
  "booking.walk_in": "Walk-in dicatat",
  "booking.cancelled": "Dibatalkan",
  "booking.no_show": "Tidak hadir",
  "booking.shifted_by_extension_override": "Digeser oleh override extension",
  "payment.proof_submitted": "Bukti pembayaran dikirim",
  "payment.confirmed.deposit": "DP dikonfirmasi",
  "payment.confirmed.extension": "Extension dikonfirmasi",
  "payment.confirmed.final": "Pelunasan diterima",
  "payment.rejected": "Pembayaran ditolak",
  "extension.requested": "Extension diminta",
  "extension.requested_override": "Extension diminta (override)",
  "session.ended": "Sesi selesai",
};

/**
 * Staff dossier — detailed_booking_record_staff_dossier.
 *
 * Everything about one booking in one place, including the full audit timeline.
 * The staff view deliberately exposes customer contact and the reason strings the
 * customer never sees, which is the entire reason it exists separately from
 * /booking/[code].
 */
export default async function DossierPage(props: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await props.params;
  await expireLapsedHolds([code.toUpperCase()]);

  const booking = await db.booking.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      table: true,
      payments: { orderBy: { createdAt: "asc" } },
      sessions: { orderBy: { startedAt: "desc" }, include: { extensions: true } },
      extensions: { orderBy: { createdAt: "asc" } },
      notifications: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!booking) notFound();

  const [timeline, pendingCount] = await Promise.all([
    db.auditLog.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    db.payment.count({ where: { status: { in: ["PENDING", "PROOF_SUBMITTED"] } } }),
  ]);

  const paid = booking.payments
    .filter((p) => p.status === "PAID")
    .reduce((s, p) => s + p.amount, 0);
  const session = booking.sessions[0] ?? null;

  return (
    <AdminShell active="dashboard" pendingPayments={pendingCount}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-4">
        <div>
          <Meta>Staff Dossier</Meta>
          <h1 className="mt-1 font-mono text-headline-lg tracking-tight text-ink">
            {booking.code}
          </h1>
          <div className="mt-1 text-body-md text-ink">
            {booking.customerName} ·{" "}
            <a href={`tel:${booking.customerPhone}`} className="font-mono text-ink-secondary">
              {booking.customerPhone}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <BookingBadge status={booking.status} />
          {session ? (
            <Link
              href={`/admin/sesi/${session.id}`}
              className="rounded-core bg-emerald px-3 py-1.5 font-mono text-label-sm font-semibold uppercase tracking-[0.06em] text-white hover:bg-emerald-deep"
            >
              Kontrol sesi
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          {/* Facts */}
          <Panel>
            <div className="border-b border-rule px-4 py-3">
              <Meta>Detail</Meta>
            </div>
            <dl className="grid gap-3 px-4 py-4 sm:grid-cols-2">
              <Fact label="Meja" value={`${booking.table.code} · ${booking.table.name}`} />
              <Fact label="Tipe / zona" value={`${booking.table.type} · ${booking.table.zone ?? "—"}`} />
              <Fact label="Tanggal" value={fmtDate(booking.startAt)} />
              <Fact label="Jam" value={fmtRange(booking.startAt, booking.endAt)} />
              <Fact label="Durasi" value={`${booking.durationMinutes} menit`} />
              <Fact label="Sumber" value={booking.source.replace(/_/g, " ")} />
              {booking.checkedInAt ? (
                <Fact label="Check-in" value={fmtRange(booking.checkedInAt, booking.checkedInAt)} />
              ) : null}
              {booking.holdExpiresAt ? (
                <Fact
                  label="Hold berakhir"
                  value={fmtRange(booking.holdExpiresAt, booking.holdExpiresAt)}
                />
              ) : null}
              {booking.cancelReason ? (
                <Fact label="Alasan batal" value={booking.cancelReason} />
              ) : null}
            </dl>
          </Panel>

          {/* Audit timeline */}
          <section>
            <SectionTitle eyebrow="Audit" title="Timeline" />
            <ol className="mt-px border border-rule bg-surface">
              {timeline.map((t) => (
                <li
                  key={t.id}
                  className="flex items-baseline gap-3 border-b border-rule px-4 py-2.5 last:border-0 hover:bg-canvas-recessed"
                >
                  <span className="w-28 shrink-0 font-mono text-label-sm tabular-nums text-ink-muted">
                    {t.createdAt.toLocaleString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      timeZone: "Asia/Jakarta",
                    })}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-sm text-ink">
                      {ACTION_LABEL[t.action] ?? t.action}
                    </span>
                    <span className="block font-mono text-label-sm text-ink-muted">
                      {t.actorType.toLowerCase()}
                      {t.actorName ? ` · ${t.actorName}` : ""}
                    </span>
                    {t.reason ? (
                      <span className="block text-body-sm text-ink-secondary">{t.reason}</span>
                    ) : null}
                  </span>
                  <TimeAgo at={t.createdAt} />
                </li>
              ))}
            </ol>
          </section>

          {/* Notifications */}
          {booking.notifications.length > 0 ? (
            <section>
              <SectionTitle eyebrow="Outbox" title="Notifikasi WhatsApp" />
              <ul className="mt-px border border-rule bg-surface">
                {booking.notifications.map((n) => (
                  <li key={n.id} className="border-b border-rule px-4 py-2.5 last:border-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
                        {n.event.replace(/_/g, " ")}
                      </span>
                      <span
                        className={`font-mono text-label-sm uppercase tracking-[0.06em] ${
                          n.status === "FAILED"
                            ? "text-maint"
                            : n.status === "SENT"
                              ? "text-open"
                              : "text-ink-faint"
                        }`}
                      >
                        {n.status}
                      </span>
                    </div>
                    <pre className="mt-1.5 whitespace-pre-wrap font-sans text-body-sm text-ink-secondary">
                      {n.body}
                    </pre>
                    {n.errorMessage ? (
                      <p className="mt-1 font-mono text-label-sm text-maint">{n.errorMessage}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-body-sm text-ink-muted">
                Kegagalan WhatsApp tidak pernah membatalkan pembayaran atau booking.
              </p>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <Panel>
            <div className="border-b border-rule px-4 py-3">
              <Meta>Uang</Meta>
            </div>
            <div className="space-y-2 px-4 py-3">
              <Row label="Total" value={rupiah(booking.totalPrice)} />
              <Row label="DP" value={rupiah(booking.depositAmount)} />
              <Row label="Sisa" value={rupiah(booking.remainingAmount)} />
              <Row label="Extension" value={rupiah(booking.extensions.reduce((s, e) => s + e.price, 0))} />
              <Rule className="my-1" />
              <Row label="Sudah dibayar" value={rupiah(paid)} strong />
              <Row label="Belum dibayar" value={rupiah(Math.max(0, booking.totalPrice + booking.extensions.reduce((s, e) => s + e.price, 0) - paid))} strong />
            </div>
          </Panel>

          <Panel>
            <div className="border-b border-rule px-4 py-3">
              <Meta>Pembayaran</Meta>
            </div>
            <ul>
              {booking.payments.map((p) => (
                <li key={p.id} className="border-b border-rule px-4 py-2.5 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
                      {p.kind}
                    </span>
                    <PaymentBadge status={p.status} />
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-2">
                    <span className="font-mono tabular-nums text-body-sm text-ink">
                      {rupiah(p.amount)}
                    </span>
                    <span className="font-mono text-label-sm text-ink-faint">
                      {p.method === "QRIS" ? "QRIS" : "Cash"}
                    </span>
                  </div>
                  {p.proofPath ? (
                    <a
                      href={p.proofPath}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block font-mono text-label-sm text-emerald underline"
                    >
                      bukti
                    </a>
                  ) : null}
                  {p.rejectionReason ? (
                    <p className="mt-1 text-body-sm text-maint">{p.rejectionReason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </AdminShell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-body-sm text-ink">{value}</dd>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? "font-mono text-label-md text-ink" : "text-body-sm text-ink-muted"}>
        {label}
      </dt>
      <dd
        className={
          strong
            ? "font-mono tabular-nums text-body-md text-emerald"
            : "font-mono tabular-nums text-body-sm text-ink-secondary"
        }
      >
        {value}
      </dd>
    </div>
  );
}
