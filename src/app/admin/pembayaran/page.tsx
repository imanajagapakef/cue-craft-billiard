import type { Metadata } from "next";

import { AdminShell } from "@/components/adminShell.tsx";
import { VerificationQueue } from "@/components/verificationQueue.tsx";
import { SectionTitle } from "@/components/ui.tsx";
import { db } from "@/lib/db.ts";
import { expireLapsedHolds } from "@/lib/sweep.ts";
import { getSettings } from "@/lib/settings.ts";

export const metadata: Metadata = { title: "Verifikasi Pembayaran — Cue & Rail" };
export const dynamic = "force-dynamic";

/**
 * Payment verification queue — deposit_verification_table_hold_status.
 *
 * Anything with a payment in PENDING or PROOF_SUBMITTED. The filter on
 * booking.status = AWAITING_DEPOSIT keeps extension and final-settlement bills on
 * their own screens, where the action is "collect", not "verify a transfer".
 */
export default async function PembayaranPage() {
  await expireLapsedHolds();
  const settings = await getSettings();

  const rows = await db.payment.findMany({
    where: {
      kind: "DEPOSIT",
      status: { in: ["PENDING", "PROOF_SUBMITTED"] },
      booking: { status: "AWAITING_DEPOSIT" },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      method: true,
      status: true,
      amount: true,
      createdAt: true,
      proofPath: true,
      booking: {
        select: {
          code: true,
          customerName: true,
          customerPhone: true,
          startAt: true,
          endAt: true,
          holdExpiresAt: true,
          table: { select: { code: true } },
        },
      },
    },
  });

  const pendingCount = await db.payment.count({
    where: { status: { in: ["PENDING", "PROOF_SUBMITTED"] } },
  });

  return (
    <AdminShell active="pembayaran" pendingPayments={pendingCount}>
      <SectionTitle
        eyebrow="Deposit Verification"
        title="Verifikasi DP"
        action={
          <span className="font-mono text-label-sm text-ink-muted">
            {rows.length} menunggu · hold {settings.holdDurationMinutes} menit
          </span>
        }
      />

      <div className="mt-6">
        <VerificationQueue
          rows={rows.map((p) => ({
            id: p.id,
            kind: p.kind,
            method: p.method,
            status: p.status,
            amount: p.amount,
            createdAt: p.createdAt.toISOString(),
            proofPath: p.proofPath,
            booking: {
              code: p.booking.code,
              customerName: p.booking.customerName,
              customerPhone: p.booking.customerPhone,
              startAt: p.booking.startAt.toISOString(),
              endAt: p.booking.endAt.toISOString(),
              holdExpiresAt: p.booking.holdExpiresAt?.toISOString() ?? null,
              tableCode: p.booking.table.code,
            },
          }))}
        />
      </div>

      <p className="mt-6 border-t border-rule pt-4 text-body-sm text-ink-muted">
        Menolak pembayaran tidak otomatis membatalkan booking — meja tetap ditahan sampai hold
        habis, jadi customer bisa upload ulang. Konfirmasi lewat WhatsApp dikirim setelah
        keputusan, dan kegagalan pengiriman tidak membatalkan pembayaran.
      </p>
    </AdminShell>
  );
}
