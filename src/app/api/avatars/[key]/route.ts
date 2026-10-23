import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/current-user";
import { readAvatar } from "@/server/uploads";

/** Profile photos are only visible to logged-in members. */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const u = await getCurrentUser();
  if (!u) return new NextResponse(null, { status: 401 });
  const { key } = await ctx.params;
  const buf = await readAvatar(key);
  if (!buf) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "image/webp",
      "cache-control": "private, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
