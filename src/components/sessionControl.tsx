"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Countdown } from "./live.tsx";
import { Button, ErrorNote, Meta, Panel, Rule, rupiah, cx } from "./ui.tsx";

/**
 * Live session control — active_match_session_control.
 *
 * Two actions, and the order matters:
 *   1. Extension creates a PAYMENT. Time is only granted once that payment is
 *      confirmed, so the cashier sees the charge before the customer gets the
 *      minutes, and one verification path covers deposit, extension, and settlement.
 *   2. Checkout computes the bill, including overage past the grace period, and
 *      creates a FINAL payment. Confirming that payment completes the booking.
 *
 * Both re-check availability server-side at submit. The quote shown here is a
 * hint; the exclusion constraint is the authority (§41, §64).
 */

export type SessionView = {
  id: string;
  tableCode: string;
  tableName: string;
  customerName: string;
  customerPhone: string;
  bookingCode: string;
  status: string;
  startedAt: string;
  scheduledEndAt: string;
  extendedMinutes: number;
  totalPrice: number;
  depositPaid: number;
};

export type Quote = {
  canExtend: boolean;
  maxMinutes: number;
  increments: number[];
  priceByMinutes: Record<string, number>;
  reason: string | null;
};

export function SessionControl({
  session,
  initialQuote,
}: {
  session: SessionView;
  initialQuote: Quote;
}) {
  const router = useRouter();
  const [quote, setQuote] = useState<Quote>(initialQuote);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bill, setBill] = useState<{ overage: number; owed: number; total: number } | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  // Re-quote on mount so the numbers are never staler than the page load.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/sessions/${session.id}/quote`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((q: Quote | null) => {
        if (!cancelled && q) setQuote(q);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  async function call(path: string, body: unknown, label: string) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "Aksi gagal");
        // A refusal usually means availability moved; refresh the quote so the
        // cashier sees the new ceiling rather than retrying a stale number.
        if (json?.error?.details?.maxMinutes !== undefined) {
          setQuote((q) => ({ ...q, maxMinutes: json.error.details.maxMinutes, canExtend: json.error.details.maxMinutes > 0 }));
        }
        return null;
      }
      return json;
    } catch {
      setError("Gagal menghubungi server");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function requestExtension(extra?: { overrideReason: string }) {
    if (minutes === null) return;
    const res = await call(
      `/api/admin/sessions/${session.id}/extend`,
      { minutes, ...extra },
      "extend",
    );
    if (res) {
      setOverrideOpen(false);
      setOverrideReason("");
      setMinutes(null);
      router.refresh();
    }
  }

  async function endSession() {
    const res = await call(`/api/admin/sessions/${session.id}/end`, {}, "end");
    if (res) {
      setBill({ overage: res.overage, owed: res.owed, total: res.bill });
      router.refresh();
    }
  }

  const endsAt = new Date(
    new Date(session.scheduledEndAt).getTime() + session.extendedMinutes * 60_000,
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-8">
        {/* Live session card */}
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-rule px-4 py-3">
            <div>
              <Meta>Sesi Aktif</Meta>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-headline-md text-ink">{session.tableCode}</span>
                <span className="text-body-sm text-ink-secondary">{session.tableName}</span>
              </div>
              <div className="mt-0.5 text-body-sm text-ink">{session.customerName}</div>
              <div className="font-mono text-label-sm text-ink-muted">
                {session.bookingCode} · {session.customerPhone}
              </div>
            </div>
            <div className="text-right">
              <Meta>Sisa Waktu</Meta>
              <Countdown endsAt={endsAt} long className="text-headline-lg" />
              {session.extendedMinutes > 0 ? (
                <div className="mt-0.5 font-mono text-label-sm text-emerald">
                  +{session.extendedMinutes} mnt extension
                </div>
              ) : null}
            </div>
          </div>

          <dl className="grid gap-3 px-4 py-3 sm:grid-cols-3">
            <Cell label="Mulai" value={new Date(session.startedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} />
            <Cell label="Jadwal selesai" value={new Date(session.scheduledEndAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} />
            <Cell label="Total booking" value={rupiah(session.totalPrice)} />
          </dl>
        </Panel>

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        {/* Bill after checkout */}
        {bill ? (
          <Panel>
            <div className="border-b border-rule px-4 py-3">
              <Meta>Tagihan Akhir</Meta>
              <h2 className="mt-1 text-headline-sm font-semibold tracking-tight text-ink">
                Sesi ditutup — tinggalkan pelunasan
              </h2>
            </div>
            <dl className="space-y-2 px-4 py-4">
              <Row label="Sisa tagihan" value={rupiah(bill.owed)} />
              <Row label="Overage" value={rupiah(bill.overage)} hint="di luar grace period" />
              <Rule className="my-1" />
              <Row label="Total harus dibayar" value={rupiah(bill.total)} strong />
            </dl>
            <p className="border-t border-rule px-4 py-3 text-body-sm text-ink-muted">
              Tagihan FINAL sudah dibuat. Tekan{" "}
              <span className="font-mono">Konfirmasi pelunasan</span> di halaman pembayaran
              untuk menutup booking menjadi{" "}
              <span className="font-mono">COMPLETED</span>.
            </p>
          </Panel>
        ) : null}

        {/* Extension */}
        <Panel>
          <div className="border-b border-rule px-4 py-3">
            <Meta>Perpanjangan</Meta>
            <h2 className="mt-1 text-headline-sm font-semibold tracking-tight text-ink">
              Tambah waktu main
            </h2>
          </div>

          <div className="space-y-4 px-4 py-4">
            {quote.canExtend ? (
              <>
                <p className="text-body-sm text-ink-muted">
                  Maksimal saat ini <span className="font-mono">{quote.maxMinutes} menit</span>.
                  Availability dicek ulang saat dikirim.
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {quote.increments.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMinutes(m)}
                      className={cx(
                        "border px-3 py-3 text-left transition-colors",
                        minutes === m
                          ? "border-emerald bg-emerald-wash"
                          : "border-rule-strong bg-surface hover:bg-canvas-recessed",
                      )}
                    >
                      <div className="font-mono text-label-lg text-ink">+{m} mnt</div>
                      <div className="mt-0.5 font-mono tabular-nums text-body-sm text-ink-secondary">
                        {rupiah(quote.priceByMinutes[String(m)] ?? 0)}
                      </div>
                    </button>
                  ))}
                </div>

                {minutes !== null && minutes > quote.maxMinutes ? (
                  <div className="border border-rule bg-canvas-recessed px-3 py-3">
                    <Meta className="text-maint">Melebihi batas</Meta>
                    <p className="mt-1 text-body-sm text-ink-secondary">
                      {minutes} menit melebihi batas {quote.maxMinutes} menit. Ada booking
                      berikutnya di slot itu — atau jam operasional tidak cukup.
                    </p>
                    <label className="mt-2 block">
                      <span className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
                        Alasan override (wajib, masuk audit log)
                      </span>
                      {overrideOpen ? (
                        <textarea
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          rows={2}
                          maxLength={500}
                          placeholder="Contoh: sudah disepakati dengan customer berikutnya"
                          className="mt-1 w-full rounded-core border border-rule-strong bg-surface px-3 py-2 text-body-sm focus:border-emerald focus:outline-none focus:ring-[3px] focus:ring-emerald/15"
                        />
                      ) : (
                        <Button
                          variant="danger"
                          onClick={() => setOverrideOpen(true)}
                          className="mt-2 w-full"
                        >
                          Override dengan alasan
                        </Button>
                      )}
                    </label>
                    {overrideOpen ? (
                      <div className="mt-2 flex gap-2">
                        <Button
                          variant="danger"
                          disabled={busy === "extend" || overrideReason.trim().length === 0}
                          onClick={() => void requestExtension({ overrideReason })}
                          className="flex-1"
                        >
                          {busy === "extend" ? "…" : "Kirim override"}
                        </Button>
                        <Button variant="ghost" onClick={() => setOverrideOpen(false)}>
                          Batal
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <Button
                    disabled={minutes === null || busy === "extend"}
                    onClick={() => void requestExtension()}
                    className="w-full sm:w-auto"
                  >
                    {busy === "extend"
                      ? "Memproses…"
                      : minutes === null
                        ? "Pilih durasi"
                        : `Request +${minutes} menit`}
                  </Button>
                )}

                <p className="text-body-sm text-ink-muted">
                  Extension dibuat sebagai tagihan dan dibayar di kasir. Waktu baru diberikan
                  setelah tagihan dikonfirmasi, supaya customer tidak mendapat menit sebelum bayar.
                </p>
              </>
            ) : (
              <div className="border border-maint bg-maint-wash px-3 py-3">
                <Meta className="text-maint">Extension tidak tersedia</Meta>
                <p className="mt-1 text-body-md text-maint">
                  {quote.reason ?? "Tidak ada ruang waktu yang bisa dipakai."}
                </p>
                <p className="mt-1 text-body-sm text-ink-secondary">
                  Booking berikutnya tidak boleh digeser otomatis. Kalau perlu, hubungi customer
                  berikutnya atau pindahkan manual dengan alasan.
                </p>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Checkout rail */}
      <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
        <Panel>
          <div className="border-b border-rule px-4 py-3">
            <Meta>Tutup Sesi</Meta>
          </div>
          <div className="space-y-3 px-4 py-3">
            <p className="text-body-sm text-ink-muted">
              Menghitung durasi, extension yang disetujui, dan overage di luar grace period. Kalau
              ada tagihan yang belum dibayar, booking tidak ditutup sampai pelunasan dikonfirmasi.
            </p>
            <Button
              variant="secondary"
              disabled={busy === "end" || session.status === "ENDED"}
              onClick={() => void endSession()}
              className="w-full"
            >
              {busy === "end" ? "Menghitung…" : "Akhiri sesi & hitung bill"}
            </Button>
          </div>
        </Panel>

        <Panel>
          <div className="border-b border-rule px-4 py-3">
            <Meta>Yang Sudah Dibayar</Meta>
          </div>
          <div className="px-4 py-3">
            <Row label="DP" value={rupiah(session.depositPaid)} />
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono tabular-nums text-body-md text-ink">{value}</dd>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? "font-mono text-label-md text-ink" : "text-body-sm text-ink-muted"}>
        {label}
        {hint ? <span className="ml-1 text-ink-faint">({hint})</span> : null}
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
