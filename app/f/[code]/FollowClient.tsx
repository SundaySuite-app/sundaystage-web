"use client";

/**
 * Follow-along on the phone in the pew — text-only, big readable type.
 * The accessibility surface that replaces the desktop repo's companion PWA.
 */
import { useState } from "react";
import { useSessionState } from "@/lib/client/useSessionState";
import { usePresence } from "@/lib/client/usePresence";
import { t } from "@/lib/locale/i18n";

export function FollowClient({ code }: { code: string }) {
  const { join, session, state, connected } = useSessionState(code);
  const [viewerId] = useState(() => `f-${Math.random().toString(36).slice(2)}`);
  usePresence(session?.id ?? null, { viewerId, role: "follow" });


  const frame = state.frame;
  const ended = state.status === "ended";

  return (
    <div className="follow-root grain">
      <div className="follow-bar">
        <span className="brand" style={{ fontSize: "0.95rem" }}>
          Sunday<b>Stage</b>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span className={`conn-dot${connected ? "" : " off"}`} style={{ position: "static" }} />
          {ended ? "—" : t("follow.live")}
        </span>
      </div>
      <div className="follow-body">
        {join === "not_found" ? (
          <p className="muted">{t("display.notFound")}</p>
        ) : ended ? (
          <p className="follow-text" style={{ color: "var(--ink-300)" }}>{t("follow.ended")}</p>
        ) : !frame || frame.kind === "black" || frame.kind === "logo" ? (
          <p className="muted">{t("follow.waiting")}</p>
        ) : (
          <div key={state.seq} className="slide-fade">
            {frame.section_label ? (
              <div className="eyebrow" style={{ marginBottom: "0.8rem" }}>{frame.section_label}</div>
            ) : null}
            <div className="follow-text">
              {frame.kind === "message"
                ? frame.message
                : (frame.text_lines ?? []).map((line, i) => (
                    <span key={i} style={{ display: "block" }}>
                      {line}
                      {frame.translation_lines?.[i] ? (
                        <span className="tr">{frame.translation_lines[i]}</span>
                      ) : null}
                    </span>
                  ))}
            </div>
            {frame.reference ? <div className="follow-ref">{frame.reference}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
