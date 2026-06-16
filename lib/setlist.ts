/**
 * Pure setlist mutations for the web operator — kept out of the component so
 * reorder/edit/delete (and the fiddly "where does the live `current` index
 * land?" math) is unit-tested. The operator calls these, updates React state,
 * then persists via the existing saveSetlist. No I/O here.
 */
import { z } from "zod";
import type { SlideDef } from "./sections";

/**
 * Validation for the persisted operator setlist. Additive + lenient on extras
 * (`.passthrough()` would be too loose; we strip unknown keys) but it bounds the
 * shape so a malformed/abusive PUT is rejected at the route, not on a later read.
 */
export const SlideDefSchema = z.object({
  label: z.string().max(80).nullable(),
  lines: z.array(z.string().max(500)).max(40),
});

export const SetlistSchema = z.object({
  slides: z.array(SlideDefSchema).max(500),
  current: z.number().int().min(-1),
});
export type StoredSetlist = z.infer<typeof SetlistSchema>;

/** A structural change to a setlist, used to reindex the live `current`. */
export type SetlistOp =
  | { type: "remove"; index: number }
  | { type: "move"; from: number; to: number };

/** Move the slide at `from` to `to` (target clamped to range). New array. */
export function moveSlide(slides: SlideDef[], from: number, to: number): SlideDef[] {
  if (from < 0 || from >= slides.length) return slides;
  const target = Math.max(0, Math.min(to, slides.length - 1));
  if (target === from) return slides;
  const next = slides.slice();
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Remove the slide at `index`. New array (or the same when out of range). */
export function removeSlideAt(slides: SlideDef[], index: number): SlideDef[] {
  if (index < 0 || index >= slides.length) return slides;
  return [...slides.slice(0, index), ...slides.slice(index + 1)];
}

/** Patch the slide at `index` (lines and/or label), immutably. */
export function updateSlideAt(
  slides: SlideDef[],
  index: number,
  patch: Partial<SlideDef>,
): SlideDef[] {
  if (index < 0 || index >= slides.length) return slides;
  return slides.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

/**
 * Where the live `current` index lands after a structural op, so the operator
 * keeps pointing at the SAME slide (or a sensible neighbour when it is removed).
 * `lenBefore` is the slide count BEFORE the op. Returns -1 when nothing should
 * be shown.
 */
export function reindexCurrent(prevCurrent: number, op: SetlistOp, lenBefore: number): number {
  if (op.type === "remove") {
    const newLen = lenBefore - 1;
    if (newLen <= 0 || prevCurrent < 0) return -1;
    if (op.index < prevCurrent) return prevCurrent - 1;
    if (op.index > prevCurrent) return prevCurrent;
    // Removing the current slide: point at whatever shifts into the slot,
    // clamped to the new last index.
    return Math.min(prevCurrent, newLen - 1);
  }
  // move
  if (prevCurrent < 0) return -1;
  const target = Math.max(0, Math.min(op.to, lenBefore - 1));
  if (prevCurrent === op.from) return target; // the moved slide IS the current one
  // Bystander: account for the slot leaving `from` and arriving at `target`.
  let c = prevCurrent;
  if (op.from < c) c -= 1;
  if (target <= c) c += 1;
  return c;
}
