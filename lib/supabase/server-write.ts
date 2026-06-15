import "server-only";

/**
 * Server Supabase client that may WRITE the auth cookie — used by the OAuth
 * callback to exchange a code for a session. (lib/server/sso.ts stays read-only;
 * this is the one place we mutate auth state.) Shared cookie domain so the login
 * spans every *.sundaysuite.app app.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { sharedCookieOptions } from "./cookies";

export async function createWriteClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: sharedCookieOptions(),
      cookies: {
        getAll: () => store.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) store.set(name, value, options);
          } catch {
            // no-op in an RSC render context
          }
        },
      },
    },
  );
}
