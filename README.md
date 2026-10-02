# Cue & Rail — Billiard Booking & Table Management

Sistem booking dan operasional meja untuk tempat billiard. Customer melihat meja yang
tersedia dan mengunci dengan DP; kasir melihat seluruh lantai, memverifikasi pembayaran,
check-in, menambah waktu, dan menutup sesi.

Positioningnya bukan "website booking billiard" — ini sistem operasional tempat
billiard. Website hanya salah satu antarmukanya.

| | |
| --- | --- |
| Spec bisnis | [`Project.md`](Project.md) — 82 section, source of truth |
| Keputusan bisnis | [`docs/BUSINESS_DECISIONS.md`](docs/BUSINESS_DECISIONS.md) — 9 keputusan §74 ditutup |
| Arsitektur | [`docs/TECH_DESIGN.md`](docs/TECH_DESIGN.md) |
| Database lokal | [`docs/LOCAL_DB.md`](docs/LOCAL_DB.md) |
| Design system | `KITAB DESIGN_cuecraft billiard design system/cue_rail_system/DESIGN.md` |

---

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 App Router, TypeScript strict, React 19 |
| Database | PostgreSQL + Prisma 6 |
| Auth | Auth.js v5 credentials, bcrypt, role OWNER / CASHIER |
| Styling | Tailwind CSS v4, CSS-first `@theme` |
| Notifikasi | Tabel outbox + `after()`. WhatsApp opsional, default log-only |
| Test | `node:test` + `node:assert`, plus skenario HTTP |

Tidak ada Redis, BullMQ, Docker, atau queue service. Tidak ada yang perlu dijalankan
selain PostgreSQL dan Next.js.

---

## Menjalankan

```powershell
npm install
npm run db:start      # nyalakan cluster PostgreSQL lokal (port 5432)
npm run db:migrate    # prisma migrate dev
npm run db:seed       # 12 meja, 5 aturan harga, jam operasional, 2 user dev
npm run dev           # http://localhost:3000
```

Kalau PostgreSQL belum terpasang di mesin ini, ikuti `docs/LOCAL_DB.md`.

**Kredensial dev** (dari seed, ganti sebelum deploy):

| Email | Password | Role |
| --- | --- | --- |
| `owner@cueandrail.test` | `owner-dev-123` | OWNER |
| `kasir@cueandrail.test` | `kasir-dev-123` | CASHIER |

---

## Verifikasi

```powershell
npm run verify
```

Menjalankan seluruh suite berurutan. Rinciannya:

| Suite | Check | Yang dibuktikan |
| --- | --- | --- |
| `npm test` | 25 | Overlap, buffer, jam operasional lintas tengah malam, batas extension, split harga, DP, overage, settlement |
| `npm run test:constraint` | 11 | Database **menolak** double booking, termasuk dua insert balapan |
| `npm run test:flow` | 43 | Alur penuh §80 di layer service |
| `npm run test:routes` | 14 | Halaman render, dan route staff menolak tamu tanpa session |
| `npm run test:counter` | 24 | Walk-in → extension → checkout lewat HTTP dengan session kasir |

Dua suite terakhir butuh `npm run dev` berjalan.

---

## Cara kerja

### Anti-double-booking ada di database, bukan di aplikasi

Ini properti correctness terpenting, dan tidak bisa dijamin oleh pemeriksaan di
application code:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings
  ADD CONSTRAINT no_overlap EXCLUDE USING gist (
    table_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  )
  WHERE (status IN ('PENDING','AWAITING_DEPOSIT','CONFIRMED','CHECKED_IN'));
