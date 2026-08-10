import { afterEach, describe, expect, it } from "vitest";
import {
  LeaderCoordinator,
  PEER_TIMEOUT_MS,
  hasBroadcastChannel,
  type LeaderMessage,
  type RelayPayload,
} from "@/lib/client/leader";
import { INITIAL_DISPLAY_STATE, applySnapshot, type DisplayState } from "@/lib/merge";
import type { WebFrame } from "@/lib/webframe";

const frame = (n: number): WebFrame => ({ v: 1, kind: "message", message: `frame ${n}` });
const displayState = (seq: number): DisplayState => ({ seq, frame: frame(seq), status: "live" });

/**
 * Synchronous in-memory stand-in for BroadcastChannel: a posted message is
 * delivered immediately to every OTHER live member — the node test env has no
 * BroadcastChannel, and this mirrors tabs of one display machine talking over
 * local IPC. A shared, mutable `clock` lets tests advance time deterministically.
 */
class FakeBus {
  private readonly members = new Map<string, (m: LeaderMessage) => void>();
  join(id: string, recv: (m: LeaderMessage) => void) {
    this.members.set(id, recv);
  }
  /** Model a crash: the tab stops sending AND receiving. */
  kill(id: string) {
    this.members.delete(id);
  }
  post(from: string, msg: LeaderMessage) {
    for (const [id, recv] of this.members) if (id !== from) recv(msg);
  }
}

interface Tab {
  id: string;
  coord: LeaderCoordinator;
  relayed: RelayPayload[];
  payload: RelayPayload | null;
}

/** Wire N coordinators to one bus + one clock. Members register BEFORE any
 *  starts, so the first beats reach everyone (as real tabs already listening). */
function cluster(ids: string[], clock: { now: number }): { bus: FakeBus; tabs: Tab[] } {
  const bus = new FakeBus();
  const tabs: Tab[] = ids.map((id) => {
    const tab: Tab = { id, coord: null as unknown as LeaderCoordinator, relayed: [], payload: null };
    tab.coord = new LeaderCoordinator({
      selfId: id,
      now: () => clock.now,
      post: (m) => bus.post(id, m),
      onRelay: (p) => tab.relayed.push(p),
      onNeedState: () => tab.payload,
    });
    bus.join(id, (m) => tab.coord.receive(m));
    return tab;
  });
  return { bus, tabs };
}

const leaders = (tabs: Tab[]) => tabs.filter((t) => t.coord.isLeader).map((t) => t.id);

