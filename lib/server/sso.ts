import "server-only";

/**
 * Optional Sunday-account context. The suite shares its Supabase auth cookie
 * on `.sundaysuite.app` (set by SundayPlan with NEXT_PUBLIC_COOKIE_DOMAIN), so
 * a signed-in planner who creates a session here gets it tagged with their
 * church — pure provenance, never a gate. Any failure resolves to null.
 */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function resolveChurchId(): Promise<string | null> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;

    const store = await cookies();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => store.getAll(),
        setAll: () => {}, // read-only: we never mutate auth state here
      },
    });

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
