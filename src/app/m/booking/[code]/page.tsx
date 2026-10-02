import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { MobileShell } from "@/components/mobile.tsx";
import { MobileBookingDossier } from "@/components/mobileBooking.tsx";
import { requireOwnBookingByCode } from "@/lib/bookings.ts";
import { db } from "@/lib/db.ts";
import { getSettings } from "@/lib/settings.ts";

export const metadata: Metadata = { title: "Booking — Cue & Rail" };
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#fbf9f5",
};

/**
 * Mobile booking — mobile_keyless_pass_booking_dossier.
 *
 * The thing a customer actually shows the cashier is the pass, so it comes first
 * and takes the whole screen width. Deposit payment and the timeline sit below
 * it, reachable but not competing with it.
 *
 * Same credential rule as desktop: booking code plus phone number.
 */
export default async function MobileBookingPage(props: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ phone?: string }>;
}) {
  const { code } = await props.params;
  const { phone } = await props.searchParams;

  if (!phone) redirect("/m/booking");

  let booking;
  try {
    booking = await requireOwnBookingByCode(code, phone!);
  } catch {
    return (
      <MobileShell active="/m/booking" title="Tidak ditemukan" subtitle={code.toUpperCase()}>
        <div className="border border-maint bg-maint-wash px-4 py-6 text-center">
          <p className="text-body-md text-maint">
            Booking tidak ditemukan. Kode dan nomor HP tidak cocok.
          </p>
          <Link
            href="/m/booking"
            className="mt-4 inline-block rounded-core bg-emerald px-4 py-2.5 text-body-md font-semibold text-white"
          >
            Coba lagi
          </Link>
        </div>
      </MobileShell>
    );
  }

  const [table, payments, session, timeline, settings] = await Promise.all([
    db.table.findUniqueOrThrow({ where: { id: booking.tableId } }),
    db.payment.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: "asc" } }),
    db.session.findFirst({ where: { bookingId: booking.id, status: { in: ["ACTIVE", "OVERDUE"] } } }),
    db.auditLog.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: "asc" }, take: 40 }),
    getSettings(),
  ]);

  return (
    <MobileShell
      active="/m/booking"
      title={booking.code}
      subtitle={`${table.code} · ${settings.venueName}`}
    >
      <MobileBookingDossier
        phone={phone!}
        booking={{
          code: booking.code,
          status: booking.status,
          customerName: booking.customerName,
          startAt: booking.startAt.toISOString(),
          endAt: booking.endAt.toISOString(),
          totalPrice: booking.totalPrice,
          depositAmount: booking.depositAmount,
          remainingAmount: booking.remainingAmount,
          holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
        }}
        table={{ code: table.code, name: table.name, zone: table.zone }}
        payments={payments.map((p) => ({
          id: p.id,
          kind: p.kind,
          method: p.method,
          status: p.status,
          amount: p.amount,
          proofPath: p.proofPath,
          rejectionReason: p.rejectionReason,
        }))}
        session={
          session
            ? {
                scheduledEndAt: session.scheduledEndAt.toISOString(),
                extendedMinutes: session.extendedMinutes,
              }
            : null
        }
        timeline={timeline.map((t) => ({
          id: t.id,
          action: t.action,
          actorName: t.actorName,
        }))}
      />
    </MobileShell>
  );
}
