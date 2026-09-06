import { describe, expect, it } from "vitest";
import { PEER_TIMEOUT_MS } from "@/lib/client/leader";
import {
  PresenceController,
  presenceChannelName,
  type PresenceMessage,
  type PresenceViewer,
} from "@/lib/client/presence";

const viewer = (id: string, role: PresenceViewer["role"] = "display"): PresenceViewer => ({
  viewerId: id,
  role,
});

/**
 * Synchronous in-memory stand-in for BroadcastChannel — same shape as the one
 * in leader.test.ts: a posted message reaches every OTHER live member at once,
 * and `kill` models a tab that stops both sending and receiving (a crash).
 */
class FakeBus {
  private readonly members = new Map<string, (m: PresenceMessage) => void>();
  join(id: string, recv: (m: PresenceMessage) => void) {
    this.members.set(id, recv);
  }
  kill(id: string) {
    this.members.delete(id);
  }
  post(from: string, msg: PresenceMessage) {
    for (const [id, recv] of this.members) if (id !== from) recv(msg);
  }
}

/**
 * Stand-in for Supabase presence. Counts how many connections are open RIGHT
 * NOW (the number this whole change exists to keep at one) and how many have
 * ever been opened, and lets a test push a roster sync down every open one.
 */
class FakePresenceServer {
  openCount = 0;
  everOpened = 0;
  private readonly sinks = new Map<string, (v: PresenceViewer[]) => void>();

  connectFor(tabId: string) {
    return (onRoster: (v: PresenceViewer[]) => void) => {
      this.openCount++;
      this.everOpened++;
      this.sinks.set(tabId, onRoster);
      return {
        close: () => {
          if (this.sinks.delete(tabId)) this.openCount--;
        },
      };
    };
  }

  /** Which tabs hold a connection right now. */
  holders(): string[] {
    return [...this.sinks.keys()].sort();
  }

  /** A presence sync arrives on every open connection. */
  sync(viewers: PresenceViewer[]) {
    for (const sink of this.sinks.values()) sink(viewers);
  }
}

interface Tab {
  id: string;
  ctrl: PresenceController;
  /** Every roster this tab was told to render, in order. */
  rendered: PresenceViewer[][];
}

function cluster(
  ids: string[],
  clock: { now: number },
): { bus: FakeBus; server: FakePresenceServer; tabs: Tab[] } {
  const bus = new FakeBus();
  const server = new FakePresenceServer();
  const tabs: Tab[] = ids.map((id) => {
    const tab: Tab = { id, ctrl: null as unknown as PresenceController, rendered: [] };
    tab.ctrl = new PresenceController({
      selfId: id,
      now: () => clock.now,
      post: (m) => bus.post(id, m),
      connect: server.connectFor(id),
      onRoster: (v) => tab.rendered.push(v),
    });
    bus.join(id, (m) => tab.ctrl.receive(m));
    return tab;
  });
  return { bus, server, tabs };
}

describe("one presence connection per group, not per tab", () => {
  it("only the leader tab connects; followers hold nothing", () => {
    const clock = { now: 1_000 };
    const { server, tabs } = cluster(["c", "a", "b"], clock);
    for (const t of tabs) t.ctrl.start();
    for (let r = 0; r < 3; r++) {
      clock.now += 100;
      for (const t of tabs) t.ctrl.tick();
    }

    expect(server.openCount).toBe(1);
    expect(server.holders()).toEqual(["a"]); // smallest id leads
    expect(tabs.filter((t) => t.ctrl.holdsConnection).map((t) => t.id)).toEqual(["a"]);
  });

  it("followers render the roster the leader synced", () => {
    const clock = { now: 1_000 };
    const { server, tabs } = cluster(["a", "b"], clock);
    const [a, b] = tabs;
    a.ctrl.start();
    b.ctrl.start();

    server.sync([viewer("d-1"), viewer("f-9", "follow")]);

    expect(a.rendered.at(-1)).toEqual([viewer("d-1"), viewer("f-9", "follow")]);
    expect(b.rendered.at(-1)).toEqual([viewer("d-1"), viewer("f-9", "follow")]);
    expect(b.ctrl.holdsConnection).toBe(false);
  });

  it("a newly-seen follower is caught up without waiting for the next sync", () => {
    const clock = { now: 1_000 };
    const { bus, server, tabs } = cluster(["a"], clock);
    const [a] = tabs;
    a.ctrl.start();
    server.sync([viewer("d-1")]);

    // A second tab of the same machine opens later.
    const late: Tab = { id: "b", ctrl: null as unknown as PresenceController, rendered: [] };
    late.ctrl = new PresenceController({
      selfId: "b",
      now: () => clock.now,
      post: (m) => bus.post("b", m),
      connect: server.connectFor("b"),
      onRoster: (v) => late.rendered.push(v),
    });
    bus.join("b", (m) => late.ctrl.receive(m));
    late.ctrl.start();

    // The catch-up relay fired the moment "a" saw "b"'s first beat.
    expect(late.rendered.at(-1)).toEqual([viewer("d-1")]);
    // "b" briefly self-promoted (it had not heard "a" yet) and opened a socket;
    // one heartbeat round later it demotes and closes it again.
    clock.now += 100;
    a.ctrl.tick();
    late.ctrl.tick();
    expect(late.ctrl.isLeader).toBe(false);
    expect(server.openCount).toBe(1);
    expect(server.holders()).toEqual(["a"]);
  });

  it("a leader that has not synced yet does not relay an empty roster", () => {
    const clock = { now: 1_000 };
    const { tabs } = cluster(["a", "b"], clock);
    const [a, b] = tabs;
    a.ctrl.start(); // leads, connected, but no sync has arrived
    b.ctrl.start(); // draws a catch-up attempt from "a"

    expect(b.rendered).toEqual([]); // nothing rather than "everyone left"
  });
});

