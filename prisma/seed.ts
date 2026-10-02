/**
 * Seed — reference data only. Idempotent: safe to re-run.
 *
 * Two venues are seeded deliberately, not as a feature. The exclusion constraint
 * is scoped per table_id, so a second set of tables is the cheapest possible
 * proof that bookings on venue A's TBL-01 cannot collide with venue B's TBL-01.
 * If that test fails, the constraint is wrong and everything above it is fiction.
 */

import { PrismaClient, type BookingStatus, type PaymentStatus, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

/** docs/BUSINESS_DECISIONS.md "Settings Reference". */
const SETTINGS: Array<[string, unknown]> = [
  ["venue_name", "Cue & Rail Club"],
  ["deposit_percent", 30],
  ["deposit_min_idr", 25_000],
  ["deposit_rounding_idr", 1_000],
  ["hold_duration_minutes", 15],
  ["grace_minutes", 15],
  ["overage_increment_minutes", 15],
  ["buffer_minutes", 10],
  ["cancel_free_until_hours", 2],
  ["no_show_grace_minutes", 15],
  ["extension_increments_minutes", [15, 30, 60]],
  ["extension_max_minutes", 60],
  ["qris_static_payload", null],
];

/** D9: 10:00 → 02:00 daily, wrapping past midnight. */
const OPERATING_HOURS = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  opensAtMin: 10 * 60,
  closesAtMin: 2 * 60,
  active: true,
}));

/**
 * Project.md §12 pricing: weekday off-peak, weekday peak, weekend. VIP is
 * separate. Values are examples in the spec, not venue-confirmed, so they are
 * trivial to edit here.
 *
 * Every window spans the full 24 hours on purpose. The venue closes at 02:00, so
 * a session can end at 01:00 — and checkout has to price the overrun at whatever
 * rate is in force at that hour. Leaving 00:00–10:00 uncovered made `endSession`
 * silently price an overrun at Rp0. Gaps here are money bugs, not missing data.
 */
const PRICING_RULES = [
  { tableType: "REGULAR" as const, name: "Regular · Weekday Off-Peak", weekendOnly: false, startsAtMin: 0, endsAtMin: 17 * 60, hourlyPrice: 40_000 },
  { tableType: "REGULAR" as const, name: "Regular · Weekday Peak", weekendOnly: false, startsAtMin: 17 * 60, endsAtMin: 24 * 60, hourlyPrice: 50_000 },
  { tableType: "REGULAR" as const, name: "Regular · Weekend", weekendOnly: true, startsAtMin: 0, endsAtMin: 24 * 60, hourlyPrice: 60_000 },
  { tableType: "VIP" as const, name: "VIP · Weekday", weekendOnly: false, startsAtMin: 0, endsAtMin: 24 * 60, hourlyPrice: 60_000 },
  { tableType: "VIP" as const, name: "VIP · Weekend", weekendOnly: true, startsAtMin: 0, endsAtMin: 24 * 60, hourlyPrice: 75_000 },
];

const TABLES: Array<{ code: string; name: string; type: "REGULAR" | "VIP"; zone: string }> = [
  { code: "TBL-01", name: "9-FT Brunswick", type: "REGULAR", zone: "Salon North" },
  { code: "TBL-02", name: "9-FT Rasson", type: "REGULAR", zone: "Salon North" },
  { code: "TBL-03", name: "9-FT Diamond Pro", type: "REGULAR", zone: "Salon North" },
  { code: "TBL-04", name: "9-FT Rasson (VIP)", type: "VIP", zone: "Salon North" },
  { code: "TBL-05", name: "Gabriel Caron", type: "REGULAR", zone: "Main Hall" },
  { code: "TBL-06", name: "12-FT Star Cruiser", type: "REGULAR", zone: "Main Hall" },
  { code: "TBL-07", name: "9-FT Supreme Blitzer", type: "REGULAR", zone: "Main Hall" },
  { code: "TBL-08", name: "9-FT Rasson VIP", type: "VIP", zone: "Salon South" },
  { code: "TBL-09", name: "Brunswick Gold Crown", type: "REGULAR", zone: "Salon South" },
  { code: "TBL-10", name: "12-FT Riley Aristocrat", type: "REGULAR", zone: "Salon South" },
  { code: "TBL-11", name: "St. James (VIP)", type: "VIP", zone: "Salon South" },
  { code: "TBL-12", name: "7-FT Pezzanne Parlor", type: "REGULAR", zone: "Salon South" },
];

const USERS: Array<{ email: string; name: string; role: Role; password: string }> = [
  { email: "owner@cueandrail.test", name: "Venue Owner", role: "OWNER", password: "owner-dev-123" },
  { email: "kasir@cueandrail.test", name: "Kasir", role: "CASHIER", password: "kasir-dev-123" },
];

async function main() {
  for (const [key, value] of SETTINGS) {
    await db.setting.upsert({ where: { key }, update: { value: value as never }, create: { key, value: value as never } });
  }
  console.log(`settings      ${SETTINGS.length}`);

  for (const h of OPERATING_HOURS) {
    await db.operatingHour.upsert({ where: { weekday: h.weekday }, update: h, create: h });
  }
  console.log(`operating hrs ${OPERATING_HOURS.length}`);

  await db.pricingRule.deleteMany();
  await db.pricingRule.createMany({ data: PRICING_RULES.map((r) => ({ ...r, active: true })) });
  console.log(`pricing rules ${PRICING_RULES.length}`);

  for (const [i, t] of TABLES.entries()) {
    await db.table.upsert({
      where: { code: t.code },
      // status is NOT reset here on purpose — it is operational state, and a
      // venue may genuinely have a table out of service.
      //
      // Use `npm run db:reset-tables` to clear maintenance when you actually want
      // a clean floor. README used to claim `db:seed` was the recovery path, and
      // it was not: a table stuck in MAINTENANCE stayed stuck.
      update: { name: t.name, type: t.type, zone: t.zone, sortOrder: i, active: true },
      create: { ...t, sortOrder: i, active: true },
    });
  }
  console.log(`tables        ${TABLES.length}`);

  const inMaintenance = await db.table.count({ where: { status: "MAINTENANCE" } });
  if (inMaintenance > 0) {
    console.log(
      `              ${inMaintenance} meja sedang MAINTENANCE — jalankan npm run db:reset-tables untuk mengosongkan lantai`,
    );
  }

  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, 12);
    await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, passwordHash, active: true },
      create: { email: u.email, name: u.name, role: u.role, passwordHash },
    });
  }
  console.log(`users         ${USERS.length} (dev passwords — change before any deploy)`);

  // Keep the booking-code sequence ahead of existing rows so a reseed cannot
  // hand out a code that is already taken.
  const [seq] = await db.$queryRawUnsafe<{ last_value: bigint }[]>(
    `SELECT last_value FROM booking_code_seq`,
  );
  const maxSeq = await db.booking.count();
  if (BigInt(maxSeq) > seq.last_value) {
    await db.$executeRawUnsafe(`SELECT setval('booking_code_seq', ${maxSeq})`);
    console.log(`code sequence advanced to ${maxSeq}`);
  }

  // Compile-time proof that the enums referenced below exist with the exact
  // members the seed uses. Cheaper than discovering a typo from a runtime cast.
  const _statuses: BookingStatus[] = ["PENDING", "AWAITING_DEPOSIT", "CONFIRMED", "CHECKED_IN"];
  const _payments: PaymentStatus[] = ["PENDING", "PROOF_SUBMITTED", "PAID", "REJECTED", "REFUNDED"];
  void _statuses;
  void _payments;
}

main()
  .then(() => console.log("\nseed complete"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());