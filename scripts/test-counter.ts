/**
 * Walk-in → session → extension → checkout, over real HTTP.
 *
 * Run: npx tsx scripts/test-counter.ts  (needs `npm run dev` running)
 *
 * Complements test-flow.ts, which exercises the service layer in-process. This
 * one drives the same journey through the HTTP surface a cashier actually uses:
 * session cookie, server-rendered pages, JSON endpoints. It is what catches
 * wiring mistakes that a service-layer test cannot see — a missing auth guard, a
 * page that throws on real data, a form that posts to a path that does not exist.
 *
 * Creates a walk-in (no deposit), extends it, then checks out and settles. Cleans
 * up after itself.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = "kasir@cueandrail.test";
const PASSWORD = "kasir-dev-123";

// Makes this file a module. Without it, tsc treats every script under scripts/ as
// sharing one global scope and reports the consts and helpers below as redeclared.
export {};

let passed = 0;
let failed = 0;
let bookingCode: string | null = null;
let sessionId: string | null = null;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const cookies = new Map<string, string>();
const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");

function absorb(res: Response) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

/** Shape of the availability endpoint, narrowed to the fields these checks read. */
type AvailabilityTable = {
  tableId: string;
  code: string;
  available: boolean;
  totalPrice: number;
};
type AvailabilityBody = { tables?: AvailabilityTable[] };

type ApiError = { error?: { code?: string; message?: string; details?: unknown } };

type WalkInResponse = ApiError & {
  code?: string;
  status?: string;
  sessionId?: string;
  totalPrice?: number;
};

type QuoteResponse = {
  canExtend: boolean;
  maxMinutes: number;
  increments: number[];
  priceByMinutes: Record<string, number>;
  reason: string | null;
};

type ExtensionResponse = ApiError & {
  extensionId?: string;
  price?: number;
  status?: string;
  usedOverride?: boolean;
};

type EndResponse = ApiError & {
  overage?: number;
  owed?: number;
  bill?: number;
  extensionTotal?: number;
};

type ConfirmResponse = ApiError & {
  bookingStatus?: string;
  bookingCode?: string;
  alreadyApplied?: boolean;
};

type CsrfResponse = { csrfToken: string };

async function req<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown; form?: Record<string, string> } = {},
): Promise<{ status: number; body: T; text: string }> {
  const headers: Record<string, string> = { cookie: cookieHeader() };
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(init.form);
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers, body, redirect: "manual" });
  absorb(res);
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* HTML page, not JSON */
  }
  return { status: res.status, body: parsed as T, text };
}

async function signIn() {
  const csrf = await req<CsrfResponse>("/api/auth/csrf");
  await req("/api/auth/callback/credentials", {
    method: "POST",
    form: {
      csrfToken: csrf.body.csrfToken,
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: `${BASE}/admin`,
    },
  });
  return cookies.has("authjs.session-token");
}

/** Next half-hour slot at least an hour out, as minutes from local midnight. */
function pickStartMin(): number {
  const now = new Date(Date.now() + 7 * 60 * 60_000);
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  const next = Math.ceil(Math.max(cur, 10 * 60) / 30) * 30;
  return next > 23 * 60 ? 10 * 60 : next;
}

const startIso = (minutes: number) => {
  const shifted = new Date(Date.now() + 7 * 60 * 60_000);
  const day = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
  return new Date(day.getTime() + minutes * 60_000 - 7 * 60 * 60_000).toISOString();
};

