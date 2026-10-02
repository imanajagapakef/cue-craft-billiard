"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Chip, ChipStrip, TableBar } from "./mobile.tsx";
import { Button, ErrorNote, Input, Meta, Select, rupiah } from "./ui.tsx";

/**
 * Mobile availability — mobile_table_availability_instant_hold.
 *
 * Same API as the desktop picker, different ergonomics: date chips scroll
 * horizontally instead of a date input, and the chosen table plus its price
 * collapses into a single sticky action bar so the primary action is always one
 * thumb-reach away.
 *
 * Availability is refetched on every change rather than filtered locally — the
 * client copy is a preview, the POST decides.
 */

type Row = {
  tableId: string;
  code: string;
  name: string;
  type: "REGULAR" | "VIP";
  zone: string | null;
  available: boolean;
  totalPrice: number;
  depositAmount: number;
};

const DURATIONS = [60, 90, 120, 180];
const STARTS = Array.from({ length: 32 }, (_, i) => 10 * 60 + i * 30).filter((m) => m < 1440);

const slot = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * The next `count` days as `YYYY-MM-DD`, starting from `today`.
 *
 * Derived from the server-supplied `today` rather than Date.now(). A clock read
 * during render is a hydration hazard: if the server renders at 23:59:59 and the
 * browser hydrates at 00:00:01, the two disagree about what "today" is and the
 * date strip mismatches.
 */
