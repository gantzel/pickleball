import "./deploy-defaults";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { sendMail } from "@/server/mailer";
import { demoWithoutMail } from "./deploy-defaults";

/**
 * Better Auth: email/password, database sessions, password reset and
 * built-in rate limiting (stored in Postgres so it works across instances).
 * The `role` column is deliberately NOT exposed to Better Auth, so it can
 * never be set through sign-up or profile-update requests.
 */
export const auth = betterAuth({
  appName: "Pickleball København",
  baseURL: process.env.APP_URL ?? process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      rateLimit: schema.rateLimit,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    // Members must confirm they own the email address before they can log in.
    requireEmailVerification: !demoWithoutMail(),
    maxPasswordLength: 128,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Nulstil din adgangskode — Pickleball København",
        text: `Hej ${user.name}\n\nKlik på linket for at vælge en ny adgangskode. Linket virker i 1 time:\n${url}\n\nHar du ikke bedt om det, kan du se bort fra denne mail.`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true, // re-sends the link if an unverified member tries to log in
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Bekræft din e-mail — Pickleball København",
        text: `Hej ${user.name}\n\nKlik på linket for at bekræfte din e-mail og aktivere din konto. Linket virker i 24 timer:\n${url}\n\nHar du ikke oprettet en konto, kan du se bort fra denne mail.`,
      });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: process.env.NODE_ENV !== "test",
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 3600, max: 10 },
      "/request-password-reset": { window: 900, max: 3 },
      "/reset-password": { window: 900, max: 5 },
      "/send-verification-email": { window: 900, max: 3 },
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [nextCookies()],
});
