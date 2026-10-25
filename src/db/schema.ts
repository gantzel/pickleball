/**
 * Pickleball København — database schema (Drizzle ORM, PostgreSQL).
 *
 * Auth tables (user, session, account, verification, rateLimit) follow the
 * shape Better Auth expects. Everything else is application data.
 */
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  customType,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const rating = (name: string) => numeric(name, { precision: 5, scale: 3, mode: "number" });

// ─── Enums ───────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("role", ["MEMBER", "ADMIN"]);
export const duprProviderEnum = pgEnum("dupr_provider", ["MOCK", "DUPR"]);
export const duprLinkStatusEnum = pgEnum("dupr_link_status", ["ACTIVE", "ERROR", "REVOKED"]);
export const snapshotSourceEnum = pgEnum("snapshot_source", [
  "LINK",
  "SCHEDULED_SYNC",
  "MANUAL_SYNC",
  "WEBHOOK",
  "ADMIN_RETRY",
  "PROVIDER_HISTORY",
]);
export const syncTriggerEnum = pgEnum("sync_trigger", [
  "LINK",
  "SCHEDULED",
  "MANUAL",
  "WEBHOOK",
  "ADMIN_RETRY",
]);
export const syncResultEnum = pgEnum("sync_result", [
  "SUCCESS",
  "NO_CHANGE",
  "FAILED",
  "RATE_LIMITED",
  "REVOKED",
  "NO_RATING",
  "UNAVAILABLE",
]);
export const mockFailModeEnum = pgEnum("mock_fail_mode", [
  "NONE",
  "ERROR",
  "RATE_LIMIT",
  "REVOKED",
  "NO_RATING",
]);
export const sessionStatusEnum = pgEnum("session_status", [
  "DRAFT",
  "PUBLISHED",
  "CANCELLED",
  "COMPLETED",
]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "CONFIRMED",
  "WAITLISTED",
  "OFFERED", // a freed place is held for this member until offer_expires_at
  "CANCELLED",
  "EXPIRED", // offer not accepted in time
]);
export const cancelledByEnum = pgEnum("cancelled_by", ["MEMBER", "ADMIN", "SYSTEM"]);
export const bookingFlagEnum = pgEnum("booking_flag", ["NONE", "RATING_OUT_OF_RANGE"]);
export const attendanceEnum = pgEnum("attendance", ["UNKNOWN", "ATTENDED", "NO_SHOW"]);
export const ratingTypeEnum = pgEnum("rating_type", ["DOUBLES", "SINGLES"]);
export const ratingDropPolicyEnum = pgEnum("rating_drop_policy", [
  "KEEP_AND_FLAG",
  "RELEASE_AND_NOTIFY",
]);

// ─── Auth (Better Auth) ──────────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  // Application fields. `role` is NOT registered with Better Auth, so it can
  // never be supplied at sign-up; it changes only via the admin CLI or an
  // existing admin (audited).
  role: roleEnum("role").notNull().default("MEMBER"),
  avatarKey: text("avatar_key"),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  deletedAt: ts("deleted_at"),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// ─── DUPR integration ────────────────────────────────────────────────────────

export const duprLink = pgTable(
  "dupr_link",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: duprProviderEnum("provider").notNull(),
    externalId: text("external_id").notNull(), // DUPR ID
    displayName: text("display_name"),
    status: duprLinkStatusEnum("status").notNull().default("ACTIVE"),
    linkedAt: ts("linked_at").notNull().defaultNow(),
    doublesRating: rating("doubles_rating"),
    singlesRating: rating("singles_rating"),
    lastSyncAttemptAt: ts("last_sync_attempt_at"),
    lastSuccessfulSyncAt: ts("last_successful_sync_at"),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    nextSyncAfter: ts("next_sync_after"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A DUPR profile can only be linked to one member account.
    uniqueIndex("dupr_link_provider_external_uq").on(t.provider, t.externalId),
    index("dupr_link_sync_idx").on(t.status, t.nextSyncAfter),
  ],
);

