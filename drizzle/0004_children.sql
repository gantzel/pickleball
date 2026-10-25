CREATE TABLE "child" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text NOT NULL,
	"name" text NOT NULL,
	"birth_year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "booking_session_user_uq";--> statement-breakpoint
DROP INDEX "level_member_uq";--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "child_id" text;--> statement-breakpoint
ALTER TABLE "level_member" ADD COLUMN "child_id" text;--> statement-breakpoint
ALTER TABLE "child" ADD CONSTRAINT "child_parent_id_user_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "child_parent_idx" ON "child" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_child_id_child_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."child"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_member" ADD CONSTRAINT "level_member_child_id_child_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."child"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_session_participant_uq" UNIQUE NULLS NOT DISTINCT("session_id","user_id","child_id");--> statement-breakpoint
ALTER TABLE "level_member" ADD CONSTRAINT "level_member_uq" UNIQUE NULLS NOT DISTINCT("level_id","user_id","child_id");