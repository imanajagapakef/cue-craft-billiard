-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "booking_id" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_booking_id_created_at_idx" ON "audit_logs"("booking_id", "created_at");
