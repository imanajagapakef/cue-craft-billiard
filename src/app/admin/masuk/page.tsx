import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth.ts";

import { Monogram } from "@/components/shell.tsx";
import { Button, ErrorNote, Field, Input, Meta, Panel } from "@/components/ui.tsx";

export const metadata: Metadata = {
  title: "Masuk Kasir — Cue & Rail",
};

/**
 * Staff sign-in — Auth.js credentials.
 *
 * Customers never land here; they have no account. `middleware.ts` guards every
 * /admin route, so reaching this page already means you are not signed in.
 */
export default async function MasukPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await props.searchParams;
  if (await auth()) redirect("/admin");

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-2">
          <Monogram size={24} />
          <span className="text-headline-sm font-semibold uppercase tracking-tight text-ink">
            Cue &amp; Rail
          </span>
        </div>

        <Panel>
          <div className="border-b border-rule px-4 py-3">
            <Meta>Staff Access</Meta>
            <h1 className="mt-1 text-headline-sm font-semibold tracking-tight text-ink">
              Masuk kasir
            </h1>
          </div>

          <form
            action={async (formData) => {
              "use server";
              await signIn("credentials", {
                email: String(formData.get("email") ?? ""),
                password: String(formData.get("password") ?? ""),
                redirectTo: "/admin",
              });
            }}
            className="space-y-4 px-4 py-4"
          >
            {error ? <ErrorNote>Email atau password salah.</ErrorNote> : null}

            <Field label="Email">
              <Input name="email" type="email" required autoComplete="username" />
            </Field>

            <Field label="Password">
              <Input name="password" type="password" required autoComplete="current-password" />
            </Field>

            <Button type="submit" className="w-full">
              Masuk
            </Button>
          </form>
        </Panel>

        <p className="mt-4 text-body-sm text-ink-muted">
          <Link href="/" className="underline">
            Kembali ke halaman customer
          </Link>
        </p>
      </div>
    </main>
  );
}
