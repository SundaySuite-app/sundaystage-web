"use client";

/**
 * Wraps the operator console in an error boundary with a LOCALIZED, recoverable
 * fallback. A child throw mid-service must show "reload" — never a white screen
 * while the projector is live. Kept as a thin client wrapper so the (server)
 * page stays a plain async component.
 */
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { t } from "@/lib/locale/i18n";
import { OperatorClient } from "./OperatorClient";

export function OperatorBoundary({ id }: { id: string }) {
  return (
    <ErrorBoundary
      fallback={(reset) => (
        <main className="landing grain">
          <div className="landing-card" role="alert">
            <p className="muted">{t("op.crashTitle")}</p>
            <button
              className="btn btn--gold"
              style={{ marginTop: "0.8rem" }}
              onClick={() => {
                reset();
                if (typeof window !== "undefined") window.location.reload();
              }}
            >
              {t("op.crashReload")}
            </button>
          </div>
        </main>
      )}
    >
      <OperatorClient id={id} />
    </ErrorBoundary>
  );
}
