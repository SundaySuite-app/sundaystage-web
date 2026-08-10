/**
 * Leader-tab coordination for network displays.
 *
 * THE PROBLEM: every open tab/window of the same display machine runs its own
 * copy of the display loop — its own Supabase realtime subscription and its own
 * polling. Three projector browsers + a couple of confidence monitors on one PC
 * multiply persistent Supabase connections and broadcast message fan-out against
 * the Pro 500-connection cap, for identical output.
 *
 * THE FIX: elect ONE leader tab per join code over the native BroadcastChannel
 * (in-browser IPC, never the network). The leader alone holds the Supabase
 * subscription + polling; it relays every merged frame to the other tabs, which
 * render the relayed frame identically. On leader close/crash a follower
 * promotes. Where BroadcastChannel is unavailable (older Safari private mode)
 * every tab is its own leader — exactly today's behaviour.
 *
 * ELECTION: lowest-id-wins over the set of tabs heard from recently. Every tab
 * heartbeats; leadership is `self.id === min(live peer ids)`, recomputed on each
 * beat and each tick. When the leader stops beating (crash) its id ages out of
 * everyone's peer set after `peerTimeoutMs` and the next-smallest promotes; a
 * graceful close sends `bye` for instant handover. A brief double-subscription
 * during handover is acceptable; a permanently leaderless set is not — and
 * because leadership is derived from the same peer-set rule everywhere, the set
 * always converges on exactly one leader (the globally smallest live id).
 *
 * This module is transport- and clock-agnostic (inject `post`/`now`, drive with
 * `tick()`) so the election is unit-testable in the node env with a fake bus.
 */
import type { DisplayState } from "@/lib/merge";

/** What the leader relays to followers: the merged state + its socket health. */
export interface RelayPayload {
  state: DisplayState;
  connected: boolean;
}

/** Messages exchanged over the BroadcastChannel. Kept tiny — local IPC. */
export type LeaderMessage =
  /** Liveness. Every tab beats on each tick. */
  | { t: "beat"; id: string }
  /** Graceful departure (tab close) — lets peers re-elect without waiting out
   *  the timeout. Best-effort: a crash relies on the timeout instead. */
  | { t: "bye"; id: string }
  /** The leader relaying the current frame to followers. */
  | { t: "frame"; id: string; payload: RelayPayload };

export interface CoordinatorOptions {
  /** This tab's id. Must be unique per tab and give a stable total order. */
  selfId: string;
  now: () => number;
  post: (msg: LeaderMessage) => void;
  /** Called when this tab becomes (true) or stops being (false) the leader. */
  onLeadershipChange?: (isLeader: boolean) => void;
  /** Follower side: a relayed frame arrived. */
  onRelay?: (payload: RelayPayload) => void;
  /** Leader side: produce the current payload to catch a newly-seen tab up. */
  onNeedState?: () => RelayPayload | null;
  /** Interval a live peer may miss beats before it is presumed dead. */
  peerTimeoutMs?: number;
}

export const HEARTBEAT_MS = 2_000;
/** 2.5 heartbeats — tolerates one dropped beat before declaring a leader dead. */
export const PEER_TIMEOUT_MS = 5_000;

/** True when the native BroadcastChannel API exists (absent: old Safari PM). */
export function hasBroadcastChannel(): boolean {
  return typeof BroadcastChannel !== "undefined";
}

export class LeaderCoordinator {
  private readonly selfId: string;
  private readonly now: () => number;
  private readonly post: (msg: LeaderMessage) => void;
  private readonly onLeadershipChange?: (isLeader: boolean) => void;
  private readonly onRelay?: (payload: RelayPayload) => void;
  private readonly onNeedState?: () => RelayPayload | null;
  private readonly peerTimeoutMs: number;

  /** id → last time (our clock) we heard a beat from it. Self is always live. */
  private readonly peers = new Map<string, number>();
  private leader = false;
  private leaderIdValue: string | null = null;
  private stopped = false;

  constructor(opts: CoordinatorOptions) {
    this.selfId = opts.selfId;
    this.now = opts.now;
    this.post = opts.post;
    this.onLeadershipChange = opts.onLeadershipChange;
    this.onRelay = opts.onRelay;
    this.onNeedState = opts.onNeedState;
    this.peerTimeoutMs = opts.peerTimeoutMs ?? PEER_TIMEOUT_MS;
  }

  get isLeader(): boolean {
    return this.leader;
  }

  /** The id this tab currently believes leads (its own when it is the leader). */
  get leaderId(): string | null {
    return this.leaderIdValue;
  }

  /** Announce presence and settle the initial election (solo tab → leader). */
  start(): void {
    this.post({ t: "beat", id: this.selfId });
    this.recompute();
  }

  /** Periodic: age out dead peers, beat, and re-settle leadership. */
  tick(): void {
    if (this.stopped) return;
    this.post({ t: "beat", id: this.selfId });
    this.recompute();
  }

  receive(msg: LeaderMessage): void {
    if (this.stopped || msg.id === this.selfId) return;
    switch (msg.t) {
      case "beat": {
        const isNew = !this.peers.has(msg.id);
        this.peers.set(msg.id, this.now());
        this.recompute();
        // A tab we hadn't seen just checked in — if we lead, catch it up now so
        // it paints without waiting for the next frame change.
        if (isNew && this.leader) this.relayCurrent();
        break;
      }
      case "bye": {
        if (this.peers.delete(msg.id)) this.recompute();
        break;
      }
      case "frame": {
        // Only followers adopt relays. (The leader ignores stray frames.)
        if (!this.leader) this.onRelay?.(msg.payload);
        break;
      }
    }
  }

  /** Leader side: broadcast the current payload to followers (no-op if not). */
  relay(payload: RelayPayload): void {
    if (this.stopped || !this.leader) return;
    this.post({ t: "frame", id: this.selfId, payload });
  }

  /** Graceful departure — peers re-elect immediately instead of on timeout. */
  resign(): void {
    if (this.stopped) return;
    this.post({ t: "bye", id: this.selfId });
  }

  stop(): void {
    this.stopped = true;
    this.peers.clear();
  }

  private relayCurrent(): void {
    const payload = this.onNeedState?.();
    if (payload) this.post({ t: "frame", id: this.selfId, payload });
  }

  /** Prune dead peers, then leadership = we hold the smallest live id. */
  private recompute(): void {
    const now = this.now();
    for (const [id, seen] of this.peers) {
      if (id !== this.selfId && now - seen > this.peerTimeoutMs) this.peers.delete(id);
    }
    this.peers.set(this.selfId, now); // self never ages out

    let min = this.selfId;
    for (const id of this.peers.keys()) if (id < min) min = id;
    this.leaderIdValue = min;

    const nextLeader = min === this.selfId;
    if (nextLeader !== this.leader) {
      this.leader = nextLeader;
      this.onLeadershipChange?.(nextLeader);
    }
  }
}