describe("leader handover keeps presence alive", () => {
  it("graceful close: the closing leader hands the connection over at once", () => {
    const clock = { now: 1_000 };
    const { bus, server, tabs } = cluster(["a", "b"], clock);
    const [a, b] = tabs;
    a.ctrl.start();
    b.ctrl.start();
    server.sync([viewer("d-1")]);
    expect(server.holders()).toEqual(["a"]);

    // The tab that happened to be leader is the one the user closes.
    a.ctrl.resign(); // pagehide → bye
    a.ctrl.stop(); // effect cleanup → its connection goes
    bus.kill("a");

    // No clock advance: "b" promoted and reconnected the instant it saw the bye.
    expect(b.ctrl.isLeader).toBe(true);
    expect(server.openCount).toBe(1);
    expect(server.holders()).toEqual(["b"]);
    // The roster "b" was relayed is still what it shows while its own first
    // sync is in flight — the counts do not blink through zero.
    expect(b.rendered.at(-1)).toEqual([viewer("d-1")]);
    server.sync([viewer("d-2")]);
    expect(b.rendered.at(-1)).toEqual([viewer("d-2")]);
  });

  it("crash: the next tab promotes and reconnects within the age-out", () => {
    const clock = { now: 1_000 };
    const { bus, server, tabs } = cluster(["a", "b", "c"], clock);
    for (const t of tabs) t.ctrl.start();
    for (let r = 0; r < 2; r++) {
      clock.now += 100;
      for (const t of tabs) t.ctrl.tick();
    }
    server.sync([viewer("d-1")]);
    expect(server.holders()).toEqual(["a"]);

    // "a" crashes: no bye, no more beats, and its connection dies with it.
    bus.kill("a");
    tabs[0].ctrl.stop();
    expect(server.openCount).toBe(0); // the gap the age-out has to close

    const [, b, c] = tabs;
    clock.now += PEER_TIMEOUT_MS + 1;
    b.ctrl.tick();
    c.ctrl.tick();

    expect(b.ctrl.isLeader).toBe(true);
    expect(c.ctrl.isLeader).toBe(false);
    expect(server.openCount).toBe(1);
    expect(server.holders()).toEqual(["b"]);

    // And the promoted tab's own syncs now feed the followers.
    server.sync([viewer("d-2")]);
    expect(c.rendered.at(-1)).toEqual([viewer("d-2")]);
  });

  it("demotion closes the connection: a smaller id takes it over", () => {
    const clock = { now: 1_000 };
    const { bus, server, tabs } = cluster(["b"], clock);
    const [b] = tabs;
    b.ctrl.start();
    expect(server.holders()).toEqual(["b"]);

    // A tab with a smaller id opens; "b" must hand the connection over, not
    // keep a second one open beside it.
    const a: Tab = { id: "a", ctrl: null as unknown as PresenceController, rendered: [] };
    a.ctrl = new PresenceController({
      selfId: "a",
      now: () => clock.now,
      post: (m) => bus.post("a", m),
      connect: server.connectFor("a"),
      onRoster: (v) => a.rendered.push(v),
    });
    bus.join("a", (m) => a.ctrl.receive(m));
    a.ctrl.start();

    clock.now += 100;
    a.ctrl.tick();
    b.ctrl.tick();

    expect(b.ctrl.holdsConnection).toBe(false);
    expect(server.openCount).toBe(1);
    expect(server.holders()).toEqual(["a"]);
  });
});

describe("no-BroadcastChannel fallback", () => {
  it("every tab leads itself and holds its own connection (today's behaviour)", () => {
    // No shared bus: the controllers never hear each other, which is exactly the
    // path the hook takes when BroadcastChannel is absent.
    const clock = { now: 0 };
    const server = new FakePresenceServer();
    const solo = ["x", "y", "z"].map(
      (id) =>
        new PresenceController({
          selfId: id,
          now: () => clock.now,
          post: () => {}, // no transport
          connect: server.connectFor(id),
          onRoster: () => {},
        }),
    );
    for (const c of solo) c.start();

    expect(solo.every((c) => c.isLeader)).toBe(true);
    expect(server.openCount).toBe(3); // one per tab — unchanged, not "smarter"
  });
});

describe("presence groups", () => {
  it("collapses only same-session, same-role tabs", () => {
    // Two display tabs of one session share a leader…
    expect(presenceChannelName("s1", "display")).toBe(presenceChannelName("s1", "display"));
    // …the operator tab in the same browser does not (it would otherwise stop
    // being counted, which is less information, not fewer connections)…
    expect(presenceChannelName("s1", "display")).not.toBe(presenceChannelName("s1", "operator"));
    // …and neither does a tab on another session.
    expect(presenceChannelName("s1", "display")).not.toBe(presenceChannelName("s2", "display"));
  });

  it("is namespaced away from the display loop's leader channel", () => {
    // The display election is keyed by JOIN CODE and carries frames; presence is
    // keyed by SESSION ID and carries rosters. Sharing a channel name would feed
    // one election's beats into the other.
    expect(presenceChannelName("s1", "display")).not.toContain("stage-leader:");
    expect(presenceChannelName("s1", "display")).toBe("stage-presence:s1:display");
  });
});
