import { NextResponse } from "next/server";
import { calendarFeed } from "@/server/calendar";

export const dynamic = "force-dynamic";

/** Personal calendar feed. The secret in the URL is the only credential (calendar apps can't log in). */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const body = await calendarFeed(token.replace(/\.ics$/, ""));
  if (body === null) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="pickleball-traeninger.ics"',
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
    },
  });
}
