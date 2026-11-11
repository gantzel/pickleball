ALTER TABLE "dupr_link" ADD COLUMN "premium" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "training_level" ADD COLUMN "requires_dupr_premium" boolean DEFAULT false NOT NULL;