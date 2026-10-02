import { PrismaClient } from "@prisma/client";

// Next.js dev server hot-reloads modules on every change; without the global
// cache each reload would open a new connection pool and eventually exhaust
// Neon's connection limit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;