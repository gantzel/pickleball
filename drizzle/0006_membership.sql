CREATE TYPE "public"."membership_status" AS ENUM('PENDING', 'ACTIVE', 'ENDED');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "membership_status" "membership_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "paid_through" date;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "membership_updated_at" timestamp with time zone;--> statement-breakpoint
-- Everyone who already has an account when approval is introduced stays able to book.
UPDATE "user" SET "membership_status" = 'ACTIVE', "membership_updated_at" = now() WHERE "deleted_at" IS NULL;
