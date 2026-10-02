"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Countdown } from "./live.tsx";
import { TableBar } from "./mobile.tsx";
import { Button, ErrorNote, Input, PaymentBadge, StatusBadge, rupiah } from "./ui.tsx";

/**
 * Mobile floor ops — mobile_floor_ops_cashier_command.
 *
 * Built for a cashier standing at the counter with one hand on the phone: every
 * table is a 56px rail-bordered bar, the whole list is the primary content, and
 * the two actions that matter — check in by code, open a running session — sit in
 * a fixed bar so they need no scrolling to reach.
 */

export type FloorState = {
  tableId: string;
  code: string;
  name: string;
  zone: string | null;
  state: "AVAILABLE" | "HELD" | "RESERVED" | "OCCUPIED" | "MAINTENANCE";
  bookingCode: string | null;
  customerName: string | null;
  sessionId: string | null;
  busyUntil: string | null;
  holdExpiresAt: string | null;
};

export type PendingPayment = {
  id: string;
  amount: number;
  method: string;
  status: string;
  bookingCode: string;
  tableCode: string;
  customerName: string;
  hasProof: boolean;
};

export function MobileFloor({
  floor,
  pending,
  counts,
}: {
  floor: FloorState[];
  pending: PendingPayment[];
  counts: { available: number; occupied: number; held: number; maintenance: number };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"floor" | "bayar">("floor");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function checkIn() {
    if (code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/bookings/${code.trim().toUpperCase()}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j?.error?.message ?? "Check-in gagal");
        return;
      }
      setNotice(`Check-in ${j.bookingCode} berhasil`);
      setCode("");
      router.refresh();
    } catch {
      setError("Gagal menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Counts */}
      <div className="grid grid-cols-4 gap-px border border-rule bg-rule">
        <Stat label="Kosong" value={counts.available} accent />
        <Stat label="Main" value={counts.occupied} />
        <Stat label="Ditahan" value={counts.held} />
        <Stat label="Maint" value={counts.maintenance} />
      </div>

      {/* Tab switch — 44px targets */}
      <div className="mt-4 grid grid-cols-2 gap-2" role="tablist" aria-label="Layar kasir">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "floor"}
          onClick={() => setTab("floor")}
          className={`min-h-[44px] rounded-core border px-3 font-mono text-label-sm uppercase tracking-[0.06em] transition-colors ${
            tab === "floor"
              ? "border-emerald bg-emerald text-white"
              : "border-rule bg-surface text-ink-muted"
          }`}
        >
          Floor · {floor.length}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "bayar"}
          onClick={() => setTab("bayar")}
          className={`min-h-[44px] rounded-core border px-3 font-mono text-label-sm uppercase tracking-[0.06em] transition-colors ${
            tab === "bayar"
              ? "border-emerald bg-emerald text-white"
              : "border-rule bg-surface text-ink-muted"
          }`}
        >
          Bayar · {pending.length}
        </button>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
      {notice ? (
        <p className="mt-3 border border-emerald bg-emerald-wash px-3 py-2 text-body-sm text-emerald">
          {notice}
        </p>
      ) : null}

      {tab === "floor" ? (
        <div className="mt-4 space-y-2">
          {floor.map((t) => (
            <TableBar
              key={t.tableId}
              code={t.code}
              name={t.customerName ?? t.name}
              zone={t.zone}
              right={
                <div className="space-y-1">
                  <StatusBadge state={t.state} />
                  {t.state === "HELD" && t.holdExpiresAt ? (
                    <Countdown endsAt={t.holdExpiresAt} className="block text-label-sm" />
                  ) : t.sessionId && t.busyUntil ? (
                    <Link
                      href={`/admin/sesi/${t.sessionId}`}
                      className="block font-mono text-label-sm text-emerald underline"
                    >
                      <Countdown endsAt={t.busyUntil} className="inline" />
                    </Link>
                  ) : t.bookingCode ? (
                    <span className="block font-mono text-label-sm text-ink-muted">
                      {t.bookingCode}
                    </span>
                  ) : null}
                </div>
              }
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {pending.length === 0 ? (
            <p className="border border-dashed border-rule-strong bg-surface px-3 py-8 text-center text-body-sm text-ink-muted">
              Antrean kosong.
            </p>
          ) : (
            pending.map((p) => (
              <div key={p.id} className="border border-rule bg-surface px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-label-lg text-ink">{p.tableCode}</span>
                      <span className="font-mono text-label-sm text-ink-muted">
                        {p.bookingCode}
                      </span>
                    </div>
                    <div className="truncate text-body-sm text-ink">{p.customerName}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono tabular-nums text-body-md text-ink">
                      {rupiah(p.amount)}
                    </div>
                    <PaymentBadge status={p.status} />
                  </div>
                </div>
                {p.hasProof ? (
                  <p className="mt-2 font-mono text-label-sm text-ink-muted">
                    Bukti terupload — konfirmasi lewat halaman pembayaran
                  </p>
                ) : (
                  <p className="mt-2 font-mono text-label-sm text-inplay">
                    Belum ada bukti — DP cash di kasir
                  </p>
                )}
                <Link
                  href="/admin/pembayaran"
                  className="mt-2 block rounded-core border border-rule-strong px-3 py-2 text-center font-mono text-label-sm uppercase tracking-[0.06em] text-ink"
                >
                  Buka verifikasi
                </Link>
              </div>
            ))
          )}
        </div>
      )}

      {/* Fixed action: check in by code. Always reachable, on both tabs. */}
      <div className="space-y-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="BK-XXXX"
          inputMode="text"
          autoCapitalize="characters"
          className="min-h-[48px] text-center font-mono text-body-md uppercase"
          aria-label="Kode booking untuk check-in"
        />
        <Button
          onClick={() => void checkIn()}
          disabled={busy || code.trim().length < 6}
          className="min-h-[48px] w-full text-body-md"
        >
          {busy ? "Memproses…" : "Check-in"}
        </Button>
        <p className="text-center text-body-sm text-ink-muted">
          <Link href="/admin" className="underline">
            Buka versi desktop
          </Link>
        </p>
      </div>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-surface px-2 py-2 text-center">
      <div className="font-mono text-[0.5625rem] uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-headline-sm tabular-nums ${
          accent ? "text-emerald" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
