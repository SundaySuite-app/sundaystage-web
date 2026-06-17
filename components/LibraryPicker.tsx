"use client";

/**
 * Operator-side picker for the church song library. A disclosure that lazily
 * loads /api/library on open; signed-in operators get a searchable song list,
 * anonymous ones get a sign-in CTA. Picking a song hands its sections back to
 * the operator, which feeds them through the SAME add-slides flow as paste.
 */
import { useState } from "react";
import Link from "next/link";
import { useLibrary, type LibrarySong } from "@/lib/client/useLibrary";
import { t } from "@/lib/locale/i18n";

export function LibraryPicker({ onPick }: { onPick: (song: LibrarySong) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { state, songs, reload } = useLibrary(open);

  const needle = q.trim().toLowerCase();
  const filtered = needle ? songs.filter((s) => s.title.toLowerCase().includes(needle)) : songs;

  return (
    <details
      className="op-templates-list"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="btn btn--ghost op-mini2">{t("op.library")}</summary>
      <div className="op-templates-menu">
        {state === "loading" ? (
          <p className="muted">{t("op.libLoading")}</p>
        ) : state === "timeout" ? (
          <p className="muted">
            {t("op.libTimeout")}{" "}
            <button
              type="button"
              className="op-template-load"
              style={{ display: "inline", width: "auto", color: "var(--gold-300)" }}
              onClick={() => void reload()}
            >
              {t("op.libRetry")} →
            </button>
          </p>
        ) : state === "anon" ? (
          <p className="muted">
            {t("op.libAnon")}{" "}
            <Link href="/library" style={{ color: "var(--gold-300)" }}>
              {t("op.libSignIn")} →
            </Link>
          </p>
        ) : songs.length === 0 ? (
          <p className="muted">{t("op.libEmpty")}</p>
        ) : (
          <>
            <input
              className="txt"
              placeholder={t("op.libSearch")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ marginBottom: "0.4rem" }}
            />
            {filtered.map((s) => (
              <button key={s.id} className="op-template-load" onClick={() => onPick(s)}>
                {s.title}
              </button>
            ))}
          </>
        )}
      </div>
    </details>
  );
}
