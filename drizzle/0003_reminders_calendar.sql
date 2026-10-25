ALTER TABLE "booking" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "calendar_token" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_calendar_token_unique" UNIQUE("calendar_token");