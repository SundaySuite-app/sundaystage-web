"use client";

/**
 * React binding for the leader-tab election (lib/client/leader.ts). Wires the
 * transport-agnostic coordinator to a real BroadcastChannel keyed by join code,
 * the wall clock, and a heartbeat interval, and exposes:
 *
 *   isLeader — this tab holds the Supabase subscription + polling; followers
 *              render frames it relays. Stable `true` when BroadcastChannel is
 *              unavailable (every tab is its own leader = today's behaviour).
 *   relay    — leader calls this to broadcast the current frame to followers.
 *
 * `onRelay` (a follower received a frame) and `getPayload` (the leader's current
 * frame, to catch a newly-seen tab up) are read through refs so the coordinator
 * always sees the latest without being torn down every render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  HEARTBEAT_MS,
  LeaderCoordinator,
  hasBroadcastChannel,
  type LeaderMessage,
  type RelayPayload,
} from "./leader";

function newTabId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fixed-width fallback so ids keep a stable lexicographic total order.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2).padEnd(12, "0")}`;
}

export function useLeader(
  code: string | null,
  onRelay: (payload: RelayPayload) => void,
  getPayload: () => RelayPayload | null,
): { isLeader: boolean; relay: (payload: RelayPayload) => void } {
  // No BroadcastChannel (old Safari private mode) → solo leader from render 1.
  const [isLeader, setIsLeader] = useState<boolean>(() => !hasBroadcastChannel());
  const onRelayRef = useRef(onRelay);
  const getPayloadRef = useRef(getPayload);
  useEffect(() => {
    onRelayRef.current = onRelay;
    getPayloadRef.current = getPayload;
  });

  const coordRef = useRef<LeaderCoordinator | null>(null);

  useEffect(() => {
    if (!code) return;
    // No BroadcastChannel → solo mode. The initial state (!hasBroadcastChannel)
    // already made this tab a leader, so there is nothing to set up: it just
    // subscribes + polls like every tab does today.
    if (!hasBroadcastChannel()) return;

    const bc = new BroadcastChannel(`stage-leader:${code}`);
    const coord = new LeaderCoordinator({
      selfId: newTabId(),
      now: () => Date.now(),
      post: (msg) => bc.postMessage(msg),
      onLeadershipChange: (leader) => setIsLeader(leader),
      onRelay: (payload) => onRelayRef.current(payload),
      onNeedState: () => getPayloadRef.current(),
    });
    coordRef.current = coord;

    bc.onmessage = (e: MessageEvent) => coord.receive(e.data as LeaderMessage);
    coord.start();
    const beat = setInterval(() => coord.tick(), HEARTBEAT_MS);

    // Best-effort graceful handover on close so a follower promotes at once
    // (pagehide fires on tab close and bfcache; a crash relies on the timeout).
    const bye = () => coord.resign();
    window.addEventListener("pagehide", bye);

    return () => {
      window.removeEventListener("pagehide", bye);
      clearInterval(beat);
      coord.resign();
      coord.stop();
      bc.close();
      coordRef.current = null;
      setIsLeader(!hasBroadcastChannel());
    };
  }, [code]);

  const relay = useCallback((payload: RelayPayload) => {
    coordRef.current?.relay(payload);
  }, []);

  return { isLeader, relay };
}
