// lib.progressBar / lib.progressCircle, in the 19/10 look. The bar: a slanted plate with the label (and the
// script's icon), the percent, 20 segments and the description. The circle: a 24-segment ring with the percent
// in it, the label under it on a plate. Both show the cancel key when the script lets you cancel, and turn red
// with "Cancelled" for a moment when it's stopped.
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useNuiEvent } from "../../hooks/useNuiEvent";
import { setUiTheme } from "../../stores/uiTheme";
import { fetchNui } from "../../utils/fetchNui";
import { Ico, KStrip, Layer, Segs, tr } from "../Kit";

type ProgressData = {
  label?: string
  description?: string
  icon?: string
  duration: number
  position?: unknown
  /** the script lets you cancel it (lib.progressBar's canCancel) */
  canCancel?: boolean
  /** the key cancel_lib_progress is bound to (keyboard); a pad shows B */
  cancelKey?: string
  theme?: unknown
}

type Shown = ProgressData & { kind: "bar" | "circle" }

// how long the red "Cancelled" stays before it goes (the next bar waits for it)
const CANCEL_MS = 800;

/** Where it sits: the mock's spot is bottom centre, 9vh up. A script may ask for the top or the middle. */
function placeOf(pos: unknown): CSSProperties | undefined {
  const p = typeof pos === "string" ? pos.toLowerCase() : "";
  if (!p || p === "bottom" || p === "bottom-center") return undefined;
  const h = p.includes("left") ? "left" : p.includes("right") ? "right" : "center";
  const v = p.startsWith("top") ? "top" : p.startsWith("bottom") ? "bottom" : "middle";
  const st: Record<string, string> = {};
  if (h === "left") { st.left = "3vh"; st.right = "auto"; }
  if (h === "right") { st.left = "auto"; st.right = "3vh"; }
  if (v === "top") { st.top = "9vh"; st.bottom = "auto"; }
  if (v === "middle") { st.top = "50%"; st.bottom = "auto"; }
  const tx = h === "center" ? "-50%" : "0", ty = v === "middle" ? "-50%" : "0";
  st["--t"] = `translate(${tx}, ${ty})`;
  return st as CSSProperties;
}

/** The ring: 24 segments of 12deg with 3deg gaps, lit clockwise from the top (the mock's conic ring, as SVG). */
function Ring({ frac }: { frac: number }) {
  const R = 44.7, W = 10.7, deg = Math.max(0, Math.min(1, frac)) * 360;
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => {
      const r = ((a - 90) * Math.PI) / 180;
      return `${(50 + R * Math.cos(r)).toFixed(3)} ${(50 + R * Math.sin(r)).toFixed(3)}`;
    };
    return `M${p(a0)} A${R} ${R} 0 0 1 ${p(a1)}`;
  };
  const segs = [];
  for (let i = 0; i < 24; i++) {
    const a0 = i * 15, lit = Math.max(0, Math.min(12, deg - a0));
    segs.push(<path key={"b" + i} d={arc(a0, a0 + 12)} stroke="rgba(255,255,255,.16)" />);
    if (lit > 0.05) segs.push(<path key={"l" + i} d={arc(a0, a0 + lit)} stroke="var(--lit, var(--a))" />);
  }
  return <svg className="ring" viewBox="0 0 100 100" fill="none" strokeWidth={W}>{segs}</svg>;
}

export default function ProgressBar() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [frac, setFrac] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const run = useRef(0);

  const start = (kind: Shown["kind"], data: ProgressData) => {
    // Whose colours this belongs to: App wraps this component in <Themed>, so the whole of it renders in the
    // calling resource's palette.
    setUiTheme("progress", (data as { theme?: never })?.theme);
    run.current++;
    setCancelled(false);
    setFrac(0);
    setShown({ ...data, kind });
  };

  // the fill runs off the clock; at the end it goes and tells Lua
  useEffect(() => {
    if (!shown || cancelled) return;
    const id = run.current, t0 = performance.now(), dur = Math.max(1, Number(shown.duration) || 1);
    const iv = window.setInterval(() => {
      if (id !== run.current) return;
      const f = (performance.now() - t0) / dur;
      if (f >= 1) {
        window.clearInterval(iv);
        setShown(null);
        fetchNui("PROGRESS_COMPLETE");
        return;
      }
      setFrac(f);
    }, 33);
    return () => window.clearInterval(iv);
  }, [shown, cancelled]);

  useNuiEvent("SHOW_PROGRESS", (data: ProgressData) => start("bar", data));
  useNuiEvent("circleProgress", (data: ProgressData) => start("circle", data));

  useNuiEvent("CANCEL_PROGRESS", () => {
    if (!shown) return;
    const id = run.current;
    setCancelled(true);
    window.setTimeout(() => {
      if (id !== run.current) return;
      setShown(null);
      setCancelled(false);
      fetchNui("PROGRESS_COMPLETE");
    }, CANCEL_MS);
  });

  if (!shown) return null;
  const pct = Math.min(100, Math.floor(frac * 100));
  const strip = shown.canCancel && !cancelled
    ? <KStrip rows={[{ kb: shown.cancelKey || "X", pad: "B", label: tr("ui.cancel", "Cancel") }]} />
    : null;
  const red = cancelled ? ({ "--e": "var(--red)", "--lit": "var(--red)", "--w": "rgba(229,72,77,.3)" } as CSSProperties) : undefined;

  if (shown.kind === "circle") {
    return (
      <Layer>
        <div key={run.current} className="ringw rise" style={{ ...placeOf(shown.position), ...red }}>
          <div className="ringbox">
            <Ring frac={frac} />
            <div className="V" style={cancelled ? { color: "var(--red)" } : undefined}>{pct}%</div>
          </div>
          {(shown.label || cancelled) && (
            <div className="pl edge wash pp" style={{ maxWidth: "60vh" }}>
              <div className="sk T" style={{ fontSize: "2vh" }}>{cancelled ? tr("progress_cancelled", "Cancelled") : shown.label}</div>
            </div>
          )}
          {strip}
        </div>
      </Layer>
    );
  }

  const desc = cancelled ? shown.label : shown.description;
  return (
    <Layer>
      <div key={run.current} className={"pg rise" + (cancelled ? " cancel" : "")} style={placeOf(shown.position)}>
        <div className="pl edge wash pp">
          <div className="sk">
            <div className="barTop">
              <span className="T" style={{ minWidth: 0 }}>
                {shown.icon && <Ico icon={shown.icon} />}
                <span style={{ minWidth: 0 }}>{cancelled ? tr("progress_cancelled", "Cancelled") : shown.label}</span>
              </span>
              <span className="V">{pct}%</span>
            </div>
            <Segs n={20} frac={frac} />
            {desc && <div className="D">{desc}</div>}
          </div>
        </div>
        {strip}
      </div>
    </Layer>
  );
}
