import {
  serviceItemKindFromWire,
  type ServiceItemKind,
  type ServicePlan,
  type SetlistItem,
} from "@sunday/contracts";

import type { SlideDef } from "@/lib/sections";

// The Plan → Stage bridge (pure, no I/O). Maps a canonical SundayPlan
// `ServicePlan` (the running order Plan owns) into SundayStage's setlist shape
// (`SlideDef = { label, lines }`). The cross-app kind vocabulary mapping lives
// in @sunday/contracts (`serviceItemKindFromWire`) so this never invents its own.

// Norwegian running-order labels per canonical kind. "custom" carries no prefix.
const KIND_LABEL_NO: Record<ServiceItemKind, string> = {
  song: "Sang",
  scripture: "Skriftlesning",
  sermon: "Preken",
  reading: "Lesning",
  prayer: "Bønn",
  offering: "Offer",
  announcement: "Kunngjøring",
  welcome: "Velkomst",
  response: "Svar",
  media: "Video",
  gap: "Pause",
  custom: "",
};

function itemToSlide(item: SetlistItem): SlideDef {
  // Defensive per the contract's guidance: normalize the wire kind so payloads
  // from both pre- and post-convergence producers map cleanly (unknown → custom).
  const canonical = serviceItemKindFromWire(item.kind);
  const kindLabel = KIND_LABEL_NO[canonical];
  const title = (item.title ?? item.song_ref?.title ?? item.scripture_ref ?? "").trim();
  const parts = [kindLabel, title].filter(Boolean);
  const label = (parts.length > 0 ? parts.join(": ") : "Ledd").slice(0, 80);
  // The contract carries a REFERENCE, not lyric/verse content (SongRef has no
  // lyrics — we never copy content we can't host), so slides start empty: the
  // operator fills each from the church library or paste, exactly as for a
  // hand-built setlist. The import delivers the running ORDER + labels, which is
  // precisely what flows Plan → Stage.
  return { label, lines: [] };
}

/** Map a canonical SundayPlan ServicePlan into a SundayStage setlist skeleton:
 *  one labelled placeholder slide per running-order item, ordered by position. */
export function servicePlanToSlides(plan: ServicePlan): SlideDef[] {
  return [...plan.items].sort((a, b) => a.position - b.position).map(itemToSlide);
}
