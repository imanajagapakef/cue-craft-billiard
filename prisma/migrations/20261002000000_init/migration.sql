-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TableType" AS ENUM ('REGULAR', 'VIP');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'HELD', 'OCCUPIED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'AWAITING_DEPOSIT', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROOF_SUBMITTED', 'PAID', 'REJECTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('QRIS', 'CASH_AT_COUNTER');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('DEPOSIT', 'EXTENSION', 'FINAL');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ExtensionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'CASHIER');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('ONLINE', 'ADMIN', 'WALK_IN');

-- CreateEnum
CREATE TYPE "CancellationParty" AS ENUM ('CUSTOMER', 'VENUE');

-- CreateEnum
CREATE TYPE "NotificationEvent" AS ENUM ('BOOKING_CREATED', 'PAYMENT_PROOF_SUBMITTED', 'PAYMENT_CONFIRMED', 'PAYMENT_REJECTED', 'BOOKING_REMINDER', 'BOOKING_CANCELLED', 'NO_SHOW', 'EXTENSION_CONFIRMED', 'SESSION_ENDING');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('SYSTEM', 'CUSTOMER', 'STAFF');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CASHIER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TableType" NOT NULL DEFAULT 'REGULAR',
    "zone" TEXT,
    "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operating_hours" (
    "id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opens_at_min" INTEGER NOT NULL,
    "closes_at_min" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operating_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "table_type" "TableType" NOT NULL,
    "name" TEXT NOT NULL,
    "weekend_only" BOOLEAN NOT NULL DEFAULT false,
    "starts_at_min" INTEGER NOT NULL,
    "ends_at_min" INTEGER NOT NULL,
    "hourly_price" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "total_price" INTEGER NOT NULL,
    "deposit_amount" INTEGER NOT NULL,
    "remaining_amount" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "source" "BookingSource" NOT NULL DEFAULT 'ONLINE',
    "hold_expires_at" TIMESTAMPTZ(3),
    "checked_in_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "no_show_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_party" "CancellationParty",
    "cancel_reason" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "proof_path" TEXT,
    "proof_uploaded_at" TIMESTAMPTZ(3),
    "verified_by" TEXT,
    "verified_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "refunded_at" TIMESTAMPTZ(3),
    "external_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "extension_id" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_end_at" TIMESTAMPTZ(3) NOT NULL,
    "actual_end_at" TIMESTAMPTZ(3),
    "extended_minutes" INTEGER NOT NULL DEFAULT 0,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extensions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "requested_minutes" INTEGER NOT NULL,
    "approved_minutes" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "status" "ExtensionStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_name" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT,
    "event" "NotificationEvent" NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "recipient" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "template" TEXT,
    "provider_message_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actor_type" "AuditActorType" NOT NULL DEFAULT 'SYSTEM',
    "actor_id" TEXT,
    "actor_name" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tables_code_key" ON "tables"("code");

-- CreateIndex
CREATE INDEX "tables_status_active_idx" ON "tables"("status", "active");

-- CreateIndex
CREATE UNIQUE INDEX "operating_hours_weekday_key" ON "operating_hours"("weekday");

-- CreateIndex
CREATE INDEX "pricing_rules_table_type_active_idx" ON "pricing_rules"("table_type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_idempotency_key_key" ON "bookings"("idempotency_key");

-- CreateIndex
CREATE INDEX "bookings_table_id_start_at_idx" ON "bookings"("table_id", "start_at");

-- CreateIndex
CREATE INDEX "bookings_customer_phone_idx" ON "bookings"("customer_phone");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_extension_id_key" ON "payments"("extension_id");

-- CreateIndex
CREATE INDEX "payments_booking_id_kind_idx" ON "payments"("booking_id", "kind");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "sessions_status_scheduled_end_at_idx" ON "sessions"("status", "scheduled_end_at");

-- CreateIndex
CREATE INDEX "extensions_booking_id_idx" ON "extensions"("booking_id");

-- CreateIndex
CREATE INDEX "notification_logs_status_created_at_idx" ON "notification_logs"("status", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_extension_id_fkey" FOREIGN KEY ("extension_id") REFERENCES "extensions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Double-booking protection — Project.md §64
--
-- btree_gist lets a scalar equality (table_id) share one GiST index with the
-- tstzrange overlap operator (&&). The WHERE clause scopes the constraint to
-- statuses that actually reserve the table, so CANCELLED / EXPIRED / COMPLETED /
-- NO_SHOW rows stop blocking the slot without needing to be deleted.
--
-- Consequence: two concurrent inserts on the same table + window do not both
-- succeed. The loser fails with SQLSTATE 23P01 (exclusion_violation), which the
-- booking route maps to HTTP 409. This holds across separate app instances, which
-- application-level re-validation cannot guarantee.
--
-- tstzrange(start_at, end_at) is half-open [start, end), matching Project.md §63:
-- a booking ending 22:00 and one starting 22:00 do not overlap.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
  ADD CONSTRAINT "no_overlap" EXCLUDE USING gist (
    "table_id" WITH =,
    tstzrange("start_at", "end_at") WITH &&
  )
  WHERE (status IN ('PENDING','AWAITING_DEPOSIT','CONFIRMED','CHECKED_IN'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Booking code generation — Project.md §14
--
-- Codes are short, human-readable, and read aloud to cashiers. The sequence
-- supplies candidates; the UNIQUE index Prisma already created on "code" is the
-- real guarantee, and the booking route retries on conflict.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS "booking_code_seq" START 1;

-- Partial index for the lazy-expiry sweep: only rows that can actually expire.
CREATE INDEX "bookings_awaiting_deposit_hold"
  ON "bookings" ("hold_expires_at")
  WHERE status = 'AWAITING_DEPOSIT' AND "hold_expires_at" IS NOT NULL;

-- Payment verification queue on the cashier dashboard.
CREATE INDEX "payments_pending_verification"
  ON "payments" ("created_at")
  WHERE status IN ('PENDING','PROOF_SUBMITTED');