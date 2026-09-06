"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { channels } from "@/lib/realtime";
import { newViewerId } from "@/lib/viewerId";
import { HEARTBEAT_MS, hasBroadcastChannel, newTabId } from "./leader";
import {
  PresenceController,
  presenceChannelName,
  type PresenceLink,
  type PresenceMessage,
  type PresenceViewer,
} from "./presence";

export type { PresenceViewer };

/**
 * Track who is connected to a session (displays, followers, the operator).
 * Pass `self: null` to observe without tracking. The operator page uses the
 * counts ("2 skjermer / 13 mobiler"); displays track themselves so the
 * operator sees them arrive.
 *
 * ONE CONNECTION PER (SESSION, ROLE) GROUP, NOT PER TAB: tabs of the same
 * browser elect a leader over BroadcastChannel (lib/client/presence.ts, the
 * same election the display loop uses); the leader alone holds the Supabase
 * presence connection and relays its roster to the others. Where
 * BroadcastChannel is unavailable every tab is its own leader with its own
 * connection — the behaviour before the election existed.
 */
export function usePresence(
  sessionId: string | null,
  self: PresenceViewer | null,
): PresenceViewer[] {
  const [viewers, setViewers] = useState<PresenceViewer[]>([]);
  // Read off the object so the effect depends on the two values it uses, not on
  // a fresh object identity every render.
  const selfViewerId = self?.viewerId ?? null;
  const selfRole = self?.role ?? null;

  useEffect(() => {
    if (!sessionId) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    // The real presence connection, unchanged by the election — what changed is
    // only WHICH tab calls this.
    const connect = (onRoster: (list: PresenceViewer[]) => void): PresenceLink => {
      const supabase = createClient();
      const channel = supabase.channel(`${channels.session(sessionId)}:presence`, {
        config: { presence: { key: selfViewerId ?? newViewerId("obs") } },
      });

      channel.on("presence", { event: "sync" }, () => {
        const st = channel.presenceState<PresenceViewer>();
        const list: PresenceViewer[] = [];
        for (const key of Object.keys(st)) {
          const meta = st[key][0];
          if (meta && meta.viewerId) {
            list.push({ viewerId: meta.viewerId, role: meta.role ?? "display" });
          }
        }
        onRoster(list);
      });

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED" && selfViewerId && selfRole) {
          channel.track({ viewerId: selfViewerId, role: selfRole });
        }
      });

      return {
        close: () => {
          supabase.removeChannel(channel);
        },
      };
    };

    // No BroadcastChannel (old Safari private mode) → this tab holds its own
    // connection, exactly as every tab did before the election.
    if (!hasBroadcastChannel()) {
      const solo = connect(setViewers);
      return () => solo.close();
    }

    const bc = new BroadcastChannel(presenceChannelName(sessionId, selfRole ?? "obs"));
    const controller = new PresenceController({
      selfId: newTabId(),
      now: () => Date.now(),
      post: (msg) => bc.postMessage(msg),
      connect,
      onRoster: setViewers,
    });

    bc.onmessage = (e: MessageEvent) => controller.receive(e.data as PresenceMessage);
    controller.start();
    const beat = setInterval(() => controller.tick(), HEARTBEAT_MS);

    // Best-effort graceful handover on close so a follower promotes at once and
    // reopens the connection (pagehide fires on tab close and bfcache; a crash
    // relies on the peer timeout instead).
    const bye = () => controller.resign();
    window.addEventListener("pagehide", bye);

    return () => {
      window.removeEventListener("pagehide", bye);
      clearInterval(beat);
      controller.resign();
      controller.stop();
      bc.close();
    };
  }, [sessionId, selfViewerId, selfRole]);

  return viewers;
}
