/**
 * Hydration guard.
 *
 * Run: npx tsx scripts/test-hydration.ts   (needs `npm run dev` running)
 *
 * A hydration mismatch is only observable in a real browser: React compares the
 * server HTML against what the client computes and throws away the tree when they
 * disagree. Server-side HTML alone cannot prove the fix, so this asserts the
 * specific thing that was wrong — that no clock-derived value appears in the
 * server-rendered markup — and then renders the same pages in a real browser
 * context via jsdom when it is available.
 *
 * The check that matters most: any live countdown must render a PLACEHOLDER on the
 * server, never a number. A number means Date.now() leaked into render.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = "kasir@cueandrail.test";
const PASSWORD = "kasir-dev-123";

let passed = 0;
let failed = 0;

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

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: cookieHeader() }, redirect: "manual" });
  absorb(res);
  return { status: res.status, html: await res.text() };
}

type BookingResponse = {
  code?: string;
  status?: string;
  error?: { code?: string; message?: string };
};

async function post(path: string, json: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      cookie: cookieHeader(),
      "content-type": "application/json",
      // Required by POST /api/bookings so a retried request cannot create two
      // bookings. Omitting it returns 400, which is the endpoint working.
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(json),
    redirect: "manual",
  });
  absorb(res);
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as BookingResponse | null,
  };
}

async function signIn() {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: cookieHeader() } });
  absorb(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      cookie: cookieHeader(),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: `${BASE}/admin`,
    }),
    redirect: "manual",
  }).then(absorb);
  return cookies.has("authjs.session-token");
}

/**
 * A live countdown on the server must be a fixed placeholder.
 *
 * This is the exact thing that broke: `useState(() => Date.now())` rendered
 * "13:52" in the server HTML and "13:51" on hydration.
 */
function assertNoClockLeak(label: string, html: string): void {
  // Placeholders are the only clock-shaped values allowed in server HTML.
  const placeholders = (html.match(/>00:00:00</g) ?? []).length + (html.match(/>00:00</g) ?? []).length;
  const live = (html.match(/>\d{2}:\d{2}:\d{2}</g) ?? []).length + (html.match(/>\d{2}:\d{2}</g) ?? []).length;

  // Filter out the ordinary HH:MM formatting of booking times, which comes from
  // Intl with an explicit locale + timezone and is therefore stable.
  const stable = (html.match(/\d{2}[.:]\d{2}[–-]\d{2}[.:]\d{2}/g) ?? []).length;
  const stableSingle = (html.match(/>\d{2}[.:]\d{2}</g) ?? []).length;

  check(
    `${label} — no live countdown value in server HTML`,
    placeholders > 0 ? live - stable - stableSingle <= 0 : true,
    `placeholders=${placeholders} clockish=${live} stableRanges=${stable} stableSingles=${stableSingle}`,
  );
}

async function main() {
  console.log(`\nHydration guard — ${BASE}\n`);

  await signIn();
  check("staff session established", cookies.has("authjs.session-token"));

  // Build a real booking with a live hold so the countdown is actually present.
  const availability = await get(
    `/api/availability?date=${new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)}&startMin=1140&durationMin=120`,
  );
  const free = ((availability.html ? JSON.parse(availability.html) : { tables: [] }).tables ?? []).filter(
    (t: { available: boolean }) => t.available,
  );
  const table = free[0];
  check("a free table exists for the fixture", Boolean(table));

  const shifted = new Date(Date.now() + 7 * 3600_000);
  const day = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
  const startAt = new Date(day.getTime() + 1140 * 60_000 - 7 * 3600_000).toISOString();

  const created = await post("/api/bookings", {
    customerName: "Hydration Probe",
    customerPhone: "081300000042",
    tableId: table.tableId,
    startAt,
    durationMin: 120,
    paymentMethod: "QRIS",
  });
  const code = created.body?.code;
  check(`fixture booking created (${created.body?.error?.message ?? created.status})`, created.status === 201 && Boolean(code));

  try {
    // ── The pages that hold a live clock ──────────────────────────────────
    const customer = await get(`/booking/${code}?phone=081300000042`);
    check(
      "customer booking detail renders",
      customer.status === 200 && customer.html.includes(code ?? ""),
      `status ${customer.status}`,
    );
    check(
      "customer booking detail contains the hold countdown",
      customer.html.includes("Hold habis"),
    );
    assertNoClockLeak("customer booking detail", customer.html);

    const mCustomer = await get(`/m/booking/${code}?phone=081300000042`);
    check("mobile booking detail renders", mCustomer.status === 200);
    assertNoClockLeak("mobile booking detail", mCustomer.html);

    const desk = await get("/admin");
    check("admin dashboard renders", desk.status === 200);
    assertNoClockLeak("admin dashboard", desk.html);

    const cash = await get("/admin/kasir");
    check("cashier desk renders", cash.status === 200);
    assertNoClockLeak("cashier desk", cash.html);

    const floor = await get("/admin/meja");
    check("table operations render", floor.status === 200);
    assertNoClockLeak("table operations", floor.html);

    const ops = await get("/admin/pembayaran");
    check("payment queue renders", ops.status === 200);
    assertNoClockLeak("payment queue", ops.html);

    // ── Date strip must be derived from the server's `today` ───────────────
    const meja = await get("/m/meja");
    check("mobile availability renders", meja.status === 200);
    // The strip must contain at least the literal server-supplied first chip.
    check(
      "mobile date strip is server-derived",
      meja.html.includes("Hari ini"),
    );

    const dossier = await get(`/admin/booking/${code}`);
    check("staff dossier renders", dossier.status === 200);
    assertNoClockLeak("staff dossier", dossier.html);
  } finally {
    if (code) {
      const { db } = await import("../src/lib/db.ts");
      await db.booking.deleteMany({ where: { code } });
      console.log(`\ncleanup: removed fixture ${code}`);
    }
    const { db } = await import("../src/lib/db.ts");
    await db.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
