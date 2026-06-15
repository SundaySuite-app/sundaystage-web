/**
 * WebFrame — the versioned, renderable payload every network display receives.
 *
 * App-internal contract (NOT the canonical LiveEvent from @sunday/contracts:
 * that is a signal contract with no slide text; this one carries content).
 * The desktop forwarder and the web operator both produce WebFrames and POST
 * them to the same /frame endpoint; displays render them verbatim.
 *
 * Privacy: the mapping from the desktop's LiveFrame gates sensitive slides to
 * a neutral placeholder — a 6-digit code is the only barrier to a display, so
 * private content must never leave the building. This mirrors (and its tests
 * port) `sundaystage/src-tauri/src/services/companion/publisher.rs`.
 */
import { z } from "zod";

export const WEBFRAME_VERSION = 1;

/** The neutral text shown for gated slides (matches the desktop publisher). */
export const SENSITIVE_PLACEHOLDER = "Tjeneste pågår";

export const Appearance = z.object({
  bg_color: z.string().max(32).optional(),
  text_color: z.string().max(32).optional(),
  font_scale: z.number().min(0.3).max(3).optional(),
});
export type Appearance = z.infer<typeof Appearance>;

export const WebFrame = z.object({
  v: z.literal(WEBFRAME_VERSION),
  kind: z.enum(["slide", "black", "logo", "message", "ended"]),
  text_lines: z.array(z.string().max(500)).max(40).optional(),
  translation_lines: z.array(z.string().max(500)).max(40).nullish(),
  // Scene/confidence monitor (musicians): the NEXT slide's content. Optional
  // and additive — old displays ignore it and `v` stays 1 (forward-compatible).
  next_lines: z.array(z.string().max(500)).max(40).optional(),
  next_label: z.string().max(80).nullish(),
  section_label: z.string().max(80).nullish(),
  reference: z.string().max(120).nullish(),
  message: z.string().max(2000).optional(),
  appearance: Appearance.nullish(),
});
export type WebFrame = z.infer<typeof WebFrame>;

/** The broadcast/polling envelope around a frame. Server-stamped. */
export interface FrameEnvelope {
  v: number;
  seq: number;
  frame: WebFrame;
  emitted_at: string;
}

// ── Desktop LiveFrame mapping ─────────────────────────────────────────────────
// Shape of the Tauri app's LiveFrame (ts-rs generated on the desktop side).
export type LiveFrame =
  | { kind: "slide"; slide_content: SlideContent }
  | { kind: "black" }
  | { kind: "logo" }
  | { kind: "message"; text: string };

export interface SlideContent {
  section_label?: string | null;
  text_lines: string[];
  translation_lines?: string[] | null;
  reference?: string | null;
  sensitive_slide: boolean;
}

/**
 * Reduce a desktop LiveFrame to a WebFrame. `forceGate` lets the operator gate
 * the whole share; a slide's own `sensitive_slide` flag gates regardless.
 * Text only — media never crosses the network.
 */
export function fromLiveFrame(
  frame: LiveFrame,
  opts: {
    forceGate?: boolean;
    appearance?: Appearance | null;
    /** The next slide's content, for the scene/confidence monitor. */
    next?: { lines: string[]; label?: string | null } | null;
  } = {},
): WebFrame {
  const appearance = opts.appearance ?? undefined;
  const sensitive =
    (opts.forceGate ?? false) ||
    (frame.kind === "slide" && frame.slide_content.sensitive_slide);

  if (sensitive) {
    return { v: WEBFRAME_VERSION, kind: "message", message: SENSITIVE_PLACEHOLDER, appearance };
  }

  switch (frame.kind) {
    case "slide":
      return {
        v: WEBFRAME_VERSION,
        kind: "slide",
        text_lines: frame.slide_content.text_lines,
        translation_lines: frame.slide_content.translation_lines ?? undefined,
        next_lines: opts.next?.lines,
        next_label: opts.next?.label ?? undefined,
        section_label: frame.slide_content.section_label ?? undefined,
        reference: frame.slide_content.reference ?? undefined,
        appearance,
      };
    case "message":
      return { v: WEBFRAME_VERSION, kind: "message", message: frame.text, appearance };
    case "black":
      return { v: WEBFRAME_VERSION, kind: "black", appearance };
    case "logo":
      return { v: WEBFRAME_VERSION, kind: "logo", appearance };
  }
}
