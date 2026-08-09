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
import {
  INITIAL_DISPLAY_STATE,
  applyEnvelope,
  applySnapshot,
  joinBase,
  type DisplayState,
} from "@/lib/merge";
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
  // Recycled-PIN guard, both directions of the rehydrate/join race:
  //  - unvettedCache: session id of a rehydrated entry the join has not vetted
  //    yet (`undefined` = nothing to vet). The first successful join clears it,
  //    so a later join/retry can never discard state earned from broadcasts.
  //  - joinedId: the session the code resolved to, once known. If the join wins
  //    the race, the rehydrate vets itself against this instead.
  const unvettedCache = useRef<string | null | undefined>(undefined);
  const joinedId = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 0. Rehydrate the last slide we saw for this code (survives a reload during
  //    an outage). This is a PAINT HINT only: the entry never carries lifecycle
  //    (always "live" on load) and the join below throws it away unless its
  //    session id matches — a recycled PIN must not resurrect an old service.
  useEffect(() => {
    let cancelled = false;
    unvettedCache.current = undefined;
    joinedId.current = null;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const cached = loadLastState(code, Date.now());
      if (!cached) return;
      if (joinedId.current === null) {
        unvettedCache.current = cached.sessionId; // the join will vet it
      } else if (cached.sessionId !== joinedId.current) {
        return; // join got here first and this entry isn't its — drop it
      }
      setState((s) => applySnapshot(s, cached.state));
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
      // The join is the only place that learns WHICH session this code resolves
      // to right now, so it is the only place that can vet the rehydrated cache.
      const cachedSessionId = unvettedCache.current;
      unvettedCache.current = undefined;
      joinedId.current = body.id;
      setSession({ id: body.id, title: body.title, origin: body.origin });
      setState((s) =>
        applySnapshot(joinBase(s, body.id, cachedSessionId), {
          seq: body.seq,
          frame: body.frame,
          status: body.status,
        }),
      );
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
  //    Stamped with the session id — without it a later service reusing this
  //    PIN would inherit the entry (and its higher seq) and never repaint.
  useEffect(() => {
    const id = session?.id;
    if (id && state.seq > 0) saveLastState(code, id, state, Date.now());
  }, [code, session?.id, state]);

  return { join, session, state, connected };
}
