import type { ServiceItemKind, ServicePlan, SetlistItem, SongRef } from "@sunday/contracts";
import { describe, expect, it } from "vitest";

import { servicePlanToSlides } from "@/lib/serviceplan";

// servicePlanToSlides only reads `plan.items`, so the tests build items and wrap
// them in a minimal plan (the full ServiceRef is irrelevant to the mapping).
const planOf = (items: SetlistItem[]) => ({ items }) as unknown as ServicePlan;

const item = (over: Partial<SetlistItem> & { kind: ServiceItemKind }): SetlistItem => ({
  position: 0,
  title: null,
  song_ref: null,
  scripture_ref: null,
  key_override: null,
  duration_min: null,
  notes: null,
  ...over,
});

const songRef = (title: string): SongRef => ({
  sundaysong_id: null,
  local_id: null,
  title,
  ccli_song_id: null,
  tono_work_id: null,
  default_key: null,
  language: "no",
});

describe("servicePlanToSlides", () => {
  it("maps items to labelled placeholder slides, ordered by position", () => {
    const slides = servicePlanToSlides(
      planOf([
        item({ position: 2, kind: "sermon", title: "Nåde" }),
        item({ position: 1, kind: "song", song_ref: songRef("10 000 grunner") }),
        item({ position: 3, kind: "scripture", scripture_ref: "Joh 3:16" }),
      ]),
    );
    expect(slides).toEqual([
      { label: "Sang: 10 000 grunner", lines: [] },
      { label: "Preken: Nåde", lines: [] },
      { label: "Skriftlesning: Joh 3:16", lines: [] },
    ]);
  });

  it("labels by kind alone when there is no title", () => {
    expect(servicePlanToSlides(planOf([item({ kind: "welcome" })]))[0]).toEqual({
      label: "Velkomst",
      lines: [],
    });
  });

  it("normalizes legacy Plan wire kinds (worship_set → song)", () => {
    const slide = servicePlanToSlides(
      planOf([item({ kind: "worship_set" as ServiceItemKind, title: "Lovsang" })]),
    )[0];
    expect(slide.label).toBe("Sang: Lovsang");
  });

  it("falls back to 'Ledd' for an unknown kind with no title", () => {
    expect(
      servicePlanToSlides(planOf([item({ kind: "zzz" as ServiceItemKind })]))[0],
    ).toEqual({ label: "Ledd", lines: [] });
  });

  it("prefers an explicit title over the song reference title", () => {
    const slide = servicePlanToSlides(
      planOf([item({ kind: "song", title: "Inngangssang", song_ref: songRef("Annet") })]),
    )[0];
    expect(slide.label).toBe("Sang: Inngangssang");
  });
});
