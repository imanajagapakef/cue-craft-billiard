import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db.ts";

/**
 * Staff-only authentication. Customers have no account in MVP — they are
 * identified by phone number + booking code, so there is no customer credential
 * path to secure here.
 *
 * JWT sessions, not database sessions: the credentials provider has nothing to
 * look up on the database table, and a JWT avoids a read on every request. The
 * role is baked in at sign-in, which is safe because role changes are rare and
 * take effect on next sign-in.
 */

declare module "next-auth" {
  interface Session {
    user: { id: string; email: string; name: string; role: "OWNER" | "CASHIER" };
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/masuk" },
  providers: [
    Credentials({
      name: "Staff",
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await db.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });
        if (!user || !user.active) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: "OWNER" | "CASHIER" }).role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as "OWNER" | "CASHIER";
      return session;
    },
  },
});

/** Staff session, or null. */
export async function currentStaff() {
  const session = await auth();
  return session?.user ?? null;
}

/**
 * Staff session or throw. Use in route handlers; the thrown error is turned into
 * a 401 by the handler wrapper.
 */
export async function requireStaff(): Promise<{
  id: string;
  email: string;
  name: string;
  role: "OWNER" | "CASHIER";
}> {
  const staff = await currentStaff();
  if (!staff) throw new UnauthorizedError();
  return staff;
}

/** OWNER-only. Pricing, tables, and operating hours are owner territory. */
export async function requireOwner(): Promise<{
  id: string;
  email: string;
  name: string;
  role: "OWNER" | "CASHIER";
}> {
  const staff = await requireStaff();
  if (staff.role !== "OWNER") throw new ForbiddenError();
  return staff;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("Insufficient permissions");
    this.name = "ForbiddenError";
  }
}