function upcomingDays(today: string, count: number): string[] {
  const base = new Date(`${today}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) =>
    new Date(base + i * 86_400_000).toISOString().slice(0, 10),
  );
}

export function MobilePicker({ today }: { today: string }) {
  const router = useRouter();
  const days = upcomingDays(today, 7);

  const [date, setDate] = useState(today);
  const [startMin, setStartMin] = useState(19 * 60);
  const [durationMin, setDurationMin] = useState(120);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"QRIS" | "CASH_AT_COUNTER">("QRIS");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(null);

    fetch(`/api/availability?date=${date}&startMin=${startMin}&durationMin=${durationMin}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error?.message ?? "Gagal memuat ketersediaan");
        return j.tables as Row[];
      })
      .then((t) => {
        if (!cancelled) setRows(t);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [date, startMin, durationMin]);

  const available = rows?.filter((r) => r.available) ?? [];
  const chosen = rows?.find((r) => r.tableId === selected) ?? null;

  async function submit() {
    if (!chosen) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Required so a retry on mobile data does not create two bookings.
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          customerName: name,
          customerPhone: phone,
          tableId: chosen.tableId,
          startAt: new Date(
            Date.UTC(
              Number(date.slice(0, 4)),
              Number(date.slice(5, 7)) - 1,
              Number(date.slice(8, 10)),
              0,
              startMin,
            ) -
              7 * 60 * 60_000,
          ).toISOString(),
          durationMin,
          paymentMethod: method,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setSubmitError(j?.error?.message ?? "Booking gagal dibuat");
        return;
      }
      router.push(`/m/booking/${j.code}?phone=${encodeURIComponent(phone)}`);
    } catch {
      setSubmitError("Gagal menghubungi server");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    Boolean(chosen) && name.trim().length >= 2 && phone.trim().length >= 8 && !busy;

  return (
    <>
      {/* Date strip */}
      <section>
        <Meta>Tanggal</Meta>
        <div className="mt-2">
          <ChipStrip>
            {days.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDate(d)}
                aria-pressed={date === d}
              >
                <Chip active={date === d}>
                  {d === today ? "Hari ini" : new Date(`${d}T00:00:00Z`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", timeZone: "UTC" })}
                  <span className="mt-0.5 font-mono text-[0.625rem] opacity-70">
                    {d.slice(8, 10)}/{d.slice(5, 7)}
                  </span>
                </Chip>
              </button>
            ))}
          </ChipStrip>
        </div>
      </section>

      {/* Slot + duration */}
      <section className="mt-5">
        <Meta>Jam & durasi</Meta>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="sr-only">Jam mulai</span>
            <Select
              value={startMin}
              onChange={(e) => setStartMin(Number(e.target.value))}
              className="min-h-[44px] text-center"
            >
              {STARTS.map((m) => (
                <option key={m} value={m}>
                  {slot(m)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="sr-only">Durasi</span>
            <Select
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className="min-h-[44px] text-center"
            >
              {DURATIONS.map((m) => (
                <option key={m} value={m}>
                  {m / 60} jam
                </option>
              ))}
            </Select>
          </label>
        </div>
      </section>

      {/* Tables */}
      <section className="mt-5">
        <div className="flex items-baseline justify-between">
          <Meta>Meja</Meta>
          <span className="font-mono text-label-sm text-ink-muted">
            {loading ? "memuat…" : `${available.length}/${rows?.length ?? 0} tersedia`}
          </span>
        </div>

        {error ? (
          <div className="mt-2">
            <ErrorNote>{error}</ErrorNote>
          </div>
        ) : null}

        <div className="mt-2 space-y-2">
          {(rows ?? []).map((t) => (
            <TableBar
              key={t.tableId}
              code={t.code}
              name={t.name}
              zone={t.zone}
              disabled={!t.available}
              active={selected === t.tableId}
              onClick={() => setSelected(t.tableId)}
              right={
                t.available ? (
                  <>
                    <div className="font-mono tabular-nums text-body-md text-ink">
                      {rupiah(t.totalPrice)}
                    </div>
                    <div className="font-mono text-[0.625rem] uppercase tracking-[0.06em] text-emerald">
                      DP {rupiah(t.depositAmount)}
                    </div>
                  </>
                ) : (
                  <span className="font-mono text-[0.625rem] uppercase tracking-[0.06em] text-ink-faint">
                    Dipakai
                  </span>
                )
              }
            />
          ))}
          {!loading && rows?.length === 0 && !error ? (
            <p className="border border-dashed border-rule-strong bg-surface px-3 py-8 text-center text-body-sm text-ink-muted">
              Tidak ada data meja. Jalankan `npm run db:seed`.
            </p>
          ) : null}
        </div>
      </section>

      {/* Detail + submit, only when something is selected */}
      {chosen ? (
        <section className="mt-5 space-y-3 border border-rule bg-surface p-3">
          <div className="flex items-baseline justify-between">
            <Meta>Dipesan · {chosen.code}</Meta>
            <span className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
              {slot(startMin)}–{slot((startMin + durationMin) % 1440)}
            </span>
          </div>
          <dl className="space-y-1 border-t border-rule pt-2">
            <Row label="Total" value={rupiah(chosen.totalPrice)} />
            <Row label="DP (wajib)" value={rupiah(chosen.depositAmount)} strong />
          </dl>

          <label className="block">
            <span className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
              Nama
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nama lengkap"
              className="mt-1 min-h-[44px]"
            />
          </label>
          <label className="block">
            <span className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
              Nomor HP
            </span>
            <Input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="08xxxxxxxxxx"
              className="mt-1 min-h-[44px]"
              autoComplete="tel"
            />
          </label>
          <label className="block">
            <span className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
              Cara bayar DP
            </span>
            <Select
              value={method}
              onChange={(e) => setMethod(e.target.value as "QRIS" | "CASH_AT_COUNTER")}
              className="mt-1 min-h-[44px]"
            >
              <option value="QRIS">QRIS</option>
              <option value="CASH_AT_COUNTER">Cash di kasir</option>
            </Select>
          </label>
        </section>
      ) : null}

      {/* Floating action bar */}
      <div className="space-y-2">
        {submitError ? <ErrorNote>{submitError}</ErrorNote> : null}
        <Button
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="min-h-[48px] w-full text-body-md"
        >
          {busy
            ? "Memproses…"
            : chosen
              ? `Pesan ${chosen.code} · DP ${rupiah(chosen.depositAmount)}`
              : "Pilih meja dulu"}
        </Button>
      </div>
    </>
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
