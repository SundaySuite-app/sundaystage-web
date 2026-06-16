import { describe, expect, it } from "vitest";
import {
  isTypingTarget,
  resolveHotkey,
  type HotkeyAction,
} from "@/lib/operator/hotkeys";

describe("isTypingTarget (bail-in-input rule)", () => {
  it("treats text-entry controls as typing targets (case-insensitive)", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ isContentEditable: true })).toBe(true);
  });

  it("is false for non-entry elements and missing focus", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
    expect(isTypingTarget({})).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe("resolveHotkey (key → action mapping)", () => {
  const cases: Array<[string, HotkeyAction["type"]]> = [
    [" ", "next"],
    ["Spacebar", "next"],
    ["ArrowRight", "next"],
    ["PageDown", "next"],
    ["ArrowLeft", "prev"],
    ["PageUp", "prev"],
    ["b", "black"],
    ["B", "black"],
    ["l", "logo"],
    ["L", "logo"],
  ];

  for (const [key, type] of cases) {
    it(`maps ${JSON.stringify(key)} → ${type}`, () => {
      expect(resolveHotkey({ key }, null)).toEqual({ type });
    });
  }

  it("returns null for unbound keys", () => {
    for (const key of ["a", "Enter", "Escape", "ArrowUp", "1", "Tab"]) {
      expect(resolveHotkey({ key }, null), key).toBeNull();
    }
  });

  it("bails (null) for EVERY bound key when focus is in a typing target", () => {
    const typing = { tagName: "TEXTAREA" };
    for (const [key] of cases) {
      expect(resolveHotkey({ key }, typing), key).toBeNull();
    }
  });

  it("still resolves when focus is a button (transport should win there)", () => {
    expect(resolveHotkey({ key: " " }, { tagName: "BUTTON" })).toEqual({ type: "next" });
  });
});
