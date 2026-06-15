import { describe, expect, it } from "vitest";
import {
  MAX_TEMPLATES,
  parseTemplates,
  upsertTemplate,
  removeTemplate,
  type Template,
} from "@/lib/templates";

const tpl = (name: string, savedAt = 1): Template => ({
  name,
  slides: [{ label: null, lines: [name] }],
  savedAt,
});

describe("parseTemplates", () => {
  it("returns [] for null / garbage / non-array", () => {
    expect(parseTemplates(null)).toEqual([]);
    expect(parseTemplates("not json")).toEqual([]);
    expect(parseTemplates(JSON.stringify({ not: "an array" }))).toEqual([]);
  });
  it("drops malformed entries", () => {
    const raw = JSON.stringify([{ name: "ok", slides: [] }, { name: 5 }, { slides: [] }, null]);
    expect(parseTemplates(raw).map((t) => t.name)).toEqual(["ok"]);
  });
});

describe("upsertTemplate", () => {
  it("adds newest first", () => {
    let list: Template[] = [];
    list = upsertTemplate(list, tpl("a"));
    list = upsertTemplate(list, tpl("b"));
    expect(list.map((t) => t.name)).toEqual(["b", "a"]);
  });
  it("replaces by name (no duplicates)", () => {
    let list = [tpl("a"), tpl("b")];
    list = upsertTemplate(list, tpl("a", 99));
    expect(list.map((t) => t.name)).toEqual(["a", "b"]);
    expect(list[0].savedAt).toBe(99);
  });
  it("caps at MAX_TEMPLATES", () => {
    let list: Template[] = [];
    for (let i = 0; i < MAX_TEMPLATES + 5; i++) list = upsertTemplate(list, tpl(`t${i}`));
    expect(list).toHaveLength(MAX_TEMPLATES);
  });
});

describe("removeTemplate", () => {
  it("removes by name", () => {
    expect(removeTemplate([tpl("a"), tpl("b")], "a").map((t) => t.name)).toEqual(["b"]);
  });
});
