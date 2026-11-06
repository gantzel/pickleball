ALTER TYPE "public"."dupr_link_status" ADD VALUE 'RESTRICTED';--> statement-breakpoint
ALTER TABLE "dupr_link" ADD COLUMN "access_token_enc" text;--> statement-breakpoint
ALTER TABLE "dupr_link" ADD COLUMN "refresh_token_enc" text;--> statement-breakpoint
ALTER TABLE "dupr_link" ADD COLUMN "access_checked_at" timestamp with time zone;