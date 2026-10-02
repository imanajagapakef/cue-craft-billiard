import type { Metadata } from "next";

import { PublicFooter, PublicHeader } from "@/components/shell.tsx";
import { BookingPicker } from "@/components/bookingPicker.tsx";
import { SectionTitle, minutesOfDay } from "@/components/ui.tsx";
import { db } from "@/lib/db.ts";
import { getSettings } from "@/lib/settings.ts";

export const metadata: Metadata = {
  title: "Cari Meja — Cue & Rail",
  description: "Pilih tanggal, jam, durasi, lalu kunci meja dengan DP.",
};

// Operating hours and policy come from the database, not the build.
export const dynamic = "force-dynamic";

/**
 * Availability and reservation — table_availability_floor_plan_reservation.
 *
 * The venue window is read here so the picker can refuse an out-of-hours slot with
 * a real message instead of a generic failure from the API.
 */
export default async function MejaPage() {
  const [hours, settings] = await Promise.all([
    db.operatingHour.findFirst({ where: { active: true }, orderBy: { weekday: "asc" } }),
    getSettings(),
  ]);

  const now = new Date();
  const today = new Date(now.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 10);
  const currentMinutes = minutesOfDay(now);

  // Default to the next half-hour slot inside the window, so the page is useful at
  // 11:00 and at 23:00 without the customer adjusting anything.
  const opens = hours?.opensAtMin ?? 600;
  const next = Math.ceil(Math.max(currentMinutes, opens) / 30) * 30;
  const defaultStart = next > 23 * 60 ? opens : next;

  return (
    <>
      <PublicHeader />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 md:px-10 md:py-10">
        <SectionTitle
          eyebrow="Availability"
          title="Cari meja yang tersedia"
          action={
            <span className="font-mono text-label-sm text-ink-muted">
              Hold {settings.holdDurationMinutes} menit · Buffer {settings.bufferMinutes} menit
            </span>
          }
        />

        <div className="mt-6">
          <BookingPicker
            initialDate={today}
            todayDate={today}
            defaultStartMin={defaultStart}
          />
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