export const duprLinkRequest = pgTable("dupr_link_request", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  stateHash: text("state_hash").notNull().unique(),
  provider: duprProviderEnum("provider").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

/** Timestamped, verified rating observations. Only ever written from provider data. */
export const ratingSnapshot = pgTable(
  "rating_snapshot",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: duprProviderEnum("provider").notNull(),
    externalId: text("external_id").notNull(),
    doublesRating: rating("doubles_rating"),
    singlesRating: rating("singles_rating"),
    source: snapshotSourceEnum("source").notNull(),
    observedAt: ts("observed_at").notNull().defaultNow(),
  },
  (t) => [index("rating_snapshot_user_idx").on(t.userId, t.observedAt)],
);

export const duprSyncLog = pgTable(
  "dupr_sync_log",
  {
    id: id(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    linkId: text("link_id").references(() => duprLink.id, { onDelete: "set null" }),
    trigger: syncTriggerEnum("trigger").notNull(),
    result: syncResultEnum("result").notNull(),
    message: text("message"),
    previousDoubles: rating("previous_doubles"),
    newDoubles: rating("new_doubles"),
    previousSingles: rating("previous_singles"),
    newSingles: rating("new_singles"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [
    index("dupr_sync_log_created_idx").on(t.createdAt),
    index("dupr_sync_log_result_idx").on(t.result, t.createdAt),
    index("dupr_sync_log_user_idx").on(t.userId, t.createdAt),
  ],
);

export const processedWebhook = pgTable("processed_webhook", {
  id: text("id").primaryKey(), // provider event id (idempotency)
  receivedAt: ts("received_at").notNull().defaultNow(),
});

/**
 * Development/demo-only stand-in for DUPR's player records. Read only by the
 * mock provider, which refuses to run in production unless DEMO_MODE=true.
 */
export const mockDuprPlayer = pgTable("mock_dupr_player", {
  id: text("id").primaryKey(), // e.g. "MOCK-7Q2K"
  name: text("name").notNull(),
  doublesRating: rating("doubles_rating"),
  singlesRating: rating("singles_rating"),
  failMode: mockFailModeEnum("fail_mode").notNull().default("NONE"),
  updatedAt: updatedAt(),
});

// ─── Training ────────────────────────────────────────────────────────────────

export const trainingLevel = pgTable(
  "training_level",
  {
    id: id(),
    name: text("name").notNull(),
    description: text("description"),
    minRating: rating("min_rating").notNull(),
    maxRating: rating("max_rating"),
    color: text("color").notNull().default("#2f6b4f"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "training_level_range_chk",
      sql`${t.maxRating} IS NULL OR ${t.maxRating} > ${t.minRating}`,
    ),
  ],
);

export const trainingSession = pgTable(
  "training_session",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description"),
    focus: text("focus"),
    levelId: text("level_id").references(() => trainingLevel.id, { onDelete: "set null" }),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    timezone: text("timezone").notNull().default("Europe/Copenhagen"),
    locationName: text("location_name").notNull(),
    address: text("address"),
    mapUrl: text("map_url"),
    minRating: rating("min_rating"),
    maxRating: rating("max_rating"),
    capacity: integer("capacity").notNull(),
    bookingOpensAt: ts("booking_opens_at"),
    bookingClosesAt: ts("booking_closes_at"),
    status: sessionStatusEnum("status").notNull().default("DRAFT"),
    cancelReason: text("cancel_reason"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("training_session_status_start_idx").on(t.status, t.startsAt),
    check("training_session_capacity_chk", sql`${t.capacity} > 0 AND ${t.capacity} <= 500`),
    check("training_session_time_chk", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "training_session_range_chk",
      sql`${t.minRating} IS NULL OR ${t.maxRating} IS NULL OR ${t.maxRating} >= ${t.minRating}`,
    ),
  ],
);

export const booking = pgTable(
  "booking",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => trainingSession.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: bookingStatusEnum("status").notNull(),
    waitlistedAt: ts("waitlisted_at"),
    offeredAt: ts("offered_at"),
    offerExpiresAt: ts("offer_expires_at"),
    confirmedAt: ts("confirmed_at"),
    cancelledAt: ts("cancelled_at"),
    cancelledBy: cancelledByEnum("cancelled_by"),
    flag: bookingFlagEnum("flag").notNull().default("NONE"),
    flaggedAt: ts("flagged_at"),
    attendance: attendanceEnum("attendance").notNull().default("UNKNOWN"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One row per member per session (re-booking reuses it): duplicate
    // bookings are impossible at the database level.
    uniqueIndex("booking_session_user_uq").on(t.sessionId, t.userId),
    index("booking_session_status_idx").on(t.sessionId, t.status, t.waitlistedAt),
    index("booking_user_status_idx").on(t.userId, t.status),
    index("booking_offer_expiry_idx").on(t.status, t.offerExpiresAt),
  ],
);

// ─── Engagement ──────────────────────────────────────────────────────────────

export const userAchievement = pgTable(
  "user_achievement",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    awardedAt: ts("awarded_at").notNull().defaultNow(),
    context: jsonb("context"),
  },
  (t) => [uniqueIndex("user_achievement_uq").on(t.userId, t.code)],
);

export const notification = pgTable(
  "notification",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

// ─── Operations ──────────────────────────────────────────────────────────────

export const auditEvent = pgTable(
  "audit_event",
  {
    id: id(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_event_created_idx").on(t.createdAt),
    index("audit_event_target_idx").on(t.targetType, t.targetId),
  ],
);

/** Singleton row (id = 1) holding admin-configurable policies. */
export const appSettings = pgTable(
  "app_settings",
  {
    id: integer("id").primaryKey().default(1),
    ratingType: ratingTypeEnum("rating_type").notNull().default("DOUBLES"),
    staleAfterDays: integer("stale_after_days").notNull().default(14),
    syncIntervalHours: integer("sync_interval_hours").notNull().default(24),
    offerWindowHours: integer("offer_window_hours").notNull().default(12),
    cancellationCutoffHours: integer("cancellation_cutoff_hours").notNull().default(2),
    ratingDropPolicy: ratingDropPolicyEnum("rating_drop_policy")
      .notNull()
      .default("KEEP_AND_FLAG"),
    updatedAt: updatedAt(),
  },
  (t) => [check("app_settings_singleton_chk", sql`${t.id} = 1`)],
);

export const rateLimitBucket = pgTable("rate_limit_bucket", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: ts("window_start").notNull(),
});

// ─── Relations ───────────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ one, many }) => ({
  duprLink: one(duprLink, { fields: [user.id], references: [duprLink.userId] }),
  bookings: many(booking),
  snapshots: many(ratingSnapshot),
}));

