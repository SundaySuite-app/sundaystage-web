import "server-only";

/**
 * Optional Sunday-account context. The suite shares its Supabase auth cookie
 * on `.sundaysuite.app` (set by SundayPlan with NEXT_PUBLIC_COOKIE_DOMAIN), so
 * a signed-in planner who creates a session here gets it tagged with their
 * church — pure provenance, never a gate. Any failure resolves to null.
 */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** Read-only server client over the shared auth cookie, or null if unconfigured. */
async function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: () => {}, // read-only: we never mutate auth state here
    },
  });
}

/** The signed-in user's first church (provenance tag for sessions). */
export async function resolveChurchId(): Promise<string | null> {
  try {
    const supabase = await serverClient();
    if (!supabase) return null;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("church_member")
      .select("church_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    return (data?.church_id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export interface SundayUser {
  userId: string;
  churchIds: string[];
}

/**
 * The signed-in Sunday user + every church they belong to. Used by the library
 * read route to scope songs to the operator's church. Pure cookie read — never
 * a gate; null when not signed in or unconfigured.
 */
export async function resolveSundayUser(): Promise<SundayUser | null> {
  try {
    const supabase = await serverClient();
    if (!supabase) return null;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from("church_member")
      .select("church_id")
      .eq("user_id", user.id);
    const churchIds = (data ?? [])
      .map((r: { church_id: string | null }) => r.church_id)
      .filter((id): id is string => typeof id === "string");
    return { userId: user.id, churchIds };
  } catch {
    return null;
  }
}
