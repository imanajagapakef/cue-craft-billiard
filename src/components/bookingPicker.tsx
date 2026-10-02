"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  Button,
  ErrorNote,
  Field,
  Input,
  Meta,
  rupiah,
  Select,
  cx,
} from "@/components/ui.tsx";

/**
 * Availability picker and booking form — the
 * table_availability_floor_plan_reservation Stitch screen.
 *
 * Availability is re-fetched from the server on every selection change rather than
 * filtered in the browser. The client copy is a preview; the POST is what decides,
 * and the exclusion constraint settles ties (§64).
 */

export type AvailabilityRow = {
  tableId: string;
  code: string;
  name: string;
  type: "REGULAR" | "VIP";
  zone: string | null;
  available: boolean;
  totalPrice: number;
  depositAmount: number;
  slices: { minutes: number; hourlyPrice: number; subtotal: number }[];
};

const DURATIONS = [60, 90, 120, 150, 180, 240];

/** Opening slots on a half-hour grid, inside the venue's 10:00–02:00 window. */
const START_OPTIONS = Array.from({ length: 32 }, (_, i) => 10 * 60 + i * 30).filter(
  (m) => m < 24 * 60,
);

function slotLabel(minutes: number): string {
  const m = minutes % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function BookingPicker({
  initialDate,
  todayDate,
  defaultStartMin,
}: {
  initialDate: string;
  todayDate: string;
  defaultStartMin: number;
}) {
  const router = useRouter();

  const [date, setDate] = useState(initialDate);
  const [startMin, setStartMin] = useState(defaultStartMin);
  const [durationMin, setDurationMin] = useState(120);

  const [rows, setRows] = useState<AvailabilityRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"QRIS" | "CASH_AT_COUNTER">("QRIS");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const query = useMemo(
    () => `/api/availability?date=${date}&startMin=${startMin}&durationMin=${durationMin}`,
    [date, startMin, durationMin],
  );

  async function load(nextQuery: string) {
    setLoading(true);
    setLoadError(null);
    setSelected(null);
    try {
      const res = await fetch(nextQuery, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setLoadError(json?.error?.message ?? "Gagal memuat ketersediaan");
        setRows([]);
        return;
      }
      setRows(json.tables as AvailabilityRow[]);
    } catch {
      setLoadError("Gagal menghubungi server");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  // Load once on mount. `load` is stable enough for this purpose; the deps below
  // are the actual inputs, and every change already triggers its own explicit load.
  const [bootstrapped, setBootstrapped] = useState(false);
  useEffect(() => {
    if (bootstrapped) return;
    setBootstrapped(true);
    void load(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      setSubmitError("Pilih meja dulu");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Required: a retry on a flaky connection must not create two bookings.
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          customerName: name,
          customerPhone: phone,
          tableId: selected,
          startAt: startIso(date, startMin),
          durationMin,
          paymentMethod: method,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setSubmitError(json?.error?.message ?? "Booking gagal dibuat");
        // Someone took the slot: refresh so the grid reflects reality.
        void load(query);
        return;
      }

      router.push(`/booking/${json.code}?phone=${encodeURIComponent(phone)}`);
    } catch {
      setSubmitError("Gagal menghubungi server");
    } finally {
      setSubmitting(false);
    }
  }

  const available = rows?.filter((r) => r.available) ?? [];
  const chosen = rows?.find((r) => r.tableId === selected) ?? null;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      {/* Slot + table grid */}
      <section>
        <div className="grid gap-3 border border-rule bg-surface p-4 sm:grid-cols-3">
          <Field label="Tanggal">
            <Input
              type="date"
              value={date}
              min={todayDate}
              onChange={(e) => {
                setDate(e.target.value);
                void load(
                  `/api/availability?date=${e.target.value}&startMin=${startMin}&durationMin=${durationMin}`,
                );
              }}
            />
          </Field>
          <Field label="Jam mulai">
            <Select
              value={startMin}
              onChange={(e) => {
                const v = Number(e.target.value);
                setStartMin(v);
                void load(`/api/availability?date=${date}&startMin=${v}&durationMin=${durationMin}`);
              }}
            >
              {START_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {slotLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Durasi">
            <Select
              value={durationMin}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDurationMin(v);
                void load(`/api/availability?date=${date}&startMin=${startMin}&durationMin=${v}`);
              }}
            >
              {DURATIONS.map((m) => (
                <option key={m} value={m}>
                  {m / 60} jam
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {loadError ? (
          <div className="mt-4">
            <ErrorNote>{loadError}</ErrorNote>
          </div>
        ) : null}

        <div className="mt-6">
          <div className="flex items-center justify-between border-b border-rule pb-2">
            <Meta>
              {loading ? "Memuat…" : `${available.length} dari ${rows?.length ?? 0} meja tersedia`}
            </Meta>
            <Meta>{date}</Meta>
          </div>

          <ul className="mt-px grid gap-px border border-rule bg-rule sm:grid-cols-2">
            {(rows ?? []).map((r) => (
              <li key={r.tableId}>
                <button
                  type="button"
                  disabled={!r.available}
                  onClick={() => setSelected(r.tableId)}
                  className={cx(
                    "flex w-full flex-col gap-2 bg-surface px-4 py-3 text-left transition-colors",
                    r.available
                      ? "hover:bg-canvas-recessed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald"
                      : "cursor-not-allowed opacity-55",
                    selected === r.tableId && "bg-emerald-wash ring-1 ring-inset ring-emerald",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-label-lg text-ink">{r.code}</div>
                      <div className="truncate text-body-sm text-ink-secondary">{r.name}</div>
                    </div>
                    <span
                      className={cx(
                        "font-mono text-label-sm uppercase tracking-[0.06em]",
                        r.available ? "text-emerald" : "text-ink-faint",
                      )}
                    >
                      {r.available ? "Open" : "Busy"}
                    </span>
                  </div>
                  {r.available ? (
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-label-sm text-ink-muted">Total</span>
                      <span className="font-mono tabular-nums text-body-md text-ink">
                        {rupiah(r.totalPrice)}
                      </span>
                    </div>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          {!loading && rows && rows.length === 0 ? (
            <p className="border border-dashed border-rule-strong bg-surface px-4 py-10 text-center text-body-md text-ink-muted">
              Tidak ada data meja. Jalankan `npm run db:seed`.
            </p>
          ) : null}
        </div>
      </section>

      {/* Booking form */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <form onSubmit={submit} className="border border-rule bg-surface">
          <div className="border-b border-rule px-4 py-3">
            <Meta>Langkah 2 dari 2 · Konfirmasi</Meta>
            <h2 className="mt-1 text-headline-sm font-semibold tracking-tight text-ink">
              Kunci meja
            </h2>
          </div>

          <div className="space-y-4 px-4 py-4">
            {submitError ? <ErrorNote>{submitError}</ErrorNote> : null}

            {chosen ? (
              <div className="border border-rule bg-canvas-recessed px-3 py-2">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-label-md text-ink">{chosen.code}</span>
                  <span className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
                    {chosen.type}
                  </span>
                </div>
                <div className="mt-1 font-mono text-label-sm text-ink-secondary">
                  {slotLabel(startMin)}–{slotLabel((startMin + durationMin) % 1440)}
                </div>
                <dl className="mt-3 space-y-1 border-t border-rule pt-2">
                  <Row label="Total" value={rupiah(chosen.totalPrice)} />
                  <Row label="DP (wajib)" value={rupiah(chosen.depositAmount)} strong />
                  <Row
                    label="Sisa di tempat"
                    value={rupiah(chosen.totalPrice - chosen.depositAmount)}
                  />
                </dl>
                {chosen.slices.length > 1 ? (
                  <p className="mt-2 border-t border-rule pt-2 font-mono text-label-sm text-ink-muted">
                    Melewati jamBusy: {chosen.slices.length} periode harga
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="border border-dashed border-rule-strong px-3 py-4 text-center text-body-sm text-ink-muted">
                Pilih meja yang tersedia di sebelah.
              </p>
            )}

            <Field label="Nama">
              <Input
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama lengkap"
              />
            </Field>

            <Field label="Nomor HP" hint="Dipakai kasir saat check-in dan untuk konfirmasi WhatsApp.">
              <Input
                required
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08xxxxxxxxxx"
              />
            </Field>

            <Field label="Cara bayar DP">
              <Select
                value={method}
                onChange={(e) => setMethod(e.target.value as "QRIS" | "CASH_AT_COUNTER")}
              >
                <option value="QRIS">QRIS — upload bukti, diverifikasi kasir</option>
                <option value="CASH_AT_COUNTER">Cash di kasir</option>
              </Select>
            </Field>

            <Button type="submit" disabled={!chosen || submitting} className="w-full">
              {submitting ? "Memproses…" : "Pesan & Bayar DP"}
            </Button>

            <p className="text-body-sm text-ink-muted">
              Meja ditahan setelah booking dibuat. Hold habis dalam 15 menit kalau DP belum masuk,
              lalu meja dilepas otomatis.
            </p>
          </div>
        </form>
      </aside>
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

/** Local wall-clock date + minutes → absolute ISO instant. Venue is WIB (UTC+7). */
export function startIso(dateStr: string, minutes: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - 7 * 60 * 60_000).toISOString();
}
