"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { channels } from "@/lib/realtime";

export interface PresenceViewer {
  viewerId: string;
  role: "display" | "follow" | "operator" | "scene";
}

/**
 * Track who is connected to a session (displays, followers, the operator).
 * Pass `self: null` to observe without tracking. The operator page uses the
 * counts ("2 skjermer / 13 mobiler"); displays track themselves so the
 * operator sees them arrive.
 */
export function usePresence(
  sessionId: string | null,
  self: PresenceViewer | null,
): PresenceViewer[] {
  const [viewers, setViewers] = useState<PresenceViewer[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const supabase = createClient();
    const channel = supabase.channel(`${channels.session(sessionId)}:presence`, {
      config: { presence: { key: self?.viewerId ?? `obs-${Math.random().toString(36).slice(2)}` } },
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
      setViewers(list);
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED" && self) {
        channel.track({ viewerId: self.viewerId, role: self.role });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, self?.viewerId, self?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  return viewers;
}
