"use client";

import { useState } from "react";

import { Button, ErrorNote, Field, Input, Meta, Panel } from "./ui.tsx";

/**
 * Booking lookup — my_bookings_match_ledger.
 *
 * MVP has no customer login, so a booking is retrieved by code + phone. Both are
 * required: a code is four base-32 characters and gets read aloud in a queue, so
 * it cannot stand alone as a credential.
 */
export function BookingLookup() {
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(formData) => {
        const c = String(formData.get("code") ?? "").trim().toUpperCase();
        const p = String(formData.get("phone") ?? "").trim();
        if (!c || !p) {
          setError("Kode booking dan nomor HP keduanya wajib diisi");
          return;
        }
        window.location.href = `/booking/${encodeURIComponent(c)}?phone=${encodeURIComponent(p)}`;
      }}
      className="mx-auto max-w-[520px]"
    >
      <Panel>
        <div className="border-b border-rule px-4 py-3">
          <Meta>Booking Saya</Meta>
          <h2 className="mt-1 text-headline-sm font-semibold tracking-tight text-ink">
            Buka detail booking
          </h2>
        </div>
        <div className="space-y-4 px-4 py-4">
          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <Field label="Kode booking" hint="Format BK-XXXX, ada di pesan konfirmasi.">
            <Input
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="BK-0001"
              autoComplete="off"
              className="font-mono uppercase"
            />
          </Field>

          <Field label="Nomor HP" hint="Harus sama dengan yang dipakai saat booking.">
            <Input
              name="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="08xxxxxxxxxx"
              autoComplete="tel"
            />
          </Field>

          <Button type="submit" className="w-full">
            Buka booking
          </Button>
        </div>
      </Panel>
    </form>
  );
}
