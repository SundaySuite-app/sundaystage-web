/**
 * The slide surface — shared by the fullscreen display and the operator
 * preview. Deliberately neutral: readability from the back row beats
 * decoration, so the only inputs are the frame's own text + appearance.
 */
import type { WebFrame } from "@/lib/webframe";

/** Shrink factor so many-line slides still fit: 1 → ~0.62 at 10+ lines. */
function fitFactor(lineCount: number): number {
  if (lineCount <= 4) return 1;
  return Math.max(0.55, 1 - (lineCount - 4) * 0.08);
}

export function SlideRenderer({ frame, animateKey }: { frame: WebFrame | null; animateKey?: string | number }) {
  const bg = frame?.appearance?.bg_color ?? "#000";
  const fg = frame?.appearance?.text_color ?? "#fff";
  const scale = frame?.appearance?.font_scale ?? 1;

  const style = {
    "--slide-bg": bg,
    "--slide-fg": fg,
    "--scale": scale,
  } as React.CSSProperties;

  if (!frame || frame.kind === "black") {
    return <div className="slide-stage" style={{ ...style, "--slide-bg": "#000" } as React.CSSProperties} />;
  }

  if (frame.kind === "logo") {
    return (
      <div className="slide-stage" style={style}>
        <span className="brand" style={{ fontSize: "clamp(1.6rem, 5vmin, 3rem)", opacity: 0.85 }}>
          Sunday<b>Stage</b>
        </span>
      </div>
    );
  }

  if (frame.kind === "message" || frame.kind === "ended") {
    return (
      <div className="slide-stage" style={style}>
        <div key={animateKey} className="slide-text slide-fade" style={{ "--fit": 0.85 } as React.CSSProperties}>
          {frame.message ?? ""}
        </div>
      </div>
    );
  }

  const lines = frame.text_lines ?? [];
  const translations = frame.translation_lines ?? [];
  const fit = fitFactor(lines.length + Math.min(translations.length, lines.length) * 0.6);

  return (
    <div className="slide-stage" style={style}>
      {frame.section_label ? <span className="slide-label">{frame.section_label}</span> : null}
      <div key={animateKey} className="slide-text slide-fade" style={{ "--fit": fit } as React.CSSProperties}>
        {lines.map((line, i) => (
          <span key={i} style={{ display: "block" }}>
            {line}
            {translations[i] ? <span className="tr">{translations[i]}</span> : null}
          </span>
        ))}
      </div>
      {frame.reference ? <span className="slide-ref">{frame.reference}</span> : null}
    </div>
  );
}