afterEach(() => {
  // Undo any BroadcastChannel-global tampering from the fallback test.
  if ((globalThis as { __bcSaved?: boolean }).__bcSaved) {
    const saved = (globalThis as { __bcOrig?: unknown }).__bcOrig;
    if (saved === undefined) delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    else (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = saved;
    delete (globalThis as { __bcSaved?: boolean }).__bcSaved;
  }
});

describe("election — one leader among N", () => {
  it("converges on the smallest id regardless of start order", () => {
    const clock = { now: 1_000 };
    // Created out of order; "a" is the smallest id and must win.
    const { tabs } = cluster(["c", "a", "b"], clock);
    for (const t of tabs) t.coord.start();
    // A couple of steady-state rounds.
    for (let r = 0; r < 3; r++) {
      clock.now += 100;
      for (const t of tabs) t.coord.tick();
    }
    expect(leaders(tabs)).toEqual(["a"]);
    expect(tabs.map((t) => t.coord.leaderId)).toEqual(["a", "a", "a"]);
  });

  it("a lone tab leads immediately (solo = never leaderless)", () => {
    const clock = { now: 0 };
    const { tabs } = cluster(["solo"], clock);
    tabs[0].coord.start();
    expect(tabs[0].coord.isLeader).toBe(true);
  });
});

describe("follower renders a relayed frame", () => {
  it("adopts the leader's relayed frame identically through the merge reducer", () => {
    const clock = { now: 1_000 };
    const { tabs } = cluster(["a", "b"], clock);
    const [a, b] = tabs;
    a.coord.start();
    b.coord.start();
    expect(a.coord.isLeader).toBe(true);
    expect(b.coord.isLeader).toBe(false);

    a.coord.relay({ state: displayState(7), connected: true });

    const last = b.relayed.at(-1)!;
    expect(last.connected).toBe(true);
    // A follower renders the relay exactly as a poll/broadcast would: same rule.
    const rendered = applySnapshot(INITIAL_DISPLAY_STATE, last.state);
    expect(rendered.seq).toBe(7);
    expect(rendered.frame?.message).toBe("frame 7");
  });

  it("a newly-seen follower is caught up by the leader without asking", () => {
    const clock = { now: 1_000 };
    const bus = new FakeBus();
    // Leader "a" is already live and holding frame 42.
    const a: Tab = { id: "a", coord: null as unknown as LeaderCoordinator, relayed: [], payload: null };
    a.coord = new LeaderCoordinator({
      selfId: "a",
      now: () => clock.now,
      post: (m) => bus.post("a", m),
      onRelay: (p) => a.relayed.push(p),
      onNeedState: () => a.payload,
    });
    bus.join("a", (m) => a.coord.receive(m));
    a.payload = { state: displayState(42), connected: true };
    a.coord.start();
    expect(a.coord.isLeader).toBe(true);

    // Follower "b" joins later — its first beat should draw a catch-up relay.
    const b: Tab = { id: "b", coord: null as unknown as LeaderCoordinator, relayed: [], payload: null };
    b.coord = new LeaderCoordinator({
      selfId: "b",
      now: () => clock.now,
      post: (m) => bus.post("b", m),
      onRelay: (p) => b.relayed.push(p),
      onNeedState: () => b.payload,
    });
    bus.join("b", (m) => b.coord.receive(m));
    b.coord.start();
    // The catch-up relay fired the moment "a" saw "b"'s first beat.
    expect(b.relayed.at(-1)?.state.seq).toBe(42);

    // "b" briefly self-promotes (it hasn't heard "a"'s beat yet); one heartbeat
    // round later it learns "a" leads and demotes — the acceptable brief window.
    clock.now += 100;
    a.coord.tick();
    b.coord.tick();
    expect(b.coord.isLeader).toBe(false);
    expect(b.coord.leaderId).toBe("a");
  });
});

describe("leader death promotes a follower", () => {
  it("crash: the leader ages out and the next-smallest promotes", () => {
    const clock = { now: 1_000 };
    const { bus, tabs } = cluster(["a", "b", "c"], clock);
    for (const t of tabs) t.coord.start();
    for (let r = 0; r < 2; r++) {
      clock.now += 100;
      for (const t of tabs) t.coord.tick();
    }
    expect(leaders(tabs)).toEqual(["a"]); // a leads

    // "a" crashes: no bye, no more beats, no more receiving.
    bus.kill("a");
    clock.now += PEER_TIMEOUT_MS + 1; // a's last beat ages past the timeout

    const [, b, c] = tabs;
    for (let r = 0; r < 2; r++) {
      clock.now += 100;
      b.coord.tick();
      c.coord.tick();
    }

    expect(b.coord.isLeader).toBe(true); // next-smallest promoted
    expect(c.coord.isLeader).toBe(false);
    expect(b.coord.leaderId).toBe("b");
  });

  it("graceful bye promotes at once — no timeout wait", () => {
    const clock = { now: 1_000 };
    const { bus, tabs } = cluster(["a", "b"], clock);
    const [a, b] = tabs;
    a.coord.start();
    b.coord.start();
    expect(a.coord.isLeader).toBe(true);
    expect(b.coord.isLeader).toBe(false);

    a.coord.resign(); // posts bye
    bus.kill("a");

    // No clock advance: b promoted the instant it saw the bye.
    expect(b.coord.isLeader).toBe(true);
    expect(b.coord.leaderId).toBe("b");
  });
});

describe("no-BroadcastChannel fallback", () => {
  it("hasBroadcastChannel reflects the platform capability", () => {
    (globalThis as { __bcSaved?: boolean }).__bcSaved = true;
    (globalThis as { __bcOrig?: unknown }).__bcOrig = (
      globalThis as { BroadcastChannel?: unknown }
    ).BroadcastChannel;

    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    expect(hasBroadcastChannel()).toBe(false); // old Safari private mode

    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = function () {} as unknown;
    expect(hasBroadcastChannel()).toBe(true);
  });

  it("degrades to every-tab-its-own-leader (each acts solo, never leaderless)", () => {
    // With no shared bus, coordinators never hear each other — exactly the
    // fallback the hook takes when BroadcastChannel is absent. Each leads itself.
    const clock = { now: 0 };
    const solo = ["x", "y", "z"].map(
      (id) =>
        new LeaderCoordinator({
          selfId: id,
          now: () => clock.now,
          post: () => {}, // no transport
          onNeedState: () => null,
        }),
    );
    for (const c of solo) c.start();
    expect(solo.every((c) => c.isLeader)).toBe(true);
  });
});
