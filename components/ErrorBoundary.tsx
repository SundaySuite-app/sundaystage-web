"use client";

/**
 * A small, dependency-free React error boundary.
 *
 * Wraps a subtree so a thrown render/lifecycle error shows a recoverable
 * fallback ("something broke — reload") instead of a white screen. Critical for
 * the operator console: a child throw mid-service must never leave the operator
 * staring at nothing while the projector is live. The fallback offers a reload
 * (full remount), and we re-throw nothing — the rest of the app keeps running.
 */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional custom fallback; receives a reset() that remounts the subtree. */
  fallback?: (reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Best-effort console trace; no telemetry pipeline in the web app yet.
    console.error("[ErrorBoundary] caught", error);
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset);

    return (
      <main className="landing grain">
        <div className="landing-card" role="alert">
          <p className="muted">Noe gikk galt. Last inn på nytt for å fortsette.</p>
          <button
            className="btn btn--gold"
            style={{ marginTop: "0.8rem" }}
            onClick={() => {
              this.reset();
              if (typeof window !== "undefined") window.location.reload();
            }}
          >
            Last inn på nytt
          </button>
        </div>
      </main>
    );
  }
}
