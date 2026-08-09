/**
 * A throwaway id for one open tab, used as the presence key so the operator's
 * counts ("2 skjermer · 13 mobiler") can tell viewers apart.
 *
 * Not a secret and not stable across reloads — it only has to be unique among
 * the viewers of one live session, which `Math.random()` comfortably covers at
 * congregation scale. The role prefix (d/f/s/o) makes a presence dump readable.
 */
export function newViewerId(prefix: "d" | "f" | "s" | "o" | "obs"): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}
