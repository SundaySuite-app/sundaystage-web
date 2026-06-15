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