```

Dua insert bersamaan untuk meja dan window yang sama tidak bisa dua-duanya berhasil.
Yang kalah gagal dengan SQLSTATE `23P01`, yang dipetakan ke HTTP 409. Berlaku lintas
instance aplikasi.

`tstzrange(start_at, end_at)` bersifat half-open `[start, end)`, jadi booking yang
selesai 22:00 dan yang mulai 22:00 **tidak** bentrok.

### Status meja diturunkan, bukan disimpan

Hanya `MAINTENANCE` yang disimpan, karena itu keputusan operator. `AVAILABLE`,
`HELD`, `RESERVED`, `OCCUPIED` dihitung saat query dari booking dan sesi yang
justifikasinya. Menyimpannya berarti punya sumber kebenaran kedua yang bisa
meleseng — dan meleseng di sini berarti menampilkan meja yang sebenarnya dipesan.

### Hold expiry tanpa cron

Tidak ada `pg_cron`, karena host database gratis tidak menjalankannya andal. Booking
yang hold-nya habis ditandai `EXPIRED` saat datanya dibaca berikutnya —/yang justru
saat jawabannya penting.

### WhatsApp tidak pernah membatalkan apa pun

Row outbox ditulis **di dalam** transaction yang mengubah state, jadi crash setelah
commit tidak bisa menghilangkan notifikasi. Pengiriman terjadi setelah response
terkirim, lewat `after()`. Kegagalan dicatat, tidak dilempar.

### Satu jalur verifikasi pembayaran

Konfirmasi DP, extension, dan pelunasan melewati endpoint yang sama. Transisi
setelahnya ditentukan oleh `payment.kind`, bukan oleh tombol mana yang diklik kasir.
Extension pun begitu: ia membuat tagihan, dan menit baru diberikan setelah tagihan
dibayar.

### Harga tidak pernah di-hardcode

Semua perhitungan uang lewat `src/lib/pricing.ts`, semua nilai kebijakan lewat tabel
`settings`. Owner bisa mengubah DP, hold, buffer, dan grace period tanpa deploy.

---

## Struktur

```
src/
  app/
    page.tsx                    venue home + occupancy live
    meja/                       cari meja & booking
    booking/                    lookup, detail, checkout DP, keyless pass
    admin/
      masuk/                    sign-in staff
                              →  dashboard, meja, kasir, pembayaran, sesi/[id], booking/[code]
    api/                        13 route handler
  components/                   design tokens + komponen UI
  lib/
    availability.ts             overlap, buffer, jam operasional, batas extension
    pricing.ts                  split harga, DP, overage, settlement
    bookings.ts                 seluruh mutasi & query availability
    tableState.ts               derivasi status meja
    notify.ts                   outbox WhatsApp
    audit.ts  settings.ts  sweep.ts  db.ts  api.ts  auth
  middleware.ts                 gerbang /admin

prisma/
  schema.prisma                 11 tabel, 15 enum
  migrations/                   termasuk no_overlap (SQL tulis-tangan)
  seed.ts

tests/domain.test.ts           unit
scripts/                        4 skenario integrasi
docs/                           3 dokumen
```

---

## Yang belum dibangun

Sesuai `Project.md` §70, di luar MVP: membership, loyalty, promo, F&B, POS,
multi-branch, rating, subscription.

Selain itu, disengaja:

| Tidak dibangun | Tambahkan saat |
| --- | --- |
| Transfer refund otomatis | Ada payment gateway (refund saat ini hanya pencatatan) |
| Worker / cron | Hold expiry lazy ternyata cukup |
| Multi-venue | Ada cabang kedua |
| Object storage | Images bukti bayar perlushared hosting |
| Akun customer | Lookup kode + nomor HP tidak lagi cukup |
| Multi-level cascade saat override extension | Venue nyata butuh geser lebih dari satu booking |

---

## Deploy

Tidak ada yang tahu tentang cluster lokal. Arahkan `DATABASE_URL` ke PostgreSQL
ter-hosting dan jalankan `prisma migrate deploy`. Dua syarat ikut travels dengan
schema:

1. Role `postgres` perlu izin `CREATE EXTENSION btree_gist` saat migrate pertama.
2. `settings` harus diisi — aplikasi jatuh ke default yang benar, tapi nilainya
   belum venue-specific.

`docs/LOCAL_DB.md` menjelaskan detailnya.
