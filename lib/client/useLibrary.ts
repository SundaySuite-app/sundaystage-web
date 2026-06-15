"use client";

/**
 * Reads the signed-in operator's church song library (GET /api/library).
 * Cookie-authed and entirely independent of the session secret — if the
 * operator is signed in to a Sunday account in this browser they see their
 * church's songs, otherwise `state` is "anon" and the UI shows a sign-in CTA.
 * Fetches lazily (only when `enabled`) so an anonymous operator never calls it.
 */
import { useCallback, useEffect, useState } from "react";

export interface LibrarySong {
  id: string;
  title: string;
  sections: { label?: string | null; lines: string[] }[];
  language: string;
  ccli_song_id?: string | null;
}

export type LibraryState = "loading" | "anon" | "ready";

export function useLibrary(enabled: boolean) {
  const [state, setState] = useState<LibraryState>("loading");
  const [songs, setSongs] = useState<LibrarySong[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/library");
      if (!res.ok) {
        setState("anon");
        return;
      }
      const body = (await res.json()) as { songs?: LibrarySong[] };
      setSongs(body.songs ?? []);
      setState("ready");
    } catch {
      setState("anon");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, load]);

  return { state, songs, reload: load };
}
