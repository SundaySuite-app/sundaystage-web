"use client";

/**
 * The display/follow data loop: rehydrate the last slide from localStorage so a
 * reload DURING a network outage never blanks the screen, join by code,
 * subscribe to broadcast frames, poll as the safety net (15 s healthy / 3 s
 * disconnected), and run EVERYTHING through the same newer-wins reducer so stale
 * can never overwrite fresh. A failed join is only "not_found" on a real 404 —
 * any other failure is "offline" (keep the cached slide, keep retrying).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { channels, events } from "@/lib/realtime";
import { INITIAL_DISPLAY_STATE, applyEnvelope, applySnapshot, type DisplayState } from "@/lib/merge";
import type { FrameEnvelope } from "@/lib/webframe";
import { classifyJoinStatus, loadLastState, saveLastState } from "./lastframe";
import { useChannel } from "./useChannel";

export interface JoinedSession {
  id: string;
  title: string;
  origin: "desktop" | "web";
}

export type JoinStatus = "joining" | "ok" | "not_found" | "offline";

const POLL_HEALTHY_MS = 15_000;
const POLL_DISCONNECTED_MS = 3_000;

export function useSessionState(code: string) {
  const [join, setJoin] = useState<JoinStatus>("joining");
  const [session, setSession] = useState<JoinedSession | null>(null);
  const [state, setState] = useState<DisplayState>(INITIAL_DISPLAY_STATE);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 0. Rehydrate the last slide we saw for this code (survives a reload during
  //    an outage). newer-wins means a fresher join/poll later still overrides it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const cached = loadLastState(code, Date.now());
      if (cached) setState((s) => applySnapshot(s, cached));
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // 1. Join: PIN → session + the current frame immediately (late joiner).
  //    404 = genuinely unknown/expired code; anything else = transient offline.
  const attemptJoin = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/by-code/${code}`);
      if (!mounted.current) return;
      if (!res.ok) {
        setJoin(classifyJoinStatus(res.status));
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
      if (!mounted.current) return;
      setSession({ id: body.id, title: body.title, origin: body.origin });
      setState((s) => applySnapshot(s, { seq: body.seq, frame: body.frame, status: body.status }));
      setJoin("ok");
    } catch {
      if (mounted.current) setJoin("offline");
    }
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await attemptJoin();
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptJoin]);

  // 1b. While offline (booted with no network, or lost it before joining), keep
  //     retrying the join so the display self-heals when the network returns.
  useEffect(() => {
    if (join !== "offline") return;
    const retry = setInterval(() => void attemptJoin(), POLL_DISCONNECTED_MS);
    return () => clearInterval(retry);
  }, [join, attemptJoin]);

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

  // 4. Persist the last real slide so a reload during an outage rehydrates it.
  useEffect(() => {
    if (state.seq > 0) saveLastState(code, state, Date.now());
  }, [code, state]);

  return { join, session, state, connected };
}
