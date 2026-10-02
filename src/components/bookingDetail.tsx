"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Countdown, TimeAgo } from "./live.tsx";
import { Monogram } from "./shell.tsx";
import {
  BookingBadge,
  Button,
  ErrorNote,
  Meta,
  Panel,
  PaymentBadge,
  Rule,
  SectionTitle,
  fmtDate,
  fmtRange,
  rupiah,
  cx,
} from "./ui.tsx";

/**
 * Booking detail, deposit checkout, and the keyless pass.
 *
 * Renders one of three faces depending on state, which is the state the customer
 * actually cares about:
 *   AWAITING_DEPOSIT → pay the deposit, with a live hold countdown
 *   CONFIRMED / CHECKED_IN → the pass they read aloud at the counter
 *   terminal → the record, plus cancellation if still allowed
 */

type Booking = {
  code: string;
  status: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  totalPrice: number;
  depositAmount: number;
  remainingAmount: number;
  holdExpiresAt: string | null;
  checkedInAt: string | null;
  cancelReason: string | null;
};

type Payment = {
  id: string;
  kind: string;
  method: string;
  status: string;
  amount: number;
  proofPath: string | null;
  proofUploadedAt: string | null;
  rejectionReason: string | null;
  verifiedAt: string | null;
};

type TimelineEntry = {
  id: number;
  at: string;
  action: string;
  actorName: string | null;
  reason: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  "booking.created": "Booking dibuat",
  "booking.hold_expired": "Hold kedaluwarsa",
  "booking.checked_in": "Check-in",
  "booking.walk_in": "Walk-in dicatat",
  "booking.cancelled": "Dibatalkan",
  "booking.no_show": "Tidak hadir",
  "booking.shifted_by_extension_override": "Digeser oleh override",
  "payment.proof_submitted": "Bukti pembayaran dikirim",
  "payment.confirmed.deposit": "DP dikonfirmasi kasir",
  "payment.confirmed.extension": "Extension dikonfirmasi",
  "payment.confirmed.final": "Pelunasan diterima",
  "payment.rejected": "Pembayaran ditolak",
  "extension.requested": "Extension diminta",
  "extension.requested_override": "Extension diminta (override)",
  "session.ended": "Sesi selesai",
};

