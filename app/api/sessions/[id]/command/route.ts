/**
 * POST /api/sessions/<id>/command — remote control (web operator → desktop).
 * Body: { cmd: "next"|"prev"|"black"|"logo"|"clear", cmd_seq: number }
 * Bearer-authed with the SAME session secret (the operator page holds it).
 * Pure broadcast — the desktop webview subscribes to the commands channel and
 * validates cmd_seq monotonicity before acting (replay/stale rejection).
 */
import { ok, fail, readJson, bearer } from "@/lib/server/http";
import { verifySecret, getById } from "@/lib/server/sessions";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events, REMOTE_COMMANDS, type RemoteCommand } from "@/lib/realtime";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  if (!(await verifySecret(id, bearer(req)))) return fail(401, "unauthorized");

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

  await broadcast(channels.commands(id), events.command, { cmd, cmd_seq: cmdSeq });
  return ok({ sent: true });
}
