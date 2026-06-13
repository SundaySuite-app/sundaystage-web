import { describe, expect, it } from "vitest";
import {
  SENSITIVE_PLACEHOLDER,
  WebFrame,
  fromLiveFrame,
  type LiveFrame,
} from "@/lib/webframe";

const slide = (over: Partial<LiveFrame & { slide_content: never }> = {}): LiveFrame => ({
  kind: "slide",
  slide_content: {
    section_label: "Vers 1",
    text_lines: ["Stor er din trofasthet", "å Gud min Far"],
    reference: null,
    sensitive_slide: false,
    ...((over as Record<string, unknown>).slide_content as object | undefined),
  },
});

describe("fromLiveFrame (port of the desktop publisher's gating table)", () => {
  it("maps a lyric slide verbatim", () => {
    const f = fromLiveFrame(slide());
    expect(f).toMatchObject({
      v: 1,
      kind: "slide",
      text_lines: ["Stor er din trofasthet", "å Gud min Far"],
      section_label: "Vers 1",
    });
    expect(WebFrame.parse(f)).toBeTruthy();
  });

  it("keeps scripture reference and translation lines", () => {
    const f = fromLiveFrame({
      kind: "slide",
      slide_content: {
        section_label: null,
        text_lines: ["For så høyt har Gud elsket verden"],
        translation_lines: ["For God so loved the world"],
        reference: "Joh 3,16",
        sensitive_slide: false,
      },
    });
    expect(f.reference).toBe("Joh 3,16");
    expect(f.translation_lines).toEqual(["For God so loved the world"]);
  });

  it("collapses a sensitive slide to the neutral placeholder", () => {
    const f = fromLiveFrame({
      kind: "slide",
      slide_content: {
        section_label: "Forbønn",
        text_lines: ["Navn Navnesen, kreftbehandling"],
        reference: null,
        sensitive_slide: true,
      },
    });
    expect(f.kind).toBe("message");
    expect(f.message).toBe(SENSITIVE_PLACEHOLDER);
    expect(JSON.stringify(f)).not.toContain("Navnesen");
  });

  it("force-gate collapses EVERYTHING, even non-sensitive slides", () => {
    const f = fromLiveFrame(slide(), { forceGate: true });
    expect(f.kind).toBe("message");
    expect(f.message).toBe(SENSITIVE_PLACEHOLDER);
  });

  it("maps black/logo/message frames", () => {
    expect(fromLiveFrame({ kind: "black" }).kind).toBe("black");
    expect(fromLiveFrame({ kind: "logo" }).kind).toBe("logo");
    const msg = fromLiveFrame({ kind: "message", text: "Velkommen!" });
    expect(msg).toMatchObject({ kind: "message", message: "Velkommen!" });
  });

  it("threads appearance through every kind", () => {
    const appearance = { bg_color: "#000814", text_color: "#fff", font_scale: 1.2 };
    expect(fromLiveFrame(slide(), { appearance }).appearance).toEqual(appearance);
    expect(fromLiveFrame({ kind: "black" }, { appearance }).appearance).toEqual(appearance);
  });

  it("zod rejects out-of-contract junk", () => {
    expect(WebFrame.safeParse({ v: 2, kind: "slide" }).success).toBe(false);
    expect(WebFrame.safeParse({ v: 1, kind: "evil" }).success).toBe(false);
    expect(
      WebFrame.safeParse({ v: 1, kind: "slide", text_lines: Array(100).fill("x") }).success,
    ).toBe(false);
  });
});