export function BookingDetail(props: {
  booking: Booking;
  table: { code: string; name: string; type: string; zone: string | null };
  payments: Payment[];
  session: {
    id: string;
    status: string;
    startedAt: string;
    scheduledEndAt: string;
    extendedMinutes: number;
  } | null;
  timeline: TimelineEntry[];
  venueName: string;
  qrisPayload: string | null;
  phone: string;
}) {
  const { booking, table, payments, session, timeline, venueName, qrisPayload } = props;
  const start = new Date(booking.startAt);
  const end = new Date(booking.endAt);

  const deposit = payments.find((p) => p.kind === "DEPOSIT");
  const awaiting =
    booking.status === "AWAITING_DEPOSIT" || deposit?.status === "PROOF_SUBMITTED";

  return (
    <div className="space-y-8">
      {/* Header rail */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-4">
        <div>
          <Meta>Booking Code</Meta>
          <div className="mt-1 font-mono text-headline-md tracking-tight text-ink">
            {booking.code}
          </div>
          <div className="mt-1 text-body-sm text-ink-muted">{booking.customerName}</div>
        </div>
        <BookingBadge status={booking.status} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          {/* Deposit checkout */}
          {awaiting && deposit ? (
            <DepositPanel
              booking={booking}
              deposit={deposit}
              venueName={venueName}
              qrisPayload={qrisPayload}
              phone={props.phone}
            />
          ) : null}

          {/* Keyless pass */}
          {booking.status === "CONFIRMED" || booking.status === "CHECKED_IN" || session ? (
            <Pass booking={booking} table={table} start={start} end={end} venueName={venueName} session={session} />
          ) : null}

          {/* Terminal record */}
          {["COMPLETED", "CANCELLED", "EXPIRED", "NO_SHOW"].includes(booking.status) ? (
            <Panel className="px-4 py-4">
              <Meta>
                {booking.status === "COMPLETED"
                  ? "Selesai"
                  : booking.status === "CANCELLED"
                    ? "Dibatalkan"
                    : booking.status === "EXPIRED"
                      ? "Hold kedaluwarsa"
                      : "Tidak hadir"}
              </Meta>
              <p className="mt-1 text-body-md text-ink-secondary">
                {booking.cancelReason ??
                  (booking.status === "EXPIRED"
                    ? "DP tidak diterima sebelum hold habis, jadi meja dilepas untuk customer lain."
                    : "Booking ini sudah selesai.")}
              </p>
            </Panel>
          ) : null}

          {/* Timeline — §57 */}
          <section>
            <SectionTitle eyebrow="Timeline" title="Riwayat" />
            <ol className="mt-px border border-rule bg-surface">
              {timeline.length === 0 ? (
                <li className="px-4 py-6 text-center text-body-sm text-ink-muted">
                  Belum ada aktivitas tercatat.
                </li>
              ) : (
                timeline.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-baseline gap-3 border-b border-rule px-4 py-2.5 last:border-0 hover:bg-canvas-recessed"
                  >
                    <span className="w-16 shrink-0 font-mono text-label-sm tabular-nums text-ink-muted">
                      {new Date(t.at).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        timeZone: "Asia/Jakarta",
                      })}
                    </span>
                    <span className="min-w-0 flex-1 text-body-sm text-ink">
                      {ACTION_LABEL[t.action] ?? t.action}
                      {t.actorName ? (
                        <span className="ml-2 font-mono text-label-sm text-ink-muted">
                          {t.actorName}
                        </span>
                      ) : null}
                      {t.reason ? (
                        <span className="block text-body-sm text-ink-muted">{t.reason}</span>
                      ) : null}
                    </span>
                    <TimeAgo at={t.at} />
                  </li>
                ))
              )}
            </ol>
          </section>
        </div>

        {/* Summary rail */}
        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <Panel>
            <div className="border-b border-rule px-4 py-3">
              <Meta>Ringkasan</Meta>
            </div>
            <dl className="space-y-2 px-4 py-3 text-body-sm">
              <Row label="Meja" value={table.code} />
              <Row label="Tipe" value={table.type} />
              {table.zone ? <Row label="Zona" value={table.zone} /> : null}
              <Row label="Tanggal" value={fmtDate(start)} />
              <Row label="Jam" value={fmtRange(start, end)} />
              <Rule className="my-1" />
              <Row label="Total" value={rupiah(booking.totalPrice)} strong />
              <Row label="DP" value={rupiah(booking.depositAmount)} />
              <Row label="Sisa" value={rupiah(booking.remainingAmount)} />
            </dl>
          </Panel>

          {payments.length > 0 ? (
            <Panel>
              <div className="border-b border-rule px-4 py-3">
                <Meta>Pembayaran</Meta>
              </div>
              <ul>
                {payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
                        {p.kind}
                      </div>
                      <div className="font-mono tabular-nums text-body-sm text-ink">
                        {rupiah(p.amount)}
                      </div>
                    </div>
                    <div className="text-right">
                      <PaymentBadge status={p.status} />
                      <div className="mt-0.5 font-mono text-label-sm text-ink-faint">
                        {p.method === "QRIS" ? "QRIS" : "Cash"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <CancelPanel booking={booking} phone={props.phone} />
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? "font-mono text-label-md text-ink" : "text-ink-muted"}>{label}</dt>
      <dd
        className={
          strong
            ? "font-mono tabular-nums text-body-md text-ink"
            : "font-mono tabular-nums text-body-sm text-ink-secondary"
        }
      >
        {value}
      </dd>
    </div>
  );
}

// ── Deposit ───────────────────────────────────────────────────────────────────

function DepositPanel(props: {
  booking: Booking;
  deposit: Payment;
  venueName: string;
  qrisPayload: string | null;
  phone: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("phone", props.phone);
      fd.append("proof", file);

      const res = await fetch(`/api/bookings/${props.booking.code}/proof`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "Upload gagal");
        return;
      }
      router.refresh();
    } catch {
      setError("Gagal menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  const isCash = props.deposit.method === "CASH_AT_COUNTER";
  const expired =
    props.booking.holdExpiresAt !== null && new Date(props.booking.holdExpiresAt) < new Date();

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <div>
          <Meta>Langkah terakhir · DP</Meta>
          <h2 className="mt-1 text-headline-sm font-semibold tracking-tight text-ink">
            Bayar DP {rupiah(props.deposit.amount)}
          </h2>
        </div>
        {props.booking.holdExpiresAt ? (
          <Countdown
            endsAt={props.booking.holdExpiresAt}
            prefix="Hold habis"
            className="text-body-md"
          />
        ) : null}
      </div>

      <div className="space-y-4 px-4 py-4">
        {error ? <ErrorNote>{error}</ErrorNote> : null}

        {expired ? (
          <ErrorNote>
            Hold sudah habis. Booking ini akan ditandai kedaluwarsa dan meja dilepas.
          </ErrorNote>
        ) : null}

        {isCash ? (
          <div className="border border-rule bg-canvas-recessed px-3 py-3">
            <p className="text-body-md text-ink">
              Bayar DP {rupiah(props.deposit.amount)} di kasir, lalu sebutkan kode{" "}
              <span className="font-mono">{props.booking.code}</span>.
            </p>
            <p className="mt-1 text-body-sm text-ink-muted">
              Meja ditahan sampai hold habis. Kasir yang mengonfirmasi pembayaran.
            </p>
          </div>
        ) : (
          <>
            <div className="border border-rule bg-canvas-recessed px-3 py-3">
              <Meta>QRIS</Meta>
              {props.qrisPayload ? (
                <div className="mt-2 border border-rule bg-surface p-3">
                  <p className="break-all font-mono text-label-md text-ink">
                    {props.qrisPayload}
                  </p>
                  <p className="mt-1 text-body-sm text-ink-muted">
                    Scan pakai aplikasi e-wallet kamu, lalu upload bukti di bawah.
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-body-sm text-ink-muted">
                  QRIS venue belum diatur. Set <span className="font-mono">qris_static_payload</span>{" "}
                  di tabel <span className="font-mono">settings</span>.
                </p>
              )}
            </div>

            {props.deposit.status === "PROOF_SUBMITTED" ? (
              <div className="border border-inplay bg-inplay-wash px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-body-md text-inplay">
                    Bukti terkirim. Menunggu verifikasi kasir.
                  </p>
                  <PaymentBadge status={props.deposit.status} />
                </div>
                {props.deposit.proofPath ? (
                  <a
                    href={props.deposit.proofPath}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block font-mono text-label-sm text-inplay underline"
                  >
                    Lihat bukti
                  </a>
                ) : null}
              </div>
            ) : (
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || expired}
                  onClick={() => fileRef.current?.click()}
                  className="w-full"
                >
                  {busy ? "Mengunggah…" : "Upload bukti pembayaran"}
                </Button>
                <p className="mt-1 text-body-sm text-ink-muted">
                  JPG, PNG, atau WebP. Maksimal 5 MB.
                </p>
              </div>
            )}

            {props.deposit.rejectionReason ? (
              <div className="border border-maint bg-maint-wash px-3 py-3">
                <Meta className="text-maint">Ditolak</Meta>
                <p className="mt-1 text-body-md text-maint">{props.deposit.rejectionReason}</p>
                <p className="mt-1 text-body-sm text-ink-secondary">
                  Upload ulang bukti yang benar selama hold masih aktif.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  );
}

// ── Keyless pass ──────────────────────────────────────────────────────────────

function Pass(props: {
  booking: Booking;
  table: { code: string; name: string; type: string; zone: string | null };
  start: Date;
  end: Date;
  venueName: string;
  session: {
    id: string;
    status: string;
    startedAt: string;
    scheduledEndAt: string;
    extendedMinutes: number;
  } | null;
}) {
  const { booking, table, session } = props;
  const endsAt = session
    ? new Date(
        new Date(session.scheduledEndAt).getTime() + session.extendedMinutes * 60_000,
      )
    : props.end;

  return (
    <div className="border border-emerald bg-surface">
      <div className="flex items-center gap-3 border-b border-rule px-4 py-3">
        <Monogram size={22} />
        <div>
          <Meta>Booking Terkonfirmasi</Meta>
          <h2 className="text-headline-sm font-semibold tracking-tight text-ink">
            Tunjukkan ke kasir
          </h2>
        </div>
      </div>

      <div className="px-4 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Meta>Meja</Meta>
            <div className="mt-1 font-mono text-headline-lg tracking-tight text-ink">
              {table.code}
            </div>
            <div className="text-body-sm text-ink-secondary">{table.name}</div>
          </div>
          <div className="text-right">
            <Meta>Selesai</Meta>
            {session ? (
              <Countdown endsAt={endsAt} long className="text-headline-md" />
            ) : (
              <div className="font-mono text-headline-md tabular-nums text-ink">
                {props.end.toLocaleTimeString("id-ID", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Jakarta",
                })}
              </div>
            )}
          </div>
        </div>

        <Rule className="my-4" />

        <dl className="grid gap-3 sm:grid-cols-2">
          <Row label="Tanggal" value={fmtDate(props.start)} />
          <Row label="Jam" value={fmtRange(props.start, props.end)} />
          <Row label="Nama" value={booking.customerName} />
          <Row label="Booking" value={booking.code} />
        </dl>

        {session ? (
          <p className="mt-4 border border-rule bg-canvas-recessed px-3 py-2 font-mono text-label-sm text-ink-secondary">
            Sesi aktif sejak{" "}
            {new Date(session.startedAt).toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Jakarta",
            })}
            {session.extendedMinutes > 0 ? ` · +${session.extendedMinutes} mnt extension` : ""}
          </p>
        ) : null}

        <p className="mt-4 text-body-sm text-ink-muted">
          Datang dan sebutkan kode <span className="font-mono">{booking.code}</span>. DP sudah
          diterima; sisa {rupiah(booking.remainingAmount)} dibayar saat keluar.
        </p>
      </div>
    </div>
  );
}

// ── Cancel ────────────────────────────────────────────────────────────────────

const CANCELLABLE = ["PENDING", "AWAITING_DEPOSIT", "CONFIRMED"];

function CancelPanel({ booking, phone }: { booking: Booking; phone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!CANCELLABLE.includes(booking.status)) return null;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${booking.code}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, party: "CUSTOMER", reason }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "Gagal membatalkan");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Gagal menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="border-b border-rule px-4 py-3">
        <Meta>Batalkan</Meta>
      </div>
      <div className="px-4 py-3">
        {!open ? (
          <>
            <p className="text-body-sm text-ink-muted">
              DP dikembalikan penuh jika dibatalkan lebih dari 2 jam sebelum mulai. Lebih dekat dari
              itu DP hangus.
            </p>
            <Button variant="danger" onClick={() => setOpen(true)} className="mt-3 w-full">
              Batalkan booking
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            <label className="block">
              <span className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
                Alasan (opsional)
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                className="mt-1 w-full rounded-core border border-rule-strong bg-surface px-3 py-2 text-body-md focus:border-emerald focus:outline-none focus:ring-[3px] focus:ring-emerald/15"
                placeholder="Contoh: jadwal berubah"
              />
            </label>
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => void cancel()} disabled={busy} className="flex-1">
                {busy ? "…" : "Ya, batalkan"}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)} className="flex-1">
                Kembali
              </Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

export { cx };
