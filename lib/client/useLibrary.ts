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

export type LibraryState = "loading" | "anon" | "ready" | "timeout";

/** Hard cap on the library fetch so a stalled request shows a retry, not a
 * spinner that never resolves. Covers fetch() AND body read via one signal. */
const LIBRARY_TIMEOUT_MS = 5000;

export function useLibrary(enabled: boolean) {
  const [state, setState] = useState<LibraryState>("loading");
  const [songs, setSongs] = useState<LibrarySong[]>([]);

  const load = useCallback(async () => {
    setState("loading");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LIBRARY_TIMEOUT_MS);
    try {
      const res = await fetch("/api/library", { signal: ctrl.signal });
      if (!res.ok) {
        setState("anon");
        return;
      }
      const body = (await res.json()) as { songs?: LibrarySong[] };
      setSongs(body.songs ?? []);
      setState("ready");
    } catch (err) {
      // An abort = our timeout fired; offer a retry instead of failing to anon.
      setState((err as { name?: string })?.name === "AbortError" ? "timeout" : "anon");
    } finally {
      clearTimeout(timer);
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
