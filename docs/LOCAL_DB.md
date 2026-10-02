# Local PostgreSQL — Cue & Rail

The development database is a **local, portable, detached cluster**. No Docker, no
Windows service, no Neon account. Nothing here is required in production — only
`DATABASE_URL` changes at deploy time.

## Where it lives

| | |
| --- | --- |
| Binaries | `C:\pg\cue\pgsql` (from `postgresql-17.10-2-windows-x64-binaries.zip`) |
| Data directory | `C:\pg\cue\pgsql\data` |
| Port | `5432` |
| Timezone | `Asia/Jakarta` (set at startup, not in the data dir) |
| Database | `cue_rail` |
| Credentials | random password, stored in `.env` and `.env.local` only |

This is a **second cluster**. An older PostgreSQL 17 install exists at
`C:\Program Files\PostgreSQL\17` whose `bin\` folder went missing — a partial
uninstall. That one was deliberately left untouched: not repaired, not removed,
not password-reset. Its data directory still holds whatever it held before.

## Start / stop

The cluster must be started detached from any console. Running `postgres.exe` from
a terminal works, but the postmaster is killed when that terminal closes.

```powershell
npm run db:start     # start detached, wait for port 5432
npm run db:stop
npm run db:status
```

There is no Windows service because this account is not an administrator. The
cluster therefore does **not** survive a reboot — run `npm run db:start` after
rebooting.

## Two gotchas that cost real time

**1. `bin` must be on `PATH`.** `pg_ctl` and a bare `postgres.exe` both fail on the
first connection with:

```
server process (PID n) was terminated by exception 0xC0000142
```

`STATUS_DLL_INIT_FAILED`. The postmaster starts fine; every forked backend dies
because it cannot resolve its own DLLs. `scripts/pg.ps1` sets `PATH` before
launching. If you start it by hand, do the same:

```powershell
$env:PATH = "C:\pg\cue\pgsql\bin;C:\pg\cue\pgsql\lib;" + $env:PATH
```

**2. Stale `postmaster.pid`.** After a hard kill, `postgres.exe` refuses to start
until the pid file is removed. `scripts/pg.ps1` clears it automatically.

## Migrations and seed

```powershell
npm run db:migrate    # prisma migrate dev
npm run db:seed       # 12 tables, 5 pricing rules, 7 operating hours, 2 dev users
npm run db:studio     # prisma studio
```

`migrate dev` uses a **shadow database**. It needs `CREATEDB` rights, which the
`postgres` superuser has.

## Verifying the double-booking guard

```powershell
npm run test:constraint
```

Runs `scripts/test-double-booking.ts`, which asserts the `no_overlap` exclusion
constraint actually refuses conflicting reservations — including two genuinely
concurrent inserts racing for the same slot. It uses tagged rows and cleans up
after itself, so it is safe to run repeatedly.

Current result: **11 passed, 0 failed.**

## Dev credentials

Seeded by `prisma/seed.ts`. Development only — change before any deploy.

| Email | Password | Role |
| --- | --- | --- |
| `owner@cueandrail.test` | `owner-dev-123` | OWNER |
| `kasir@cueandrail.test` | `kasir-dev-123` | CASHIER |

## Deploying

Nothing in the app is aware of this cluster. Point `DATABASE_URL` at any hosted
PostgreSQL and run `prisma migrate deploy`. Two requirements travel with the
schema:

1. The `postgres` role needs permission to `CREATE EXTENSION btree_gist` on first
   migrate.
2. Neon, Railway, Supabase, and RDS Postgres all support `btree_gist`; only some
   MySQL-compatible hosts do not, which is why the migration uses it rather than
   application-level overlap checks.

Hold expiry is computed lazily on read (see `docs/TECH_DESIGN.md` §6) precisely
because no host gives a reliable `pg_cron` for free. This applies locally too.
