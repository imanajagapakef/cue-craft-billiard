"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Countdown } from "./live.tsx";
import {
  BookingBadge,
  Button,
  ErrorNote,
  Meta,
  Panel,
  PaymentBadge,
  Rule,
  fmtDate,
  fmtRange,
  rupiah,
} from "./ui.tsx";

/**
 * Mobile booking dossier — mobile_keyless_pass_booking_dossier.
 *
 * Ordered by what the customer needs in the moment: the pass to show the cashier
 * first, the deposit action second, the record third. One column, thumb-reachable,
 * no horizontal scrolling except where the data genuinely is a table.
 */

type Booking = {
  code: string;
  status: string;
  customerName: string;
  startAt: string;
  endAt: string;
  totalPrice: number;
  depositAmount: number;
  remainingAmount: number;
  holdExpiresAt: string | null;
};

type Payment = {
  id: string;
  kind: string;
  method: string;
  status: string;
  amount: number;
  proofPath: string | null;
  rejectionReason: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  "booking.created": "Booking dibuat",
  "booking.hold_expired": "Hold habis",
  "booking.checked_in": "Check-in",
  "booking.cancelled": "Dibatalkan",
  "booking.no_show": "Tidak hadir",
  "booking.walk_in": "Walk-in",
  "payment.proof_submitted": "Bukti dikirim",
  "payment.confirmed.deposit": "DP dikonfirmasi",
  "payment.confirmed.extension": "Extension dikonfirmasi",
  "payment.confirmed.final": "Pelunasan diterima",
  "payment.rejected": "Pembayaran ditolak",
  "extension.requested": "Extension diminta",
  "session.ended": "Sesi selesai",
};

export function MobileBookingDossier({
  booking,
  table,
  payments,
  session,
  timeline,
  phone,
}: {
  phone: string;
  booking: Booking;
  table: { code: string; name: string; zone: string | null };
  payments: Payment[];
  session: { scheduledEndAt: string; extendedMinutes: number } | null;
  timeline: { id: number; action: string; actorName: string | null }[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = new Date(booking.startAt);
  const end = new Date(booking.endAt);
  const deposit = payments.find((p) => p.kind === "DEPOSIT");
  const confirmed = ["CONFIRMED", "CHECKED_IN", "COMPLETED"].includes(booking.status);
  const endsAt = session
    ? new Date(new Date(session.scheduledEndAt).getTime() + session.extendedMinutes * 60_000)
    : end;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("phone", phone);
      fd.append("proof", file);
      const res = await fetch(`/api/bookings/${booking.code}/proof`, {
        method: "POST",
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j?.error?.message ?? "Upload gagal");
        return;
      }
      router.refresh();
    } catch {
      setError("Gagal menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Pass — the thing shown to the cashier */}
      <div className="border border-emerald bg-surface">
        <div className="border-b border-rule px-3 py-2">
          <BookingBadge status={booking.status} />
        </div>
        <div className="px-3 py-4 text-center">
          <Meta>Meja</Meta>
          <div className="mt-1 font-mono text-display-mobile font-semibold tracking-tight text-ink">
            {table.code}
          </div>
          <div className="mt-0.5 text-body-sm text-ink-secondary">{table.name}</div>

          <Rule className="my-3" />

          <div className="text-body-md text-ink">{fmtDate(start)}</div>
          <div className="mt-0.5 font-mono text-headline-md tabular-nums text-ink">
            {fmtRange(start, end)}
          </div>

          {session ? (
            <div className="mt-2 text-body-sm text-ink-muted">
              Sisa{" "}
              <Countdown endsAt={endsAt} long className="text-body-md" />
            </div>
          ) : null}

          <div className="mt-3 border border-rule bg-canvas-recessed px-3 py-2">
            <Meta>Sebutkan kode ini</Meta>
            <div className="mt-0.5 font-mono text-headline-sm tracking-tight text-ink">
              {booking.code}
            </div>
          </div>

          {confirmed ? (
            <p className="mt-3 text-body-sm text-ink-muted">
              DP sudah diterima. Sisa {rupiah(booking.remainingAmount)} dibayar saat keluar.
            </p>
          ) : null}
        </div>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {/* Deposit action */}
      {deposit && !confirmed ? (
        <Panel className="px-3 py-3">
          <div className="flex items-baseline justify-between">
            <Meta>Bayar DP</Meta>
            {booking.holdExpiresAt ? (
              <Countdown endsAt={booking.holdExpiresAt} prefix="Hold" className="text-label-md" />
            ) : null}
          </div>
          <div className="mt-1 font-mono text-headline-md tabular-nums text-ink">
            {rupiah(deposit.amount)}
          </div>

          {deposit.method === "CASH_AT_COUNTER" ? (
            <p className="mt-2 border border-rule bg-canvas-recessed px-3 py-2 text-body-sm text-ink-secondary">
              Bayar di kasir, lalu sebutkan kode {booking.code}. Meja ditahan sampai hold habis.
            </p>
          ) : deposit.status === "PROOF_SUBMITTED" ? (
            <div className="mt-2 border border-inplay bg-inplay-wash px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-body-sm text-inplay">Menunggu verifikasi kasir</span>
                <PaymentBadge status={deposit.status} />
              </div>
              {deposit.proofPath ? (
                <a
                  href={deposit.proofPath}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block font-mono text-label-sm text-inplay underline"
                >
                  Lihat bukti
                </a>
              ) : null}
            </div>
          ) : (
            <div className="mt-2">
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
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="min-h-[48px] w-full"
              >
                {busy ? "Mengunggah…" : "Upload bukti QRIS"}
              </Button>
              <p className="mt-1 text-body-sm text-ink-muted">
                JPG/PNG/WebP, maks 5 MB. Scan QRIS venue lalu foto layar hasilnya.
              </p>
            </div>
          )}

          {deposit.rejectionReason ? (
            <p className="mt-2 border border-maint bg-maint-wash px-3 py-2 text-body-sm text-maint">
              Ditolak: {deposit.rejectionReason}. Upload ulang selama hold masih aktif.
            </p>
          ) : null}
        </Panel>
      ) : null}

      {/* Money */}
      <Panel className="px-3 py-3">
        <Meta>Rincian</Meta>
        <dl className="mt-2 space-y-1.5">
          <Row label="Total" value={rupiah(booking.totalPrice)} />
          <Row label="DP" value={rupiah(booking.depositAmount)} />
          <Rule className="my-1" />
          <Row label="Sisa" value={rupiah(booking.remainingAmount)} strong />
        </dl>
      </Panel>

      {/* Timeline */}
      {timeline.length > 0 ? (
        <Panel className="px-3 py-3">
          <Meta>Riwayat</Meta>
          <ol className="mt-2 space-y-1.5">
            {timeline.map((t) => (
              <li key={t.id} className="flex items-baseline gap-2 text-body-sm">
                <span className="text-ink-faint" aria-hidden>
                  ·
                </span>
                <span className="min-w-0 flex-1 text-ink">
                  {ACTION_LABEL[t.action] ?? t.action}
                  {t.actorName ? (
                    <span className="ml-1 font-mono text-label-sm text-ink-muted">
                      {t.actorName}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
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
