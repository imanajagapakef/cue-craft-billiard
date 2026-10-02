"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, ErrorNote, Field, Input, Meta, Panel, Select } from "./ui.tsx";

/**
 * Cashier desk — cashier_booking_payment_command.
 *
 * Three things a cashier needs when someone walks up or a notification arrives:
 * check in by booking code, start a walk-in, and open a running session. The code
 * field is the first control because checking in is the most common action by an
 * order of magnitude.
 */

export type ActiveSession = {
  id: string;
  tableCode: string;
  customerName: string;
  bookingCode: string;
  startedAt: string;
  endsAt: string;
};

export type FreeTable = {
  tableId: string;
  code: string;
  name: string;
  type: string;
  zone: string | null;
};

export function CashierDesk({
  activeSessions,
  freeTables,
  defaultDate,
  defaultStartMin,
  defaultDurationMin,
  todayCount,
}: {
  activeSessions: ActiveSession[];
  freeTables: FreeTable[];
  defaultDate: string;
  defaultStartMin: number;
  defaultDurationMin: number;
  todayCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [walkName, setWalkName] = useState("");
  const [walkPhone, setWalkPhone] = useState("");
  const [walkTable, setWalkTable] = useState(freeTables[0]?.tableId ?? "");
  const [walkStart, setWalkStart] = useState(defaultStartMin);
  const [walkDuration, setWalkDuration] = useState(defaultDurationMin);

  async function post(path: string, body: unknown, label: string, okMessage: string) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "Aksi gagal");
        return;
      }
      setNotice(okMessage.replace("{code}", json.code ?? json.bookingCode ?? ""));
      setCode("");
      router.refresh();
    } catch {
      setError("Gagal menghubungi server");
    } finally {
      setBusy(null);
    }
  }

  function startIso(dateStr: string, minutes: number): string {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, minutes) - 7 * 60 * 60_000).toISOString();
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        {/* Running sessions */}
        <section>
          <Meta>Sesi Berjalan</Meta>
          <h2 className="mt-1 border-b border-rule pb-2 text-headline-sm font-semibold tracking-tight text-ink">
            {activeSessions.length > 0
              ? `${activeSessions.length} meja sedang dipakai`
              : "Tidak ada sesi aktif"}
          </h2>

          {activeSessions.length === 0 ? (
            <div className="mt-px border border-dashed border-rule-strong bg-surface px-4 py-10 text-center text-body-md text-ink-muted">
              Semua meja kosong.
            </div>
          ) : (
            <ul className="mt-px border border-rule bg-surface">
              {activeSessions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-4 border-b border-rule px-4 py-3 last:border-0 hover:bg-canvas-recessed"
                >
                  <span className="w-16 shrink-0 font-mono text-label-lg text-ink">
                    {s.tableCode}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-md text-ink">
                      {s.customerName}
                    </span>
                    <span className="block font-mono text-label-sm text-ink-muted">
                      {s.bookingCode} · mulai{" "}
                      {new Date(s.startedAt).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Jakarta",
                      })}
                    </span>
                  </span>
                  <span className="font-mono text-label-sm tabular-nums text-ink-muted">
                    s.d.{" "}
                    {new Date(s.endsAt).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Jakarta",
                    })}
                  </span>
                  <Link
                    href={`/admin/sesi/${s.id}`}
                    className="rounded-core bg-emerald px-3 py-1.5 font-mono text-label-sm font-semibold uppercase tracking-[0.06em] text-white hover:bg-emerald-deep"
                  >
                    Kontrol
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Today ledger */}
        <section>
          <Meta>Hari Ini</Meta>
          <h2 className="mt-1 border-b border-rule pb-2 text-headline-sm font-semibold tracking-tight text-ink">
            {todayCount} booking tercatat
          </h2>
        </section>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {notice ? (
          <div className="border border-emerald bg-emerald-wash px-3 py-2 text-body-sm text-emerald">
            {notice}
          </div>
        ) : null}

        {/* Check-in */}
        <Panel>
          <div className="border-b border-rule px-4 py-3">
            <Meta>Check-in</Meta>
            <h2 className="mt-1 text-headline-sm font-semibold tracking-tight text-ink">
              Customer datang
            </h2>
          </div>
          <div className="space-y-3 px-4 py-4">
            <Field label="Kode booking" hint="Dari pesan konfirmasi customer.">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="BK-0001"
                className="font-mono uppercase"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.trim().length >= 6) {
                    void post(
                      `/api/admin/bookings/${code.trim().toUpperCase()}/checkin`,
                      {},
                      "checkin",
                      "Check-in berhasil. Booking masuk sesi aktif.",
                    );
                  }
                }}
              />
            </Field>
            <Button
              disabled={busy === "checkin" || code.trim().length < 6}
              onClick={() =>
                void post(
                  `/api/admin/bookings/${code.trim().toUpperCase()}/checkin`,
                  {},
                  "checkin",
                  "Check-in berhasil. Booking masuk sesi aktif.",
                )
              }
              className="w-full"
            >
              {busy === "checkin" ? "Memproses…" : "Check-in"}
            </Button>
            <p className="text-body-sm text-ink-muted">
              Hanya booking <span className="font-mono">CONFIRMED</span> yang bisa check-in.
              Booking yang masih menunggu DP harus diverifikasi dulu.
            </p>
          </div>
        </Panel>

        {/* Walk-in */}
        <Panel>
          <div className="border-b border-rule px-4 py-3">
            <Meta>Walk-in</Meta>
            <h2 className="mt-1 text-headline-sm font-semibold tracking-tight text-ink">
              Customer datang langsung
            </h2>
          </div>
          <div className="space-y-3 px-4 py-4">
            <Field label="Nama">
              <Input
                value={walkName}
                onChange={(e) => setWalkName(e.target.value)}
                placeholder="Nama customer"
              />
            </Field>
            <Field label="Nomor HP">
              <Input
                type="tel"
                value={walkPhone}
                onChange={(e) => setWalkPhone(e.target.value)}
                placeholder="08xxxxxxxxxx"
              />
            </Field>
            <Field label="Meja">
              <Select value={walkTable} onChange={(e) => setWalkTable(e.target.value)}>
                {freeTables.length === 0 ? (
                  <option value="">Tidak ada meja kosong</option>
                ) : (
                  freeTables.map((t) => (
                    <option key={t.tableId} value={t.tableId}>
                      {t.code} · {t.name}
                    </option>
                  ))
                )}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mulai">
                <Select
                  value={walkStart}
                  onChange={(e) => setWalkStart(Number(e.target.value))}
                >
                  {Array.from({ length: 32 }, (_, i) => 10 * 60 + i * 30).map((m) => (
                    <option key={m} value={m}>
                      {String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:
                      {String(m % 60).padStart(2, "0")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Durasi">
                <Select
                  value={walkDuration}
                  onChange={(e) => setWalkDuration(Number(e.target.value))}
                >
                  {[60, 90, 120, 150, 180, 240].map((m) => (
                    <option key={m} value={m}>
                      {m / 60} jam
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button
              variant="secondary"
              disabled={
                busy === "walkin" ||
                walkName.trim().length < 2 ||
                walkPhone.trim().length < 8 ||
                !walkTable
              }
              onClick={() =>
                void post(
                  "/api/admin/bookings",
                  {
                    customerName: walkName,
                    customerPhone: walkPhone,
                    tableId: walkTable,
                    startAt: startIso(defaultDate, walkStart),
                    durationMin: walkDuration,
                  },
                  "walkin",
                  "Walk-in {code} dimulai. Tanpa DP, dibayar saat keluar.",
                )
              }
              className="w-full"
            >
              {busy === "walkin" ? "Membuat…" : "Mulai walk-in"}
            </Button>
            <p className="text-body-sm text-ink-muted">
              Walk-in memakai tabel dan sesi yang sama dengan booking online, tanpa DP — customer
              ada di depan kasir dan melunasi saat keluar.
            </p>
          </div>
        </Panel>
      </aside>
    </div>
  );
}
