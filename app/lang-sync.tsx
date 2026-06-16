"use client";

/**
 * Keeps `<html lang>` honest. The document ships with lang="no" (the home
 * market + SSR default), but the UI is rendered in the browser's locale, so on
 * mount we set the real language for screen readers and hyphenation. The follow
 * page lets a reader pick their own language; it dispatches a `stage:locale`
 * event so this stays in sync without a shared store.
 */
import { useEffect } from "react";
import { detectLocale, LOCALES, type Locale } from "@/lib/locale/i18n";

export function LangSync() {
  useEffect(() => {
    const apply = (loc: Locale) => {
      document.documentElement.lang = loc;
    };
    apply(detectLocale());

    const onLocale = (e: Event) => {
      const loc = (e as CustomEvent<string>).detail;
      if ((LOCALES as readonly string[]).includes(loc)) apply(loc as Locale);
    };
    window.addEventListener("stage:locale", onLocale);
    return () => window.removeEventListener("stage:locale", onLocale);
  }, []);

  return null;
}
