"use client";

import { useState } from "react";

import { Countdown } from "./live.tsx";
import { StatusBadge, type TableState } from "./ui.tsx";

/**
 * One row in the table operations grid.
 *
 * Only MAINTENANCE is writable. Setting it makes the table invisible to
 * availability for everyone, so it asks for a reason, and the server action
 * refuses the write without one. Clearing it is a single click because putting a
 * table back in service needs no justification.
 */
export function TableOpsRow({
  table,
  action,
}: {
  table: {
    tableId: string;
    code: string;
    name: string;
    type: string;
    zone: string | null;
    state: TableState;
    storedStatus: string;
    busyUntil: string | null;
    holdExpiresAt: string | null;
    bookingCode: string | null;
    customerName: string | null;
  };
  action: (formData: FormData) => Promise<void>;
}) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const inMaintenance = table.state === "MAINTENANCE";

  return (
    <>
      <tr className="border-b border-rule last:border-0 hover:bg-canvas-recessed">
        <td className="px-3 py-2.5">
          <div className="font-mono text-label-md text-ink">{table.code}</div>
          <div className="text-label-sm text-ink-muted">{table.name}</div>
        </td>
        <td className="px-3 py-2.5 font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted">
          {table.zone ?? "—"}
        </td>
        <td className="px-3 py-2.5 font-mono text-label-sm text-ink-secondary">{table.type}</td>
        <td className="px-3 py-2.5">
          <StatusBadge state={table.state} />
        </td>
        <td className="px-3 py-2.5">
          {table.customerName ? (
            <div>
              <div className="truncate text-body-sm text-ink">{table.customerName}</div>
              <div className="font-mono text-label-sm text-ink-muted">{table.bookingCode}</div>
            </div>
          ) : (
            <span className="font-mono text-label-sm text-ink-faint">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          {table.state === "HELD" && table.holdExpiresAt ? (
            <Countdown endsAt={table.holdExpiresAt} prefix="Hold" className="text-label-md" />
          ) : table.busyUntil ? (
            <Countdown endsAt={table.busyUntil} prefix="Sisa" className="text-label-md" />
          ) : (
            <span className="font-mono text-label-sm text-ink-faint">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          {inMaintenance ? (
            <form action={action}>
              <input type="hidden" name="tableId" value={table.tableId} />
              <input type="hidden" name="next" value="AVAILABLE" />
              <button
                type="submit"
                className="rounded-core border border-rule-strong px-2.5 py-1 font-mono text-label-sm uppercase tracking-[0.06em] text-ink hover:bg-surface-accent"
              >
                Kembalikan
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setReasonOpen((v) => !v)}
              className="rounded-core border border-rule-strong px-2.5 py-1 font-mono text-label-sm uppercase tracking-[0.06em] text-ink-muted hover:bg-surface-accent hover:text-ink"
            >
              Maintenance
            </button>
          )}
        </td>
      </tr>

      {reasonOpen && !inMaintenance ? (
        <tr className="border-b border-rule bg-maint-wash">
          <td colSpan={7} className="px-3 py-3">
            <form action={action} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="tableId" value={table.tableId} />
              <input type="hidden" name="next" value="MAINTENANCE" />
              <label className="min-w-[280px] flex-1">
                <span className="block font-mono text-label-sm uppercase tracking-[0.06em] text-maint">
                  Alasan maintenance (wajib)
                </span>
                <input
                  name="reason"
                  required
                  maxLength={500}
                  placeholder="Contoh: ganti cloth dan rapikan rail"
                  className="mt-1 w-full rounded-core border border-rule-strong bg-surface px-3 py-2 text-body-sm focus:border-maint focus:outline-none focus:ring-[3px] focus:ring-maint/15"
                />
              </label>
              <button
                type="submit"
                className="rounded-core bg-maint px-3 py-2 font-mono text-label-sm font-semibold uppercase tracking-[0.06em] text-white hover:opacity-90"
              >
                Tandai maintenance
              </button>
              <button
                type="button"
                onClick={() => setReasonOpen(false)}
                className="rounded-core border border-rule-strong px-3 py-2 font-mono text-label-sm uppercase tracking-[0.06em] text-ink hover:bg-surface-accent"
              >
                Batal
              </button>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}
