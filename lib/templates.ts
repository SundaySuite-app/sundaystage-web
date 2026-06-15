/**
 * Reusable setlists ("templates") for the web operator, stored in localStorage
 * so a volunteer can prepare a service at home and reload it next Sunday — no
 * backend, no DB migration, no account. Per-device by design (sessions are
 * anonymous + secret-based, so there is no server-side owner to scope to).
 *
 * The pure parse/serialize/cap logic is unit-tested; the localStorage I/O is a
 * thin wrapper guarded against quota errors (Safari private mode = quota 0).
 */
import type { SlideDef } from "./sections";

export interface Template {
  name: string;
  slides: SlideDef[];
  savedAt: number;
}

export const TEMPLATES_KEY = "stage-templates";
export const MAX_TEMPLATES = 20;

/** Defensively parse the raw localStorage value into a clean Template[]. */
export function parseTemplates(raw: string | null): Template[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (t): t is Template =>
          !!t &&
          typeof (t as Template).name === "string" &&
          Array.isArray((t as Template).slides),
      )
      .map((t) => ({
        name: t.name,
        slides: t.slides,
        savedAt: typeof t.savedAt === "number" ? t.savedAt : 0,
      }));
  } catch {
    return [];
  }
}

/** Insert or replace a template by name, newest first, capped. */
export function upsertTemplate(list: Template[], tpl: Template): Template[] {
  const without = list.filter((t) => t.name !== tpl.name);
  return [tpl, ...without].slice(0, MAX_TEMPLATES);
}

/** Remove a template by name. */
export function removeTemplate(list: Template[], name: string): Template[] {
  return list.filter((t) => t.name !== name);
}

// ── Thin localStorage I/O (not unit-tested; never throws) ───────────────────

export function loadTemplates(): Template[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return parseTemplates(localStorage.getItem(TEMPLATES_KEY));
  } catch {
    return [];
  }
}

/** Persist the list. Returns false when storage is unavailable / over quota. */
export function saveTemplates(list: Template[]): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
