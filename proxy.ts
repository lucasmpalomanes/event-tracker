import type { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";

// Next 16 renamed `middleware` to `proxy` — same role. The Auth0 SDK
// mounts /auth/login, /auth/logout and /auth/callback here and keeps
// the session cookie rolling on every request.
export async function proxy(request: NextRequest) {
  return await auth0.middleware(request);
}

export const config = {
  matcher: [
    // Run on everything except static assets.
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
