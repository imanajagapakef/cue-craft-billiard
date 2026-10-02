import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminShell } from "@/components/adminShell.tsx";
import { SessionControl } from "@/components/sessionControl.tsx";
import { SectionTitle } from "@/components/ui.tsx";
import { db } from "@/lib/db.ts";
import { getExtensionQuote } from "@/lib/bookings.ts";

export const metadata: Metadata = { title: "Kontrol Sesi — Cue & Rail" };
export const dynamic = "force-dynamic";

/**
 * Active session control — active_match_session_control.
 *
 * This is the screen a cashier watches for four hours at a time, so it leads with
 * the clock and the customer, and pushes the two destructive actions to the side
 * rail where they cannot be hit by accident.
 */
export default async function SessionPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const session = await db.session.findUnique({
    where: { id },
    include: {
      booking: { include: { table: true, payments: true } },
    },
  });
  if (!session) notFound();

  const quote = await getExtensionQuote(id).catch(() => ({
    canExtend: false,
    maxMinutes: 0,
    increments: [],
    priceByMinutes: {} as Record<string, number>,
    reason: "Sesi sudah selesai",
  }));

  const depositPaid = session.booking.payments
    .filter((p) => p.status === "PAID")
    .reduce((sum, p) => sum + p.amount, 0);

  const pendingCount = await db.payment.count({
    where: { status: { in: ["PENDING", "PROOF_SUBMITTED"] } },
  });

  return (
    <AdminShell active="kasir" pendingPayments={pendingCount}>
      <SectionTitle
        eyebrow="Session Control"
        title={`${session.booking.table.code} · ${session.booking.customerName}`}
        action={
          <span className="font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
            {session.status}
          </span>
        }
      />

      <div className="mt-6">
        <SessionControl
          session={{
            id: session.id,
            tableCode: session.booking.table.code,
            tableName: session.booking.table.name,
            customerName: session.booking.customerName,
            customerPhone: session.booking.customerPhone,
            bookingCode: session.booking.code,
            status: session.status,
            startedAt: session.startedAt.toISOString(),
            scheduledEndAt: session.scheduledEndAt.toISOString(),
            extendedMinutes: session.extendedMinutes,
            totalPrice: session.booking.totalPrice,
            depositPaid,
          }}
          initialQuote={quote}
        />
      </div>
    </AdminShell>
  );
}
