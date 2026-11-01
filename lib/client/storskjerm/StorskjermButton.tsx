"use client";

import { useState } from "react";
import { StorskjermPanel } from "./StorskjermPanel";
import { tekst } from "./tekst";
import "./storskjerm.css";

/** «Vis på storskjerm» — knapp som åpner veiviseren for visnings-adressen `url` (`/d/<kode>`).
 * Deaktivert til økten har en kode. */
export function StorskjermButton({ url }: { url: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn--ghost op-mini2"
        aria-haspopup="dialog"
        disabled={!url}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">▶︎</span> {tekst.knapp}
      </button>
      {open && url && <StorskjermPanel url={url} onClose={() => setOpen(false)} />}
    </>
  );
}
