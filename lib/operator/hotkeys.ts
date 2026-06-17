/**
 * Operator keyboard transport — pure key → action mapping.
 *
 * Extracted from OperatorClient so the (fiddly) "which key does what, and when
 * do we bail because the user is typing?" rules are unit-tested in isolation.
 * No DOM, no React: the component reads `document.activeElement` and calls the
 * matching transport function; this module only decides WHICH one.
 *
 * Bindings (matches the desktop transport): Space/→/PageDown next,
 * ←/PageUp prev, B black, L logo. Everything else is ignored.
 */

/** The transport intents an operator key press can resolve to. */
export type HotkeyAction =
  | { type: "next" }
  | { type: "prev" }
  | { type: "black" }
  | { type: "logo" };

/** The minimal slice of a KeyboardEvent the mapping needs. */
export interface HotkeyEvent {
  key: string;
}

/** Tag names (and the contenteditable flag) we must NOT steal keys from. */
export interface ActiveElementInfo {
  tagName?: string;
  isContentEditable?: boolean;
}

/**
 * True when keystrokes belong to the focused control (typing into a paste box,
 * slide editor, or any contenteditable) and the operator transport must stand
 * down — otherwise "B" while editing would black the projector mid-word.
 */
export function isTypingTarget(el: ActiveElementInfo | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Resolve a key press to a transport action, honouring the bail-in-input rule.
 * Returns `null` when the key is unbound OR focus is in a typing target — the
 * caller then does nothing (and, importantly, does NOT preventDefault).
 */
export function resolveHotkey(
  event: HotkeyEvent,
  active: ActiveElementInfo | null | undefined,
): HotkeyAction | null {
  if (isTypingTarget(active)) return null;

  switch (event.key) {
    case " ":
    case "Spacebar": // legacy/Firefox alias
    case "ArrowRight":
    case "PageDown":
      return { type: "next" };
    case "ArrowLeft":
    case "PageUp":
      return { type: "prev" };
    case "b":
    case "B":
      return { type: "black" };
    case "l":
    case "L":
      return { type: "logo" };
    default:
      return null;
  }
}
