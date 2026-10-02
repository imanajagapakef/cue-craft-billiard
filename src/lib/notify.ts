/**
 * WhatsApp notification outbox — Project.md §31, §32, §33, §66.
 *
 * Three rules, and they are the whole reason this file exists:
 *
 *   1. The outbox row is written INSIDE the transaction that changes state, so a
 *      crash after commit cannot silently lose the notification.
 *   2. Dispatch happens AFTER the response is flushed, so the admin UI never waits
 *      on the provider.
 *   3. Dispatch failure is recorded, never raised. A failed WhatsApp must not roll
 *      back a payment or a booking (§33).
 *
 * MVP uses no queue service. `status = PENDING` rows plus an `attempts` counter
 * are enough to add a retry loop later without a schema change.
 */

import { after } from "next/server";
import type { NotificationEvent, Prisma } from "@prisma/client";

import { db } from "./db.ts";

type Tx = Prisma.TransactionClient;

export type BookingContext = {
  code: string;
  venueName: string;
  customerName: string;
  customerPhone: string;
  tableCode: string;
  dateLabel: string;
  timeLabel: string;
  totalPrice: number;
  depositAmount: number;
  remainingAmount: number;
  holdExpiresAt: Date | null;
  detailUrl: string | null;
  rejectionReason: string | null;
};

