import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { apiError, handler } from "@/lib/api.ts";
import { submitProof } from "@/lib/bookings.ts";
import { dispatchAfterResponse } from "@/lib/notify.ts";

/**
 * Upload a QRIS payment proof — Project.md §19, §20.
 *
 * The client filename is never used. It is attacker-controlled and can carry
 * path traversal, so the stored name is generated here and the booking code is
 * sanitised to the exact shape our own codes have.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const CODE_RE = /^BK-[0-9A-Z]{4,8}$/;

export const POST = handler(
  async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
    const { code } = await ctx.params;
    const upper = code.toUpperCase();

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return apiError(400, "INVALID_FORM", "Body harus multipart/form-data");
    }

    const phone = String(form.get("phone") ?? "");
    const file = form.get("proof");

    if (!phone) return apiError(400, "PHONE_REQUIRED", "Nomor HP wajib diisi");
    if (!(file instanceof File)) {
      return apiError(400, "PROOF_REQUIRED", "Bukti pembayaran wajib diunggah");
    }

    const ext = ALLOWED[file.type];
    if (!ext) {
      return apiError(
        415,
        "UNSUPPORTED_TYPE",
        "Format harus JPG, PNG, atau WebP",
      );
    }
    if (file.size > MAX_BYTES) {
      return apiError(413, "FILE_TOO_LARGE", "Ukuran maksimal 5 MB");
    }

    // Validated before it is used as a path segment.
    if (!CODE_RE.test(upper)) {
      return apiError(400, "INVALID_CODE", "Kode booking tidak valid");
    }

    const dir = path.join(process.cwd(), "public", "uploads", "proof", upper);
    await mkdir(dir, { recursive: true });

    const filename = `${randomBytes(16).toString("hex")}.${ext}`;
    await writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));
    // Public path is derived from the booking code only, never from input.
    const proofPath = `/uploads/proof/${upper}/${filename}`;

    const payment = await submitProof({ bookingCode: upper, customerPhone: phone, proofPath });

    dispatchAfterResponse();
    return NextResponse.json({ paymentId: payment.id, status: payment.status }, { status: 201 });
  },
);
