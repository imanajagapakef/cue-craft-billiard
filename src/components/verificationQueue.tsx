"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button, ErrorNote, Meta, Panel, PaymentBadge, rupiah, cx } from "./ui.tsx";

/**
 * Payment verification — deposit_verification_table_hold_status and
 * cashier_booking_payment_command.
 *
 * Confirm and Reject are equal visual weight on purpose. A cashier should not be
 * nudged toward the happy path by button sizing; §22 exists because mismatches are
 * routine.
 *
 * Reject requires a reason (Project.md §22's optional-but-recorded list of causes)
 * because the customer sees it on WhatsApp and needs to know what to fix.
 */

export type QueueRow = {
  id: string;
  kind: string;
  method: string;
  status: string;
  amount: number;
  createdAt: string;
  proofPath: string | null;
  booking: {
    code: string;
    customerName: string;
    customerPhone: string;
    startAt: string;
    endAt: string;
    holdExpiresAt: string | null;
    tableCode: string;
  };
};

const REJECT_REASONS = [
  "Bukti pembayaran tidak terbaca",
  "Nominal tidak sesuai",
  "Bukti dari akun lain",
  "Pembayaran duplikat",
  "Lainnya",
];

export function VerificationQueue({ rows }: { rows: QueueRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState<string>(REJECT_REASONS[0]);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "confirm" | "reject", body?: unknown) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payments/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "Aksi gagal");
        return;
      }
      setRejecting(null);
      setReason(REJECT_REASONS[0]);
      setCustom("");
      router.refresh();
    } catch {
      setError("Gagal menghubungi server");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <Panel className="px-4 py-12 text-center">
        <Meta>Antrean kosong</Meta>
        <p className="mt-1 text-body-md text-ink-secondary">
          Semua DP sudah diverifikasi.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-px">
      {error ? (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}

      {rows.map((p) => {
        const busy = busyId === p.id;
        const isRejecting = rejecting === p.id;
        const finalReason = reason === "Lainnya" ? custom.trim() : reason;

        return (
          <Panel key={p.id} className="px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-headline-sm text-ink">
                    {p.booking.tableCode}
                  </span>
                  <span className="font-mono text-label-md text-ink-muted">{p.booking.code}</span>
                  <PaymentBadge status={p.status} />
                  <span className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-faint">
                    {p.kind} · {p.method === "QRIS" ? "QRIS" : "Cash at Register"}
                  </span>
                </div>
                <div className="mt-1 text-body-md text-ink">{p.booking.customerName}</div>
                <div className="font-mono text-label-sm tabular-nums text-ink-muted">
                  {new Date(p.booking.startAt).toLocaleString("id-ID", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Jakarta",
                  })}
                  {" – "}
                  {new Date(p.booking.endAt).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Jakarta",
                  })}
                </div>
              </div>

              <div className="text-right">
                <div className="font-mono text-headline-md tabular-nums text-ink">
                  {rupiah(p.amount)}
                </div>
                <div className="mt-1 font-mono text-label-sm text-ink-muted">
                  {p.booking.customerPhone}
                </div>
              </div>
            </div>

            {p.booking.holdExpiresAt ? (
              <p className="mt-3 border-t border-rule pt-2 font-mono text-label-sm text-ink-muted">
                Hold booking:{" "}
                {new Date(p.booking.holdExpiresAt).toLocaleTimeString("id-ID", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Jakarta",
                })}
              </p>
            ) : null}

            {p.proofPath ? (
              <a
                href={p.proofPath}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block border border-rule-strong bg-canvas-recessed px-3 py-1.5 font-mono text-label-sm uppercase tracking-[0.06em] text-emerald hover:bg-surface-accent"
              >
                Lihat bukti
              </a>
            ) : (
              <p className="mt-3 font-mono text-label-sm text-inplay">
                Belum ada bukti diunggah — DP cash di kasir.
              </p>
            )}

            {isRejecting ? (
              <div className="mt-4 border-t border-rule pt-3">
                <Meta className="text-maint">Alasan penolakan</Meta>
                <div className="mt-2 grid gap-1.5">
                  {REJECT_REASONS.map((r) => (
                    <label
                      key={r}
                      className={cx(
                        "flex items-center gap-2 px-2 py-1.5 text-body-sm transition-colors",
                        reason === r
                          ? "bg-maint-wash text-maint"
                          : "text-ink-secondary hover:bg-canvas-recessed",
                      )}
                    >
                      <input
                        type="radio"
                        name={`reason-${p.id}`}
                        checked={reason === r}
                        onChange={() => setReason(r)}
                        className="accent-[#7A3535]"
                      />
                      {r}
                    </label>
                  ))}
                </div>
                {reason === "Lainnya" ? (
                  <textarea
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Tuliskan alasan"
                    className="mt-2 w-full rounded-core border border-rule-strong bg-surface px-3 py-2 text-body-sm focus:border-emerald focus:outline-none focus:ring-[3px] focus:ring-emerald/15"
                  />
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    disabled={busy || finalReason.length === 0}
                    onClick={() => void act(p.id, "reject", { reason: finalReason })}
                  >
                    {busy ? "…" : "Tolak pembayaran"}
                  </Button>
                  <Button variant="ghost" onClick={() => setRejecting(null)}>
                    Batal
                  </Button>
                </div>
                <p className="mt-2 text-body-sm text-ink-muted">
                  Customer menerima alasan ini lewat WhatsApp dan bisa upload ulang selama hold
                  masih aktif.
                </p>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-3">
                <Button
                  disabled={busy}
                  onClick={() => void act(p.id, "confirm")}
                  className="flex-1 sm:flex-none"
                >
                  {busy ? "Memproses…" : "Konfirmasi pembayaran"}
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => setRejecting(p.id)}
                  className="flex-1 sm:flex-none"
                >
                  Tolak
                </Button>
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
