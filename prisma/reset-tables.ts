/**
 * Clears maintenance from every table.
 *
 * Run: npm run db:reset-tables
 *
 * Separate from `db:seed` on purpose. Maintenance is operational state — a venue
 * may genuinely have a table out of service — so a seed that silently cleared it
 * would be a data-loss bug. But the recovery path has to exist somewhere, because
 * "the floor looks broken and I don't know why" is a real support question.
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const stuck = await db.table.findMany({
    where: { status: "MAINTENANCE" },
    select: { code: true },
  });

  if (stuck.length === 0) {
    console.log("no tables in maintenance");
    return;
  }

  await db.table.updateMany({
    where: { status: "MAINTENANCE" },
    data: { status: "AVAILABLE" },
  });

  console.log(`cleared maintenance on ${stuck.length} table(s): ${stuck.map((t) => t.code).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
