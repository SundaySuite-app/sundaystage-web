import { describe, expect, it } from "vitest";
import { buildBroadcastMessages } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";

describe("buildBroadcastMessages", () => {
  it("defaults to a single PUBLIC message (unchanged legacy behavior)", () => {
    const msgs = buildBroadcastMessages("t", "e", { a: 1 });
    expect(msgs).toEqual([{ topic: "t", event: "e", payload: { a: 1 }, private: false }]);
  });

  it("frame channel: one PRIVATE message (must match the private subscriber)", () => {
    const msgs = buildBroadcastMessages(
      channels.session("sess"),
      events.frame,
      { seq: 3 },
      { private: true },
    );
    expect(msgs).toEqual([
      { topic: "stage:session:sess", event: "frame", payload: { seq: 3 }, private: true },
    ]);
  });

  it("commands channel: DUAL-SEND private + public during the transition window", () => {
    const msgs = buildBroadcastMessages(
      channels.commands("sess"),
      events.command,
      { cmd: "next", cmd_seq: 1 },
      { private: true, alsoPublic: true },
    );
    expect(msgs).toHaveLength(2);
    // A private copy for upgraded desktops...
    expect(msgs).toContainEqual({
      topic: "stage:session:sess:commands",
      event: "command",
      payload: { cmd: "next", cmd_seq: 1 },
      private: true,
    });
    // ...and a public copy so in-field older desktops still receive commands.
    expect(msgs).toContainEqual({
      topic: "stage:session:sess:commands",
      event: "command",
      payload: { cmd: "next", cmd_seq: 1 },
      private: false,
    });
  });

  it("private WITHOUT alsoPublic emits no public copy (post-migration end state)", () => {
    const msgs = buildBroadcastMessages("t", "e", {}, { private: true });
    expect(msgs).toEqual([{ topic: "t", event: "e", payload: {}, private: true }]);
  });
});