async function main() {
  console.log(`\nCounter journey — ${BASE}\n`);

  check("staff sign-in succeeds", await signIn());

  // ── Find a free table from the cashier page's own data ──────────────────────
  const availability = await req<AvailabilityBody>(
    `/api/availability?date=${new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10)}&startMin=${pickStartMin()}&durationMin=120`,
  );
  const free = (availability.body?.tables ?? []).filter(
    (t) => t.available,
  );
  check("at least one table is free", free.length > 0, `${free.length} free`);
  const table = free[0];

  // ── Walk-in ─────────────────────────────────────────────────────────────────
  const walkIn = await req<WalkInResponse>("/api/admin/bookings", {
    method: "POST",
    json: {
      customerName: "Counter Probe",
      customerPhone: "081200000001",
      tableId: table.tableId,
      startAt: startIso(pickStartMin()),
      durationMin: 120,
    },
  });
  bookingCode = walkIn.body?.code ?? null;
  sessionId = walkIn.body?.sessionId ?? null;
  check("walk-in created", walkIn.status === 201 && Boolean(bookingCode), `status ${walkIn.status}`);
  check("walk-in starts CHECKED_IN with a session", walkIn.body?.status === "CHECKED_IN" && Boolean(sessionId));
  check("walk-in carries no deposit", (walkIn.body.totalPrice ?? 0) > 0, `total ${walkIn.body.totalPrice}`);

  // ── Session page renders ────────────────────────────────────────────────────
  const sessionPage = await req(`/admin/sesi/${sessionId}`);
  check(
    "session control page renders",
    sessionPage.status === 200 && sessionPage.text.includes("Sesi Aktif"),
    `status ${sessionPage.status}`,
  );

  // ── Extension quote ─────────────────────────────────────────────────────────
  const quote = await req<QuoteResponse>(`/api/admin/sessions/${sessionId}/quote`);
  check("extension quote responds", quote.status === 200, `status ${quote.status}`);
  const q = quote.body as {
    canExtend: boolean;
    maxMinutes: number;
    increments: number[];
    priceByMinutes: Record<string, number>;
  };
  check("quote reports a positive ceiling", q?.maxMinutes > 0, `max ${q?.maxMinutes}`);
  check("quote offers only increments within the ceiling", (q?.increments ?? []).every((m) => m <= q.maxMinutes));

  // ── Extension beyond the ceiling is refused ─────────────────────────────────
  const tooLong = await req<ApiError>(`/api/admin/sessions/${sessionId}/extend`, {
    method: "POST",
    json: { minutes: 240 },
  });
  check(
    "over-long extension refused with the real maximum",
    tooLong.status === 409 && tooLong.body?.error?.code === "EXTENSION_TOO_LONG",
    `status ${tooLong.status}`,
  );

  // ── Extension within the ceiling creates a payment, not free time ───────────
  const minutes = (q?.increments ?? [30])[0] ?? 30;
  const extension = await req<ExtensionResponse>(`/api/admin/sessions/${sessionId}/extend`, {
    method: "POST",
    json: { minutes },
  });
  check("extension request accepted", extension.status === 201, `status ${extension.status}`);
  check("extension is priced", (extension.body.price ?? 0) > 0, `price ${extension.body.price}`);
  check("extension starts PENDING", extension.body?.status === "PENDING");

  // Confirm the extension payment, which is what actually grants the time.
  const db = await import("../src/lib/db.ts");
  const extPayment = await db.db.payment.findFirst({
    where: { extensionId: extension.body?.extensionId },
  });
  check("extension produced a payment row", Boolean(extPayment));

  const confirmExt = await req<ConfirmResponse>(`/api/admin/payments/${extPayment?.id}/confirm`, {
    method: "POST",
    json: {},
  });
  check("extension payment confirms", confirmExt.status === 200, `status ${confirmExt.status}`);

  const sessionAfter = await db.db.session.findUnique({ where: { id: String(sessionId) } });
  check(
    "paying the extension added the minutes to the session",
    sessionAfter?.extendedMinutes === minutes,
    `extendedMinutes ${sessionAfter?.extendedMinutes}, expected ${minutes}`,
  );

  // ── Checkout ────────────────────────────────────────────────────────────────
  const end = await req<EndResponse>(`/api/admin/sessions/${sessionId}/end`, { method: "POST", json: {} });
  check("session ends and produces a bill", end.status === 200 && typeof end.body?.bill === "number");
  check("no overage charged when ending on time", end.body?.overage === 0, `overage ${end.body?.overage}`);

  const finalPayment = await db.db.payment.findFirst({
    where: { bookingId: (await db.db.booking.findUniqueOrThrow({ where: { code: String(bookingCode) } })).id, kind: "FINAL" },
  });
  check("checkout created a FINAL payment", Boolean(finalPayment));
  check("final payment equals the bill", finalPayment?.amount === end.body?.bill);

  const confirmFinal = await req<ConfirmResponse>(`/api/admin/payments/${finalPayment?.id}/confirm`, {
    method: "POST",
    json: {},
  });
  check("settling the bill completes the booking", confirmFinal.body?.bookingStatus === "COMPLETED");

  // ── Staff dossier renders the whole record ──────────────────────────────────
  const dossier = await req(`/admin/booking/${bookingCode}`);
  check(
    "staff dossier renders",
    dossier.status === 200 && dossier.text.includes("Staff Dossier"),
    `status ${dossier.status}`,
  );
  check("dossier lists the audit timeline", dossier.text.includes("DP dikonfirmasi") || dossier.text.includes("Walk-in dicatat"));

  // ── Table is released ───────────────────────────────────────────────────────
  const after = await req<AvailabilityBody>(
    `/api/availability?date=${new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10)}&startMin=${pickStartMin()}&durationMin=120`,
  );
  const released = (after.body?.tables ?? []).find(
    (t) => t.tableId === table.tableId,
  );
  check("table is bookable again after COMPLETED", released?.available === true);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (bookingCode) {
      const { db } = await import("../src/lib/db.ts");
      await db.booking.deleteMany({ where: { code: bookingCode } });
      console.log(`cleanup: removed walk-in ${bookingCode}`);
    }
    const { db } = await import("../src/lib/db.ts");
    await db.$disconnect();
  });
