CREATE TYPE "public"."program_kind" AS ENUM('LEVEL', 'JUNIOR', 'SOCIAL', 'EVENT');--> statement-breakpoint
CREATE TABLE "level_member" (
	"level_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_level" DROP CONSTRAINT "training_level_range_chk";--> statement-breakpoint
ALTER TABLE "training_level" ALTER COLUMN "min_rating" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "training_level" ADD COLUMN "kind" "program_kind" DEFAULT 'LEVEL' NOT NULL;--> statement-breakpoint
ALTER TABLE "training_level" ADD COLUMN "allow_unrated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "level_member" ADD CONSTRAINT "level_member_level_id_training_level_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."training_level"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_member" ADD CONSTRAINT "level_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_member" ADD CONSTRAINT "level_member_added_by_id_user_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "level_member_uq" ON "level_member" USING btree ("level_id","user_id");--> statement-breakpoint
CREATE INDEX "level_member_user_idx" ON "level_member" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "training_level" ADD CONSTRAINT "training_level_rating_kind_chk" CHECK ("training_level"."kind" = 'LEVEL' OR ("training_level"."min_rating" IS NULL AND "training_level"."max_rating" IS NULL));--> statement-breakpoint
ALTER TABLE "training_level" ADD CONSTRAINT "training_level_band_chk" CHECK ("training_level"."kind" <> 'LEVEL' OR "training_level"."min_rating" IS NOT NULL OR "training_level"."max_rating" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "training_level" ADD CONSTRAINT "training_level_range_chk" CHECK ("training_level"."max_rating" IS NULL OR "training_level"."min_rating" IS NULL OR "training_level"."max_rating" > "training_level"."min_rating");