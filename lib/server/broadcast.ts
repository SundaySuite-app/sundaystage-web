import "server-only";

// Server-side Supabase Realtime broadcast via the REST endpoint — lets a
// stateless Route Handler push an event to a channel without opening a
// websocket. Clients subscribed to `topic` receive it.
//
// Failures are swallowed (logged): realtime is a hint layer; if a broadcast is
// lost, clients still recover by refetching authoritative state on their next
// action or reconnect.
//
// PRIVATE vs PUBLIC topics: Supabase routes a broadcast to a DIFFERENT pubsub
// topic depending on the message's `private` flag (public → `<tenant>:<topic>`,
// private → `<tenant>-private:<topic>`). A public broadcast only reaches public
// subscribers and a private broadcast only reaches private subscribers — they
// never cross. So the send-side privacy MUST match the subscriber's
// `config.private`. Server sends are authorized by the service_role key, which
// bypasses the realtime.messages RLS, so we can publish to a private topic that
// forged anon clients are denied INSERT on.

export interface BroadcastOptions {
  /** Publish on the RLS-authorized PRIVATE tenant topic. The subscriber must
   *  join the channel with `config.private = true` (frame channel + the new
   *  desktop commands channel). Default false = public. */
  private?: boolean;
  /** Additionally publish a PUBLIC copy of the same message. Transition bridge
   *  ONLY: lets not-yet-upgraded in-field subscribers (older desktop builds
   *  still on the PUBLIC commands channel) keep receiving while the fleet
   *  migrates. Drop this once every consumer is on the private channel. */
  alsoPublic?: boolean;
}

export interface RealtimeMessage {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  private: boolean;
}

/**
 * Pure: build the `realtime.messages` batch for one logical broadcast.
 * A private and a public copy land on DIFFERENT tenant topics, so a private
 * subscriber never sees a public message and vice-versa — hence the explicit
 * dual-send bridge (`alsoPublic`) for backward compatibility.
 */
export function buildBroadcastMessages(
  topic: string,
  event: string,
  payload: Record<string, unknown>,
  opts: BroadcastOptions = {},
): RealtimeMessage[] {
  const messages: RealtimeMessage[] = [];
  if (opts.private) messages.push({ topic, event, payload, private: true });
  if (!opts.private || opts.alsoPublic) {
    messages.push({ topic, event, payload, private: false });
  }
  return messages;
}

export async function broadcast(
  topic: string,
  event: string,
  payload: Record<string, unknown> = {},
  opts: BroadcastOptions = {},
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: buildBroadcastMessages(topic, event, payload, opts),
      }),
    });
    if (!res.ok) {
      console.warn("[broadcast] failed", topic, event, res.status);
    }
  } catch (err) {
    console.warn("[broadcast] error", topic, event, err);
  }
}
