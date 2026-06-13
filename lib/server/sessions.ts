import "server-only";

/**
 * Session store — every DB touch for the API routes, service-role only.
 * The bearer secret is generated here, returned exactly once, and stored as
 * a SHA-256 hash; verification is a constant-shape hash compare.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { generatePin, generateUnique } from "@/lib/codes";
import type { WebFrame } from "@/lib/webframe";

export interface SessionRow {
  id: string;
  code: string;
  origin: "desktop" | "web";
  title: string;
  status: "live" | "ended";
  current_frame: WebFrame | null;
  current_seq: number;
  setlist: unknown;
  expires_at: string;
}

const COLS = "id, code, origin, title, status, current_frame, current_seq, setlist, expires_at";

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(opts: {
  origin: "desktop" | "web";
  title?: string;
  churchId?: string | null;
}): Promise<{ id: string; code: string; secret: string }> {
  const supabase = createServiceClient();

  // Lazy janitor — keeps the table tidy without a cron.
  await supabase.rpc("cleanup");

  const { data: live } = await supabase.from("session").select("code").eq("status", "live");
  const taken = new Set((live ?? []).map((r: { code: string }) => r.code));
  const code = generateUnique(generatePin, taken);

  const secret = randomSecret();
  const { data, error } = await supabase
    .from("session")
    .insert({
      code,
      secret_hash: await sha256Hex(secret),
      origin: opts.origin,
      title: opts.title ?? "",
      church_id: opts.churchId ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;

  return { id: data.id as string, code, secret };
}

export async function getByCode(code: string): Promise<SessionRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("session")
    .select(COLS)
    .eq("code", code)
    .eq("status", "live")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return (data as SessionRow | null) ?? null;
}

export async function getById(id: string): Promise<SessionRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("session").select(COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as SessionRow | null) ?? null;
}

/** True when the bearer secret matches the stored hash for the session. */
export async function verifySecret(id: string, secret: string | null): Promise<boolean> {
  if (!secret) return false;
  const supabase = createServiceClient();
  const { data } = await supabase.from("session").select("secret_hash").eq("id", id).maybeSingle();
  if (!data) return false;
  return (data.secret_hash as string) === (await sha256Hex(secret));
}

export type SetFrameResult =
  | { ok: true; seq: number }
  | { ok: false; reason: "not_found" | "closed" | "stale" };

export async function setFrame(
  id: string,
  frame: WebFrame,
  clientSeq: number | null,
): Promise<SetFrameResult> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("set_frame", {
    p_id: id,
    p_frame: frame,
    p_client_seq: clientSeq,
  });
  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("session_not_found")) return { ok: false, reason: "not_found" };
    if (msg.includes("session_closed")) return { ok: false, reason: "closed" };
    if (msg.includes("stale_client_seq")) return { ok: false, reason: "stale" };
    throw error;
  }
  return { ok: true, seq: Number(data) };
}

export async function saveSetlist(id: string, setlist: unknown): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("session").update({ setlist }).eq("id", id);
  if (error) throw error;
}

export async function endSession(id: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("session")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "live");
  if (error) throw error;
}
