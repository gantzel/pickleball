CREATE TYPE "public"."attendance" AS ENUM('UNKNOWN', 'ATTENDED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."booking_flag" AS ENUM('NONE', 'RATING_OUT_OF_RANGE');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('CONFIRMED', 'WAITLISTED', 'OFFERED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."cancelled_by" AS ENUM('MEMBER', 'ADMIN', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."dupr_link_status" AS ENUM('ACTIVE', 'ERROR', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."dupr_provider" AS ENUM('MOCK', 'DUPR');--> statement-breakpoint
CREATE TYPE "public"."mock_fail_mode" AS ENUM('NONE', 'ERROR', 'RATE_LIMIT', 'REVOKED', 'NO_RATING');--> statement-breakpoint
CREATE TYPE "public"."rating_drop_policy" AS ENUM('KEEP_AND_FLAG', 'RELEASE_AND_NOTIFY');--> statement-breakpoint
CREATE TYPE "public"."rating_type" AS ENUM('DOUBLES', 'SINGLES');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('MEMBER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."snapshot_source" AS ENUM('LINK', 'SCHEDULED_SYNC', 'MANUAL_SYNC', 'WEBHOOK', 'ADMIN_RETRY', 'PROVIDER_HISTORY');--> statement-breakpoint
CREATE TYPE "public"."sync_result" AS ENUM('SUCCESS', 'NO_CHANGE', 'FAILED', 'RATE_LIMITED', 'REVOKED', 'NO_RATING', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('LINK', 'SCHEDULED', 'MANUAL', 'WEBHOOK', 'ADMIN_RETRY');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"rating_type" "rating_type" DEFAULT 'DOUBLES' NOT NULL,
	"stale_after_days" integer DEFAULT 14 NOT NULL,
	"sync_interval_hours" integer DEFAULT 24 NOT NULL,
	"offer_window_hours" integer DEFAULT 12 NOT NULL,
	"cancellation_cutoff_hours" integer DEFAULT 2 NOT NULL,
	"rating_drop_policy" "rating_drop_policy" DEFAULT 'KEEP_AND_FLAG' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_singleton_chk" CHECK ("app_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "booking_status" NOT NULL,
	"waitlisted_at" timestamp with time zone,
	"offered_at" timestamp with time zone,
	"offer_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" "cancelled_by",
	"flag" "booking_flag" DEFAULT 'NONE' NOT NULL,
	"flagged_at" timestamp with time zone,
	"attendance" "attendance" DEFAULT 'UNKNOWN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dupr_link" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" "dupr_provider" NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text,
	"status" "dupr_link_status" DEFAULT 'ACTIVE' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"doubles_rating" numeric(5, 3),
	"singles_rating" numeric(5, 3),
	"last_sync_attempt_at" timestamp with time zone,
	"last_successful_sync_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"next_sync_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dupr_link_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "dupr_link_request" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"provider" "dupr_provider" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dupr_link_request_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "dupr_sync_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"link_id" text,
	"trigger" "sync_trigger" NOT NULL,
	"result" "sync_result" NOT NULL,
	"message" text,
	"previous_doubles" numeric(5, 3),
	"new_doubles" numeric(5, 3),
	"previous_singles" numeric(5, 3),
	"new_singles" numeric(5, 3),
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_dupr_player" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"doubles_rating" numeric(5, 3),
	"singles_rating" numeric(5, 3),
	"fail_mode" "mock_fail_mode" DEFAULT 'NONE' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_bucket" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" "dupr_provider" NOT NULL,
	"external_id" text NOT NULL,
	"doubles_rating" numeric(5, 3),
	"singles_rating" numeric(5, 3),
	"source" "snapshot_source" NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "training_level" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"min_rating" numeric(5, 3) NOT NULL,
	"max_rating" numeric(5, 3),
	"color" text DEFAULT '#2f6b4f' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_level_range_chk" CHECK ("training_level"."max_rating" IS NULL OR "training_level"."max_rating" > "training_level"."min_rating")
);
--> statement-breakpoint
CREATE TABLE "training_session" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"focus" text,
	"level_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'Europe/Copenhagen' NOT NULL,
	"location_name" text NOT NULL,
	"address" text,
	"map_url" text,
	"min_rating" numeric(5, 3),
	"max_rating" numeric(5, 3),
	"capacity" integer NOT NULL,
	"booking_opens_at" timestamp with time zone,
	"booking_closes_at" timestamp with time zone,
	"status" "session_status" DEFAULT 'DRAFT' NOT NULL,
	"cancel_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_session_capacity_chk" CHECK ("training_session"."capacity" > 0 AND "training_session"."capacity" <= 500),
	CONSTRAINT "training_session_time_chk" CHECK ("training_session"."ends_at" > "training_session"."starts_at"),
	CONSTRAINT "training_session_range_chk" CHECK ("training_session"."min_rating" IS NULL OR "training_session"."max_rating" IS NULL OR "training_session"."max_rating" >= "training_session"."min_rating")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" "role" DEFAULT 'MEMBER' NOT NULL,
	"avatar_key" text,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_achievement" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"context" jsonb
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_session_id_training_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking" ADD CONSTRAINT "booking_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dupr_link" ADD CONSTRAINT "dupr_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dupr_link_request" ADD CONSTRAINT "dupr_link_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dupr_sync_log" ADD CONSTRAINT "dupr_sync_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dupr_sync_log" ADD CONSTRAINT "dupr_sync_log_link_id_dupr_link_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."dupr_link"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_snapshot" ADD CONSTRAINT "rating_snapshot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_session" ADD CONSTRAINT "training_session_level_id_training_level_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."training_level"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_session" ADD CONSTRAINT "training_session_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievement" ADD CONSTRAINT "user_achievement_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_event_created_idx" ON "audit_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_event_target_idx" ON "audit_event" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_session_user_uq" ON "booking" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE INDEX "booking_session_status_idx" ON "booking" USING btree ("session_id","status","waitlisted_at");--> statement-breakpoint
CREATE INDEX "booking_user_status_idx" ON "booking" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "booking_offer_expiry_idx" ON "booking" USING btree ("status","offer_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dupr_link_provider_external_uq" ON "dupr_link" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "dupr_link_sync_idx" ON "dupr_link" USING btree ("status","next_sync_after");--> statement-breakpoint
CREATE INDEX "dupr_sync_log_created_idx" ON "dupr_sync_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "dupr_sync_log_result_idx" ON "dupr_sync_log" USING btree ("result","created_at");--> statement-breakpoint
CREATE INDEX "dupr_sync_log_user_idx" ON "dupr_sync_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "rating_snapshot_user_idx" ON "rating_snapshot" USING btree ("user_id","observed_at");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "training_session_status_start_idx" ON "training_session" USING btree ("status","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_achievement_uq" ON "user_achievement" USING btree ("user_id","code");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");