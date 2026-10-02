import type { Metadata } from "next";
import { revalidatePath } from "next/cache";

import { AdminShell } from "@/components/adminShell.tsx";
import { TableOpsRow } from "@/components/tableOps.tsx";
import { SectionTitle } from "@/components/ui.tsx";
import { requireStaff } from "@/auth.ts";
import { audit } from "@/lib/audit.ts";
import { db } from "@/lib/db.ts";
import { expireLapsedHolds } from "@/lib/sweep.ts";
import { getTableStates, type DerivedTableState } from "@/lib/tableState.ts";

export const metadata: Metadata = { title: "Operasional Meja — Cue & Rail" };
export const dynamic = "force-dynamic";

/**
 * Table operations — table_operations_spatial_floor_command.
 *
 * This screen is where an operator takes a table off the floor. That is the one
 * action here that changes availability for every customer, so it is a server
 * action guarded by a role check and written to the audit log with a reason —
 * not a bare status write.
 *
 * MAINTENANCE is the only stored table status. Everything else on this screen is
 * derived at read time (docs/TECH_DESIGN.md §4); toggling it only clears the
 * override.
 */
export default async function MejaPage() {
  await expireLapsedHolds();
  const staff = await requireStaff();

  const [states, pendingCount] = await Promise.all([
    getTableStates(),
    db.payment.count({ where: { status: { in: ["PENDING", "PROOF_SUBMITTED"] } } }),
  ]);

  async function setMaintenance(formData: FormData) {
    "use server";
    const actor = await requireStaff();
    const tableId = String(formData.get("tableId") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    const desired = String(formData.get("next") ?? "") === "MAINTENANCE";

    if (!tableId) return;

    const table = await db.table.findUnique({ where: { id: tableId } });
    if (!table) return;

    // Coming back from maintenance needs no reason. Going out does: it makes the
    // table bookable again, so the reason must survive in the audit trail.
    if (desired && reason.length === 0) return;

    await db.$transaction(async (tx) => {
      await tx.table.update({
        where: { id: tableId },
        data: { status: desired ? "MAINTENANCE" : "AVAILABLE" },
      });
      await audit(tx, {
        actor: { type: "STAFF", id: actor.id, name: actor.name },
        action: desired ? "table.set_maintenance" : "table.cleared_maintenance",
        entity: "table",
        entityId: tableId,
        before: { status: table.status },
        after: { status: desired ? "MAINTENANCE" : "AVAILABLE" },
        reason: desired ? reason : null,
      });
    });

    revalidatePath("/admin/meja");
    revalidatePath("/admin");
  }

  void staff;

  return (
    <AdminShell active="meja" pendingPayments={pendingCount}>
      <SectionTitle
        eyebrow="Spatial Floor Command"
        title="Operasional meja"
        action={
          <span className="font-mono text-label-sm text-ink-muted">
            {states.length} meja · owner bisa ubah maintenance
          </span>
        }
      />

      <p className="mt-3 max-w-2xl text-body-sm text-ink-muted">
        Status di bawah dihitung dari booking dan sesi yang aktif, bukan disimpan — jadi tidak
        mungkin melenceng dari booking yang justifies-nya. Hanya{" "}
        <span className="font-mono">MAINTENANCE</span> yang menyimpan status, karena itu keputusan
        operator, bukan turunan.
      </p>

      <div className="mt-6 overflow-x-auto border border-rule bg-surface">
        <table className="w-full border-collapse text-body-sm">
          <thead>
            <tr className="border-b border-rule text-left">
              <Th>Meja</Th>
              <Th>Zona</Th>
              <Th>Tipe</Th>
              <Th>Status</Th>
              <Th>Pemesan</Th>
              <Th>Selesai</Th>
              <Th>Aksi</Th>
            </tr>
          </thead>
          <tbody>
            {states.map((t) => (
              <TableOpsRow
                key={t.tableId}
                table={{
                  tableId: t.tableId,
                  code: t.code,
                  name: t.name,
                  type: t.type,
                  zone: t.zone,
                  state: t.state as DerivedTableState,
                  storedStatus: t.storedStatus,
                  busyUntil: t.busyUntil?.toISOString() ?? null,
                  holdExpiresAt: t.holdExpiresAt?.toISOString() ?? null,
                  bookingCode: t.bookingCode,
                  customerName: t.customerName,
                }}
                action={setMaintenance}
              />
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
      {children}
    </th>
  );
}
