import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyJoinStatus,
  parseLast,
  lastKey,
  loadLastState,
  saveLastState,
  LAST_PREFIX,
} from "@/lib/client/lastframe";
import { INITIAL_DISPLAY_STATE, applySnapshot, joinBase } from "@/lib/merge";
import type { WebFrame } from "@/lib/webframe";

const frame = (msg: string): WebFrame => ({ v: 1, kind: "message", message: msg });

/** Minimal localStorage stand-in — the node test env has none. */
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const shim = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as { localStorage?: unknown }).localStorage = shim;
  return store;
}

describe("classifyJoinStatus", () => {
  it("treats 404 as not_found and everything else as offline", () => {
    expect(classifyJoinStatus(404)).toBe("not_found");
    expect(classifyJoinStatus(500)).toBe("offline");
    expect(classifyJoinStatus(0)).toBe("offline");
    expect(classifyJoinStatus(503)).toBe("offline");
  });
});

describe("lastKey", () => {
  it("namespaces by code", () => {
    expect(lastKey("123456")).toBe(`${LAST_PREFIX}123456`);
  });
});

describe("parseLast", () => {
  const now = 1_000_000_000_000;
  const valid = JSON.stringify({
    sessionId: "sess-a",
    seq: 5,
    frame: { v: 1, kind: "message", message: "hi" },
    savedAt: now,
  });

  it("parses a fresh entry", () => {
    const s = parseLast(valid, now + 1000);
    expect(s?.seq).toBe(5);
    expect(s?.sessionId).toBe("sess-a");
    expect(s?.frame?.message).toBe("hi");
  });
  it("rejects null / garbage / bad seq", () => {
    expect(parseLast(null, now)).toBeNull();
    expect(parseLast("{bad", now)).toBeNull();
    expect(parseLast(JSON.stringify({ seq: "x", savedAt: now }), now)).toBeNull();
  });
  it("rejects an entry past the 24 h TTL", () => {
    const old = JSON.stringify({ sessionId: "a", seq: 1, frame: null, savedAt: now });
    expect(parseLast(old, now + 25 * 60 * 60 * 1000)).toBeNull();
  });
  it("reads a legacy entry (no sessionId) as unattributed", () => {
    // Written by the previous build: has `status`, has no session id. It must
    // still parse (so the frame can paint) but claim no session.
    const legacy = JSON.stringify({ seq: 9, frame: null, status: "ended", savedAt: now });
    expect(parseLast(legacy, now)?.sessionId).toBeNull();
  });
});

describe("last-frame cache I/O", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installLocalStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  const now = 1_700_000_000_000;

  it("round-trips the frame and the session id", () => {
    saveLastState("402815", "sess-a", { seq: 12, frame: frame("verse 2"), status: "live" }, now);
    const back = loadLastState("402815", now + 1000);
    expect(back?.sessionId).toBe("sess-a");
    expect(back?.state.seq).toBe(12);
    expect(back?.state.frame?.message).toBe("verse 2");
  });

  it("never rehydrates 'ended' — lifecycle belongs to the server", () => {
    saveLastState("402815", "sess-a", { seq: 50, frame: frame("amen"), status: "ended" }, now);
    expect(store.get(lastKey("402815"))).not.toContain("ended");
    // Same session, reload seconds later: the slide comes back, "ended" does not.
    // A persisted "ended" is sticky in applySnapshot and no poll could clear it.
    expect(loadLastState("402815", now + 5_000)?.state.status).toBe("live");
  });
});

// The proven wedge: PINs are unique only among LIVE sessions, so the morning
// service's code is handed out again in the afternoon. Same laptop, same code.
describe("recycled PIN (S2 regression)", () => {
  beforeEach(() => installLocalStorage());
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  const CODE = "402815";
  const morning = 1_700_000_000_000;
  const afternoon = morning + 4 * 60 * 60 * 1000; // still inside the 24 h TTL

  it("the new session wins outright — no wedge on the old last slide", () => {
    // Morning service ran to slide 50 and ended.
    saveLastState(CODE, "sess-morning", { seq: 50, frame: frame("amen"), status: "ended" }, morning);

    // Afternoon: the display boots, rehydrates for an instant repaint…
    const cached = loadLastState(CODE, afternoon);
    let s = applySnapshot(INITIAL_DISPLAY_STATE, cached!.state);
    expect(s.seq).toBe(50); // painted, so the screen is never blank

    // …then the by-code join resolves the PIN to a DIFFERENT session at seq 1.
    s = applySnapshot(joinBase(s, "sess-afternoon", cached!.sessionId), {
      seq: 1,
      frame: frame("welcome"),
      status: "live",
    });

    expect(s.seq).toBe(1);
    expect(s.frame?.message).toBe("welcome");
    expect(s.status).toBe("live"); // not stuck "ended" ⇒ polling still runs
  });

  it("a legacy entry with no session id is discarded too", () => {
    // Unprovable ownership: costs one repaint, prevents a whole-service wedge.
    let s = applySnapshot(INITIAL_DISPLAY_STATE, { seq: 50, frame: frame("old"), status: "live" });
    s = applySnapshot(joinBase(s, "sess-afternoon", null), {
      seq: 1,
      frame: frame("welcome"),
      status: "live",
    });
    expect(s.seq).toBe(1);
    expect(s.frame?.message).toBe("welcome");
  });

  it("a reload DURING the same session still keeps the cached slide", () => {
    // The whole point of the cache: seq 50 must survive a rejoin at seq 50.
    saveLastState(CODE, "sess-live", { seq: 50, frame: frame("verse 3"), status: "live" }, morning);
    const cached = loadLastState(CODE, morning + 2_000);
    let s = applySnapshot(INITIAL_DISPLAY_STATE, cached!.state);
    s = applySnapshot(joinBase(s, "sess-live", cached!.sessionId), {
      seq: 50,
      frame: frame("verse 3"),
      status: "live",
    });
    expect(s.seq).toBe(50);
    expect(s.frame?.message).toBe("verse 3");
  });
});