export const duprLinkRelations = relations(duprLink, ({ one }) => ({
  user: one(user, { fields: [duprLink.userId], references: [user.id] }),
}));

export const trainingSessionRelations = relations(trainingSession, ({ one, many }) => ({
  level: one(trainingLevel, { fields: [trainingSession.levelId], references: [trainingLevel.id] }),
  bookings: many(booking),
}));

export const bookingRelations = relations(booking, ({ one }) => ({
  session: one(trainingSession, { fields: [booking.sessionId], references: [trainingSession.id] }),
  user: one(user, { fields: [booking.userId], references: [user.id] }),
}));

export const ratingSnapshotRelations = relations(ratingSnapshot, ({ one }) => ({
  user: one(user, { fields: [ratingSnapshot.userId], references: [user.id] }),
}));

export const trainingLevelRelations = relations(trainingLevel, ({ many }) => ({
  sessions: many(trainingSession),
}));

// ─── Files (STORAGE_DRIVER=db) ───────────────────────────────────────────────

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Profile photos when stored in the database instead of a disk or bucket. */
export const storedFile = pgTable("stored_file", {
  key: text("key").primaryKey(),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
  createdAt: createdAt(),
});

export type User = typeof user.$inferSelect;
export type DuprLink = typeof duprLink.$inferSelect;
export type TrainingSession = typeof trainingSession.$inferSelect;
export type TrainingLevel = typeof trainingLevel.$inferSelect;
export type Booking = typeof booking.$inferSelect;
export type AppSettings = typeof appSettings.$inferSelect;
