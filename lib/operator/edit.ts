/**
 * Pure helpers for the operator's slide-editor textarea.
 *
 * Extracted so the "what does this draft text become?" rule is shared by BOTH
 * the live preview (debounced, while typing) and the save action — keeping them
 * in lock-step — and is unit-tested without a DOM.
 */

/**
 * Turn the editor textarea value into slide lines: split on newlines, trim each,
 * drop blank lines. Mirrors the save path exactly so the preview can never show
 * something different from what saving would produce.
 */
export function editTextToLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
