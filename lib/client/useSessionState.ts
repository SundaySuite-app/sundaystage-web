"use client";

/**
 * The display/follow data loop: join by code, subscribe to broadcast frames,
 * poll as the safety net (15 s healthy / 3 s disconnected), and run EVERYTHING
 * through the same newer-wins reducer so stale can never overwrite fresh.
 */
import { useCallback, useEffect, useState } from "react";
import { channels, events } from "@/lib/realtime";
import { INITIAL_DISPLAY_STATE, applyEnvelope, applySnapshot, type DisplayState } from "@/lib/merge";
import type { FrameEnvelope } from "@/lib/webframe";
import { useChannel } from "./useChannel";

export interface JoinedSession {
  id: string;
  title: string;
  origin: "desktop" | "web";
}

export type JoinStatus = "joining" | "ok" | "not_found";

const POLL_HEALTHY_MS = 15_000;
const POLL_DISCONNECTED_MS = 3_000;

export function useSessionState(code: string) {
  const [join, setJoin] = useState<JoinStatus>("joining");
  const [session, setSession] = useState<JoinedSession | null>(null);
  const [state, setState] = useState<DisplayState>(INITIAL_DISPLAY_STATE);

  // 1. Join: PIN → session + the current frame immediately (late joiner).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sessions/by-code/${code}`);
        if (cancelled) return;
        if (!res.ok) {
          setJoin("not_found");
          return;
        }
        const body = (await res.json()) as {
          id: string;
          title: string;
          origin: "desktop" | "web";
          status: "live" | "ended";
          seq: number;
          frame: FrameEnvelope["frame"] | null;
        };
        setSession({ id: body.id, title: body.title, origin: body.origin });
        setState((s) => applySnapshot(s, { seq: body.seq, frame: body.frame, status: body.status }));
        setJoin("ok");
      } catch {
        if (!cancelled) setJoin("not_found");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const refetch = useCallback(async () => {
    const id = session?.id;
    if (!id) return;
    try {
      const res = await fetch(`/api/sessions/${id}/state`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        seq: number;
        frame: FrameEnvelope["frame"] | null;
        status: "live" | "ended";
      };
      setState((s) => applySnapshot(s, body));
    } catch {
      // polling failures are silent — the next tick retries
    }
  }, [session?.id]);

  // 2. Broadcast subscription; refetch on every (re)connect to catch misses.
  const connected = useChannel(
    session ? channels.session(session.id) : null,
    (event, payload) => {
      if (event === events.frame) {
        setState((s) => applyEnvelope(s, payload as unknown as FrameEnvelope));
      } else if (event === events.session && (payload as { status?: string }).status === "ended") {
        setState((s) => ({ ...s, status: "ended" }));
      }
    },
    () => void refetch(),
  );

  // 3. Polling safety net, cadence by connection health.
  useEffect(() => {
    if (!session || state.status === "ended") return;
    const interval = setInterval(
      () => void refetch(),
      connected ? POLL_HEALTHY_MS : POLL_DISCONNECTED_MS,
    );
    return () => clearInterval(interval);
  }, [session, connected, refetch, state.status]);

  return { join, session, state, connected };
}
