"use client";

/**
 * The display/follow data loop: rehydrate the last slide from localStorage so a
 * reload DURING a network outage never blanks the screen, join by code,
 * subscribe to broadcast frames, poll as the safety net (15 s healthy /
 * backoff while disconnected), and run EVERYTHING through the same newer-wins
 * reducer so stale can never overwrite fresh. A failed join is only "not_found"
 * on a real 404 — any other failure is "offline" (keep the cached slide, keep
 * retrying).
 *
 * Leader-tab coordination: multiple tabs of the same machine each open their own
 * Supabase connection + poll, multiplying load against the connection cap. So
 * one tab per code is elected LEADER (over BroadcastChannel) and alone holds the
 * subscription + polling; it relays every merged frame to follower tabs, which
 * render the relay identically through the same reducer. Where BroadcastChannel
 * is unavailable every tab is its own leader (today's behaviour). The cheap
 * one-shot join stays per-tab so every tab resolves its own session id and
 * not_found/offline state; only the persistent subscription + recurring poll are
 * deduplicated. This is the display read path only — never the operator write.
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
import { backoffDelay, foldOutcome } from "./backoff";
import { classifyJoinStatus, loadLastState, saveLastState } from "./lastframe";
import { useChannel } from "./useChannel";
import { useLeader } from "./useLeader";
import type { RelayPayload } from "./leader";

interface JoinedSession {
  id: string;
  title: string;
  origin: "desktop" | "web";
}

type JoinStatus = "joining" | "ok" | "not_found" | "offline";

const POLL_HEALTHY_MS = 15_000;

export function useSessionState(code: string) {
  const [join, setJoin] = useState<JoinStatus>("joining");
  const [session, setSession] = useState<JoinedSession | null>(null);
  const [state, setState] = useState<DisplayState>(INITIAL_DISPLAY_STATE);
  // A follower mirrors the leader's socket health (it has no socket of its own).
  const [relayConnected, setRelayConnected] = useState(false);
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
  //    Every tab joins (leader and follower alike): it is a cheap one-shot GET,
  //    not a persistent connection, and each tab needs its own session id.
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
  //     retrying the join so the display self-heals when the network returns —
  //     with exponential backoff so an extended outage stops the 3 s hammer.
  //     A success flips `join` and tears this effect down; while it stays
  //     "offline" every retry is a failure, so the delay grows 3→6→…→60 s.
  useEffect(() => {
    if (join !== "offline") return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        void (async () => {
          if (cancelled) return;
          await attemptJoin();
          if (cancelled) return;
          failures = foldOutcome(failures, false); // still offline ⇒ back off
          schedule();
        })();
      }, backoffDelay(failures));
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [join, attemptJoin]);

  const refetch = useCallback(async (): Promise<boolean> => {
    const id = session?.id;
    if (!id) return false;
    try {
      const res = await fetch(`/api/sessions/${id}/state`);
      if (!res.ok) return false;
      const body = (await res.json()) as {
        seq: number;
        frame: FrameEnvelope["frame"] | null;
        status: "live" | "ended";
      };
      setState((s) => applySnapshot(s, body));
      return true;
    } catch {
      // polling failures are silent — the next tick retries (with backoff)
      return false;
    }
  }, [session?.id]);

  // Leader election. The leader alone subscribes + polls; followers render the
  // frames it relays. getPayload lets the leader catch a newly-seen tab up; both
  // it and onRelay read the latest state through refs so the coordinator is not
  // rebuilt every render.
  const onRelay = useCallback((payload: RelayPayload) => {
    setState((s) => applySnapshot(s, payload.state));
    setRelayConnected(payload.connected);
  }, []);
  const stateRef = useRef(state);
  const socketConnectedRef = useRef(false);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const getPayload = useCallback(
    (): RelayPayload => ({ state: stateRef.current, connected: socketConnectedRef.current }),
    [],
  );
  const { isLeader, relay } = useLeader(session ? code : null, onRelay, getPayload);

  // 2. Broadcast subscription — LEADER ONLY. A null topic (follower, or no
  //    session yet) means useChannel never opens a Supabase connection.
  //    Refetch on every (re)connect to catch frames missed during the drop.
  const socketConnected = useChannel(
    session && isLeader ? channels.session(session.id) : null,
    (event, payload) => {
      if (event === events.frame) {
        setState((s) => applyEnvelope(s, payload as unknown as FrameEnvelope));
      } else if (event === events.session && (payload as { status?: string }).status === "ended") {
        setState((s) => ({ ...s, status: "ended" }));
      }
    },
    () => void refetch(),
  );
  useEffect(() => {
    socketConnectedRef.current = socketConnected;
  }, [socketConnected]);

  // 3. Polling safety net — LEADER ONLY. Healthy (socket up): a flat 15 s net,
  //    unchanged. Disconnected: exponential backoff driven by consecutive poll
  //    FAILURES (3→6→…→60 s), so an unreachable server is not hammered but a
  //    reachable one with a dead socket keeps the fast 3 s cadence. The first
  //    success snaps back to fast; a reconnect resets and restores the 15 s net.
  useEffect(() => {
    if (!session || state.status === "ended" || !isLeader) return;

    if (socketConnected) {
      const interval = setInterval(() => void refetch(), POLL_HEALTHY_MS);
      return () => clearInterval(interval);
    }

    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        void (async () => {
          if (cancelled) return;
          const ok = await refetch();
          if (cancelled) return;
          failures = foldOutcome(failures, ok);
          schedule();
        })();
      }, backoffDelay(failures));
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session, socketConnected, isLeader, refetch, state.status]);

  // 3b. Leader relays every merged frame (and its socket health) to followers,
  //     including the moment it becomes leader — so a freshly promoted tab and
  //     any demoted-to-follower peer both catch up.
  useEffect(() => {
    if (isLeader) relay({ state, connected: socketConnected });
  }, [isLeader, state, socketConnected, relay]);

  // 4. Persist the last real slide so a reload during an outage rehydrates it.
  //    Stamped with the session id — without it a later service reusing this
  //    PIN would inherit the entry (and its higher seq) and never repaint.
  useEffect(() => {
    const id = session?.id;
    if (id && state.seq > 0) saveLastState(code, id, state, Date.now());
  }, [code, session?.id, state]);

  // A follower mirrors the leader's socket health; the leader reports its own.
  const connected = isLeader ? socketConnected : relayConnected;
  return { join, session, state, connected };
}
