"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Handler = (event: string, payload: Record<string, unknown>) => void;

/** Subscribe to a Supabase Realtime channel and invoke `onEvent` for every
 * broadcast event. Also reports whether the socket is currently SUBSCRIBED so
 * consumers can switch to fast-polling while disconnected and refetch on every
 * (re)connect. Handlers live in refs — no memoisation needed. */
export function useChannel(
  topic: string | null,
  onEvent: Handler,
  onConnected?: () => void,
): boolean {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  const connectedRef = useRef(onConnected);
  useEffect(() => {
    handlerRef.current = onEvent;
    connectedRef.current = onConnected;
  });

  useEffect(() => {
    if (!topic) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const supabase = createClient();
    const channel = supabase.channel(topic, {
      // private: Realtime authorizes each subscriber against the realtime.messages
      // RLS policy (migration 20260621120000). anon/authenticated may RECEIVE on
      // stage:session:* but cannot .send() forged frames — closing the display
      // hijack where a forged higher-seq broadcast overrode every screen.
      config: { broadcast: { self: false }, private: true },
    });

    channel.on("broadcast", { event: "*" }, (msg) => {
      handlerRef.current(
        (msg.event as string) ?? "",
        (msg.payload as Record<string, unknown>) ?? {},
      );
    });
    channel.subscribe((status) => {
      const up = status === "SUBSCRIBED";
      setConnected(up);
      if (up) connectedRef.current?.();
    });

    return () => {
      setConnected(false);
      supabase.removeChannel(channel);
    };
  }, [topic]);

  return connected;
}
