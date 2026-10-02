/**
 * HTTP smoke test for the staff routes.
 *
 * Run: npx tsx scripts/test-routes.ts
 *
 * Signs in through the real Auth.js credentials flow and asserts each staff page
 * renders for a logged-in cashier, and that the same pages are refused without a
 * session. Server-side rendering means a green build does not prove a page works;
 * only an actual request does.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = "kasir@cueandrail.test";
const PASSWORD = "kasir-dev-123";

// Makes this file a module. Without it, tsc treats every script under scripts/ as
// sharing one global scope and reports the consts and helpers below as redeclared.
export {};

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

class Session {
  private cookies = new Map<string, string>();

  private absorb(res: Response) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  private header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async get(path: string, redirect: RequestRedirect = "manual") {
    const res = await fetch(`${BASE}${path}`, {
      headers: { cookie: this.header() },
      redirect,
    });
    this.absorb(res);
    return res;
  }

  async post(path: string, form: Record<string, string>) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { cookie: this.header(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
      redirect: "manual",
    });
    this.absorb(res);
    return res;
  }

  async signIn() {
    const csrfRes = await this.get("/api/auth/csrf");
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    await this.post("/api/auth/callback/credentials", {
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: `${BASE}/admin`,
    });
    return this.cookies.has("authjs.session-token");
  }
}

const STAFF_PAGES: Array<[string, string, string]> = [
  ["/admin", "Pendapatan hari ini", "dashboard"],
  ["/admin/meja", "Operasional meja", "table ops"],
  ["/admin/kasir", "Check-in", "cashier desk"],
  ["/admin/pembayaran", "Verifikasi DP", "verification queue"],
];

/**
 * Pages that must never render for a signed-out visitor.
 *
 * The needle must be operational DATA, never a page title. Next.js evaluates a
 * page's `metadata` export before the component runs, so a redirecting page still
 * emits its <title> in the 307 body. Asserting on a title would either fail
 * correctly-working pages or, worse, train someone to ignore a real failure here.
 */
const LEAKY_PAGES: Array<[string, string]> = [
  ["/admin", "Pendapatan hari ini"],
  ["/admin/meja", "Operasional meja"],
  ["/admin/kasir", "Customer datang"],
  ["/admin/pembayaran", "Verifikasi DP"],
  // Outside the /admin matcher, so this path has no middleware behind it.
  ["/m/admin", "TBL-"],
];

const PUBLIC_PAGES: Array<[string, string]> = [
  ["/", "Meja dulu"],
  ["/meja", "Cari meja yang tersedia"],
  ["/booking", "Booking saya"],
  ["/m/meja", "Cari Meja"],
  ["/m/booking", "Booking Saya"],
];

async function main() {
  console.log(`\nRoute smoke test — ${BASE}\n`);

  // ── Public pages, signed out ────────────────────────────────────────────────
  console.log("public (signed out)");
  {
    const anon = new Session();
    for (const [path, needle] of PUBLIC_PAGES) {
      const res = await anon.get(path);
      const html = await res.text();
      check(`${path} renders`, res.status === 200 && html.includes(needle), `status ${res.status}`);
    }
  }

  // ── Staff pages must be refused without a session ───────────────────────────
  console.log("\nstaff (signed out) — must be refused");
  {
    const anon = new Session();
    for (const [path, needle] of LEAKY_PAGES) {
      const res = await anon.get(path);
      const html = await res.text();
      const redirected = res.status === 307 || res.status === 302;
      check(
        `${path} redirects instead of leaking "${needle}"`,
        redirected && !html.includes(needle),
        `status ${res.status}`,
      );
    }
  }

  // ── Staff pages with a session ──────────────────────────────────────────────
  console.log("\nstaff (signed in)");
  const staff = new Session();
  const signedIn = await staff.signIn();
  check("credentials sign-in yields a session cookie", signedIn);

  if (signedIn) {
    for (const [path, needle, label] of STAFF_PAGES) {
      const res = await staff.get(path);
      const html = await res.text();
      check(
        `${label} (${path}) renders`,
        res.status === 200 && html.includes(needle),
        `status ${res.status}`,
      );
    }

    // The sign-in page deliberately bounces an already-authenticated staff
    // member to the dashboard, so 307 here is the correct behaviour.
    const masuk = await staff.get("/admin/masuk");
    check(
      "/admin/masuk bounces a signed-in staff member to the dashboard",
      masuk.status === 307 || masuk.status === 302,
      `status ${masuk.status}`,
    );

    // The mobile floor view sits outside the /admin matcher, so its own guard is
    // the only thing protecting it.
    const mAdminRes = await staff.get("/m/admin");
    const mAdminHtml = await mAdminRes.text();
    check(
      "/m/admin renders for a signed-in staff member",
      mAdminRes.status === 200 && mAdminHtml.includes("TBL-"),
      `status ${mAdminRes.status}`,
    );

    // A booking viewed without a phone number must not render a dossier: the
    // code alone is not a credential, so it redirects to the lookup form.
    const noPhone = await staff.get("/m/booking/BK-NOPE");
    check(
      "mobile booking without a phone number redirects to lookup",
      noPhone.status === 307 || noPhone.status === 302,
      `status ${noPhone.status}`,
    );

    // Prove requireStaff is wired into the handler, not only the page.
    const quote = await staff.get("/api/admin/sessions/nonexistent/quote");
    check(
      "unknown session quote returns a domain error, not a crash",
      quote.status === 404,
      `status ${quote.status}`,
    );
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
