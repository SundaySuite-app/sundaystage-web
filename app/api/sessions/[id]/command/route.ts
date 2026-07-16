/**
 * POST /api/sessions/<id>/command — remote control (web operator → desktop).
 * Body: { cmd: "next"|"prev"|"black"|"logo"|"clear", cmd_seq: number }
 * Bearer-authed with the SAME session secret (the operator page holds it).
 * Pure broadcast — the desktop webview subscribes to the commands channel,
 * verifies the HMAC signature (the channel itself is reachable with the anon
 * key, so broadcasts are only trusted when signed with the session secret)
 * and validates cmd_seq monotonicity before acting (replay/stale rejection).
 */
import { ok, fail, readJson, bearer, rateLimit } from "@/lib/server/http";
import { verifySecret, getById } from "@/lib/server/sessions";
import { broadcast } from "@/lib/server/broadcast";
import { signCommand } from "@/lib/commandSig";
import {
  channels,
  events,
  REMOTE_COMMANDS,
  type CommandPayload,
  type RemoteCommand,
} from "@/lib/realtime";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  // Generous per-session cap (fast remote advancing is ~2-3/s) — this only
  // stops a runaway/hostile client from flooding the broadcast channel.
  if (!rateLimit(`cmd:${id}`, 300, 60_000)) return fail(429, "rate_limited");
  const secret = bearer(req);
  if (!(await verifySecret(id, secret))) return fail(401, "unauthorized");

  const session = await getById(id);
  if (!session) return fail(404, "not_found");
  if (session.status !== "live") return fail(410, "session_closed");

  const body = await readJson<{ cmd?: unknown; cmd_seq?: unknown }>(req);
  const cmd = body?.cmd as RemoteCommand;
  if (!REMOTE_COMMANDS.includes(cmd)) return fail(400, "invalid_command");
  if (typeof body?.cmd_seq !== "number" || !Number.isFinite(body.cmd_seq) || body.cmd_seq < 0) {
    return fail(400, "invalid_cmd_seq");
  }
  const cmdSeq = Math.trunc(body.cmd_seq);

  // verifySecret passed, so the bearer is the session secret — sign with it.
  // The desktop recomputes this HMAC before dispatching; unsigned or forged
  // broadcasts on the channel are dropped (application-layer defence).
  const sig = await signCommand(secret as string, id, cmd, cmdSeq);
  const payload = { cmd, cmd_seq: cmdSeq, sig } satisfies CommandPayload;
  // Transport-layer defence on top: the commands channel is PRIVATE (RLS-gated),
  // so forged anon `.send()`s are rejected before they reach subscribers. New
  // desktop builds subscribe on the private topic; older builds in the field
  // listen on the public topic — DUAL-SEND during the fleet-upgrade window.
  // The public leg stays safe meanwhile: old desktops verify the HMAC. Drop
  // `alsoPublic` once the fleet is upgraded (see PR DEPLOY-NOTE).
  await broadcast(channels.commands(id), events.command, { ...payload }, {
    private: true,
    alsoPublic: true,
  });
  return ok({ sent: true });
}
