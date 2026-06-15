"use client";

import { createBrowserClient } from "@supabase/ssr";
import { sharedCookieOptions } from "./cookies";

/** Browser Supabase client (anon key). Realtime broadcast + presence, and the
 * OPTIONAL Sunday sign-in on /library. Authoritative reads/writes still go
 * through the server API routes (RLS denies anon direct table access). The
 * shared cookie domain (when set) makes the login span every *.sundaysuite.app. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: sharedCookieOptions() },
  );
}
