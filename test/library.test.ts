import { describe, expect, it } from "vitest";
import { PublishBody, PublishSong } from "@/lib/server/library";

const UUID = "00000000-0000-0000-0000-000000000001";
const song = {
  source_song_id: "s1",
  title: "Stor er din trofasthet",
  sections: [{ label: "Vers 1", lines: ["a", "b"] }],
  language: "no",
  source_updated_at: 1000,
};

describe("PublishBody", () => {
  it("accepts a minimal valid body", () => {
    expect(PublishBody.safeParse({ church_id: UUID, songs: [song] }).success).toBe(true);
  });
  it("allows an optional deleted list", () => {
    expect(
      PublishBody.safeParse({ church_id: UUID, songs: [], deleted: ["s1", "s2"] }).success,
    ).toBe(true);
  });
  it("rejects a non-uuid church_id", () => {
    expect(PublishBody.safeParse({ church_id: "nope", songs: [song] }).success).toBe(false);
  });
  it("rejects a song missing source_song_id", () => {
    const { source_song_id: _omit, ...bad } = song;
    void _omit;
    expect(PublishBody.safeParse({ church_id: UUID, songs: [bad] }).success).toBe(false);
  });
});

describe("PublishSong", () => {
  it("defaults language to 'no'", () => {
    const r = PublishSong.safeParse({
      source_song_id: "s1",
      title: "T",
      sections: [],
      source_updated_at: 0,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.language).toBe("no");
  });
  it("rejects a negative source_updated_at", () => {
    expect(PublishSong.safeParse({ ...song, source_updated_at: -1 }).success).toBe(false);
  });
});

describe("PublishBody church_id (zod 4 parity)", () => {
  it("keeps the v3 UUID leniency (any 8-4-4-4-12 hex, as Postgres uuid accepts)", () => {
    expect(
      PublishBody.safeParse({ church_id: "11111111-2222-3333-4444-555555555555", songs: [] }).success,
    ).toBe(true);
  });
  it("still defaults language to 'no'", () => {
    const { source_updated_at, source_song_id, title, sections } = song;
    expect(
      PublishSong.parse({ source_song_id, title, sections, source_updated_at }).language,
    ).toBe("no");
  });
});
