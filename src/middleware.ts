import { auth } from "@/auth.ts";
import { NextResponse } from "next/server";

/**
 * Route guard for /admin.
 *
 * This is a convenience layer only, not the authorisation policy: it stops a
 * signed-out user from rendering staff pages. Role checks (OWNER vs CASHIER) live
 * in the handlers via requireStaff/requireOwner, because middleware runs on the
 * edge and must not query the database.
 */
export default async function middleware(req: Request & { nextUrl: URL }) {
  const session = await auth();
  if (session?.user) return NextResponse.next();

  const url = new URL("/admin/masuk", req.url);
  url.searchParams.set("next", new URL(req.url).pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // "/admin" must be listed explicitly: a `:path` segment needs at least one part,
  // so "/admin/:path((?!masuk).*)" alone does NOT match the bare "/admin" — which
  // let the dashboard render for signed-out visitors.
  // "masuk" is excluded because it would otherwise redirect to itself forever.
  matcher: ["/admin", "/admin/:path((?!masuk).*)"],
};