const rupiah = (n: number) =>
  `Rp${n.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;

/**
 * Message bodies, transcribed from Project.md §28–30. Indonesian, because the
 * customers reading them are Indonesian.
 */
function bodyFor(event: NotificationEvent, c: BookingContext): string {
  switch (event) {
    case "BOOKING_CREATED":
      return [
        `${c.venueName}`,
        ``,
        `Booking kamu berhasil dibuat dan meja sudah ditahan sementara.`,
        ``,
        `Booking: ${c.code}`,
        `Meja: ${c.tableCode}`,
        `Jam: ${c.timeLabel}`,
        ``,
        `DP: ${rupiah(c.depositAmount)}`,
        `Total: ${rupiah(c.totalPrice)}`,
        ``,
        c.holdExpiresAt
          ? `Silakan bayar DP sebelum ${c.holdExpiresAt.toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Jakarta",
            })} WIB untuk mengonfirmasi booking.`
          : `Silakan lakukan pembayaran DP sesuai metode yang dipilih.`,
        ``,
        `Setelah DP dikonfirmasi kasir, kamu akan menerima pesan konfirmasi.`,
      ].join("\n");

    case "PAYMENT_PROOF_SUBMITTED":
      return [
        `${c.venueName}`,
        ``,
        `Bukti pembayaran untuk booking ${c.code} sudah kami terima.`,
        ``,
        `Meja: ${c.tableCode}`,
        `Jam: ${c.timeLabel}`,
        `DP: ${rupiah(c.depositAmount)}`,
        ``,
        `Kasir sedang memverifikasi. Kamu akan ada kabarnya shortly.`,
      ].join("\n");

    case "PAYMENT_CONFIRMED":
      return [
        `${c.venueName}`,
        ``,
        `Booking kamu sudah dikonfirmasi.`,
        ``,
        `Booking: ${c.code}`,
        `Meja: ${c.tableCode}`,
        `Tanggal: ${c.dateLabel}`,
        `Jam: ${c.timeLabel}`,
        ``,
        `DP ${rupiah(c.depositAmount)} telah diterima.`,
        ``,
        `Sisa pembayaran: ${rupiah(c.remainingAmount)}`,
        ``,
        c.detailUrl ? `Lihat detail booking: ${c.detailUrl}` : ``,
        ``,
        `Sampai jumpa dan selamat bermain!`,
      ]
        .filter(Boolean)
        .join("\n");

    case "PAYMENT_REJECTED":
      return [
        `${c.venueName}`,
        ``,
        `Pembayaran untuk booking ${c.code} belum dapat dikonfirmasi.`,
        ``,
        `Silakan periksa kembali bukti pembayaran atau lakukan pembayaran ulang melalui halaman booking.`,
        ``,
        c.rejectionReason ? `Alasan: ${c.rejectionReason}` : ``,
        c.detailUrl ? `Buka lagi: ${c.detailUrl}` : ``,
      ]
        .filter(Boolean)
        .join("\n");

    case "BOOKING_CANCELLED":
      return [
        `${c.venueName}`,
        ``,
        `Booking ${c.code} di meja ${c.tableCode} sudah dibatalkan.`,
        ``,
        c.detailUrl ? `Detail: ${c.detailUrl}` : ``,
      ]
        .filter(Boolean)
        .join("\n");

    case "NO_SHOW":
      return [
        `${c.venueName}`,
        ``,
        `Booking ${c.code} ditandai tidak hadir.`,
        ``,
        `Meja: ${c.tableCode}`,
        `Jam: ${c.timeLabel}`,
        ``,
        `Hubungi kasir jika ini keliru.`,
      ].join("\n");

    case "EXTENSION_CONFIRMED":
      return [
        `${c.venueName}`,
        ``,
        `Perpanjangan sesi untuk booking ${c.code} sudah disetujui.`,
        ``,
        `Meja: ${c.tableCode}`,
        `Jam baru: ${c.timeLabel}`,
      ].join("\n");

    case "SESSION_ENDING":
      return [
        `${c.venueName}`,
        ``,
        `Waktu main untuk booking ${c.code} hampir habis.`,
        ``,
        `Meja: ${c.tableCode}`,
        `Selesai: ${c.timeLabel}`,
        ``,
        `Butuh waktu tambahan? Hubungi kasir.`,
      ].join("\n");

    case "BOOKING_REMINDER":
      return [
        `${c.venueName}`,
        ``,
        `Pengingat booking kamu besok.`,
        ``,
        `Booking: ${c.code}`,
        `Meja: ${c.tableCode}`,
        `Jam: ${c.timeLabel}`,
      ].join("\n");
  }
}

/**
 * Queue a notification. Must be called with the transaction client so the row
 * lands in the same commit as the state change that caused it.
 *
 * The venue name travels in `ctx` rather than in a settings object, so this
 * function stays a pure writer and callers cannot pass mismatched venue config.
 */
export async function queueNotification(
  tx: Tx,
  args: {
    event: NotificationEvent;
    bookingId: string | null;
    ctx: BookingContext;
  },
): Promise<void> {
  await tx.notificationLog.create({
    data: {
      bookingId: args.bookingId,
      event: args.event,
      channel: "WHATSAPP",
      recipient: normalisePhone(args.ctx.customerPhone),
      body: bodyFor(args.event, args.ctx),
      status: "PENDING",
      template: args.event,
    },
  });
}

/** Indonesian mobile numbers to E.164 digits without a plus. */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  return digits;
}

/**
 * Send every pending notification, then mark the outcome.
 *
 * Never throws. Provider configuration is intentionally minimal for MVP: with no
 * API key configured the message is logged and marked SENT, so the rest of the
 * flow can be exercised end to end without a WhatsApp account. Swap the marked
 * block for a real provider call when one is chosen.
 */
export async function dispatchPendingNotifications(limit = 20): Promise<void> {
  const pending = await db.notificationLog.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  if (pending.length === 0) return;

  for (const n of pending) {
    try {
      const messageId = await send(n.recipient, n.body);
      await db.notificationLog.update({
        where: { id: n.id },
        data: { status: "SENT", sentAt: new Date(), providerMessageId: messageId, attempts: { increment: 1 } },
      });
    } catch (err) {
      // §33: recorded, never propagated. The booking and payment are already
      // committed and must not be affected by a provider outage.
      await db.notificationLog.update({
        where: { id: n.id },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          attempts: { increment: 1 },
          errorMessage: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        },
      });
    }
  }
}

async function send(recipient: string, body: string): Promise<string> {
  const apiKey = process.env.WHATSAPP_API_KEY;
  const provider = process.env.WHATSAPP_PROVIDER;

  if (!apiKey || !provider) {
    // Dev mode: log instead of sending.
    console.log(`[whatsapp] (no provider configured) → ${recipient}\n${body}`);
    return `dev-${Date.now()}`;
  }

  // Provider call goes here. Throwing here is safe: the caller records FAILED
  // and moves on, per §33.
  throw new Error(
    `Provider "${provider}" configured but no send implementation exists yet. Set an empty WHATSAPP_PROVIDER to stay in log mode.`,
  );
}

/** Dispatch after the response is flushed. Request-scoped only. */
export function dispatchAfterResponse(): void {
  after(async () => {
    try {
      await dispatchPendingNotifications();
    } catch (err) {
      console.error("[notify] dispatch failed", err);
    }
  });
}