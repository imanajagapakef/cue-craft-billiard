import Link from "next/link";
import { redirect } from "next/navigation";

import type { ReactNode } from "react";
import { auth, signOut } from "@/auth.ts";

import { Monogram, NavItem } from "@/components/shell.tsx";
import { Meta } from "@/components/ui.tsx";

/**
 * Admin shell.
 *
 * Navigation uses the Trajectory Line rather than a filled pill, per DESIGN.md.
 * Pending-payment count is passed in from the server so the cashier can see
 * there is work waiting without opening the payments page.
 *
 * The session check here is the real guard. middleware only avoids rendering the
 * shell; a matcher mistake must never expose operational data, so this component
 * refuses to render without a session regardless.
 */
export async function AdminShell({
  active,
  pendingPayments,
  children,
}: {
  active: "dashboard" | "meja" | "pembayaran" | "kasir";
  pendingPayments: number;
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/admin/masuk");

  const name = session.user.name;
  const role = session.user.role;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-rule bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-6 px-4 md:px-8">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="flex items-center gap-2">
              <Monogram size={24} />
              <span className="font-mono text-label-md uppercase tracking-[0.06em] text-ink">
                Cue &amp; Rail · Ops
              </span>
            </Link>

            <nav className="hidden items-center gap-6 md:flex" aria-label="Navigasi kasir">
              <NavItem href="/admin" active={active === "dashboard"}>
                Floor
              </NavItem>
              <NavItem href="/admin/meja" active={active === "meja"}>
                Meja
              </NavItem>
              <NavItem href="/admin/pembayaran" active={active === "pembayaran"}>
                Pembayaran
                {pendingPayments > 0 ? (
                  <span className="ml-2 inline-block bg-maint px-1.5 py-px font-mono text-[0.6875rem] font-semibold tabular-nums text-white">
                    {pendingPayments}
                  </span>
                ) : null}
              </NavItem>
              <NavItem href="/admin/kasir" active={active === "kasir"}>
                Kasir
              </NavItem>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <div className="text-body-sm text-ink">{name}</div>
              <Meta>{role}</Meta>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/admin/masuk" });
              }}
            >
              <button
                type="submit"
                className="rounded-core border border-rule-strong px-3 py-1.5 font-mono text-label-sm uppercase tracking-[0.06em] text-ink-secondary transition-colors hover:bg-surface-accent"
              >
                Keluar
              </button>
            </form>
          </div>
        </div>

        {/* Mobile nav — the Trajectory Line still marks the active item. */}
        <nav
          className="flex items-center gap-5 overflow-x-auto border-t border-rule px-4 md:hidden"
          aria-label="Navigasi kasir"
        >
          <NavItem href="/admin" active={active === "dashboard"}>
            Floor
          </NavItem>
          <NavItem href="/admin/meja" active={active === "meja"}>
            Meja
          </NavItem>
          <NavItem href="/admin/pembayaran" active={active === "pembayaran"}>
            Pembayaran{pendingPayments > 0 ? ` (${pendingPayments})` : ""}
          </NavItem>
          <NavItem href="/admin/kasir" active={active === "kasir"}>
            Kasir
          </NavItem>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8 md:py-8">
        {children}
      </main>
    </div>
  );
}
