import type { Metadata } from "next";

import { PublicFooter, PublicHeader } from "@/components/shell.tsx";
import { BookingDetail } from "@/components/bookingDetail.tsx";
import { requireOwnBookingByCode } from "@/lib/bookings.ts";
import { db } from "@/lib/db.ts";
import { getSettings } from "@/lib/settings.ts";

export const metadata: Metadata = {
  title: "Detail Booking — Cue & Rail",
};

export const dynamic = "force-dynamic";

/**
 * Booking detail and deposit checkout — booking_checkout_deposit_hold, then
 * booking_confirmed_digital_keyless_pass once the deposit is PAID.
 *
 * One page for both states rather than two routes: the deposit panel and the pass
 * are two halves of the same story, and the customer should not have to navigate
 * to find out which half they are in.
 *
 * The phone number is a query parameter because the pair (code + phone) is the
 * credential. There is no customer login in MVP.
 */
export default async function BookingPage(props: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ phone?: string }>;
}) {
  const { code } = await props.params;
  const { phone } = await props.searchParams;

  if (!phone) {
    return (
      <>
        <PublicHeader />
        <main className="mx-auto w-full max-w-[720px] flex-1 px-4 py-16 md:px-10">
          <div className="border border-rule bg-surface px-6 py-10 text-center">
            <h1 className="text-headline-md font-semibold tracking-tight text-ink">
              Nomor HP dibutuhkan
            </h1>
            <p className="mt-2 text-body-md text-ink-secondary">
              Buka halaman ini dari link konfirmasi yang kami kirim, atau masukkan lagi nomor HP
              yang dipakai saat booking.
            </p>
            <form action="/booking" className="mt-6">
              <button
                type="submit"
                className="rounded-core bg-emerald px-5 py-2.5 text-body-md font-semibold text-white hover:bg-emerald-deep"
              >
                Cari Booking Saya
              </button>
            </form>
          </div>
        </main>
        <PublicFooter />
      </>
    );
  }

  let booking;
  try {
    booking = await requireOwnBookingByCode(code, phone);
  } catch {
    // Wrong phone or unknown code: same message for both, so the code cannot be
    // probed for existence.
    return (
      <>
        <PublicHeader />
        <main className="mx-auto w-full max-w-[720px] flex-1 px-4 py-16 md:px-10">
          <div className="border border-maint bg-maint-wash px-6 py-10 text-center">
            <h1 className="text-headline-md font-semibold tracking-tight text-maint">
              Booking tidak ditemukan
            </h1>
            <p className="mt-2 text-body-md text-ink-secondary">
              Kode <span className="font-mono">{code}</span> tidak cocok dengan nomor HP ini.
            </p>
          </div>
        </main>
        <PublicFooter />
      </>
    );
  }

  const [table, payments, session, timeline, settings] = await Promise.all([
    db.table.findUniqueOrThrow({ where: { id: booking.tableId } }),
    db.payment.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: "asc" } }),
    db.session.findFirst({ where: { bookingId: booking.id, status: { in: ["ACTIVE", "OVERDUE"] } } }),
    db.auditLog.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    getSettings(),
  ]);

  return (
    <>
      <PublicHeader />
      <main className="mx-auto w-full max-w-[900px] flex-1 px-4 py-8 md:px-10 md:py-10">
        <BookingDetail
          booking={{
            code: booking.code,
            status: booking.status,
            customerName: booking.customerName,
            customerPhone: booking.customerPhone,
            startAt: booking.startAt.toISOString(),
            endAt: booking.endAt.toISOString(),
            durationMinutes: booking.durationMinutes,
            totalPrice: booking.totalPrice,
            depositAmount: booking.depositAmount,
            remainingAmount: booking.remainingAmount,
            holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
            checkedInAt: booking.checkedInAt?.toISOString() ?? null,
            cancelReason: booking.cancelReason,
          }}
          table={{ code: table.code, name: table.name, type: table.type, zone: table.zone }}
          payments={payments.map((p) => ({
            id: p.id,
            kind: p.kind,
            method: p.method,
            status: p.status,
            amount: p.amount,
            proofPath: p.proofPath,
            proofUploadedAt: p.proofUploadedAt?.toISOString() ?? null,
            rejectionReason: p.rejectionReason,
            verifiedAt: p.verifiedAt?.toISOString() ?? null,
          }))}
          session={
            session
              ? {
                  id: session.id,
                  status: session.status,
                  startedAt: session.startedAt.toISOString(),
                  scheduledEndAt: session.scheduledEndAt.toISOString(),
                  extendedMinutes: session.extendedMinutes,
                }
              : null
          }
          timeline={timeline.map((t) => ({
            id: t.id,
            at: t.createdAt.toISOString(),
            action: t.action,
            actorName: t.actorName,
            reason: t.reason,
          }))}
          venueName={settings.venueName}
          qrisPayload={settings.qrisStaticPayload}
          phone={phone}
        />
      </main>
      <PublicFooter />
    </>
  );
}
