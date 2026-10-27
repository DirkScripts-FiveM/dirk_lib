// lib.alertDialog, in the 19/10 look: a slanted title plate with the warning sign, the text on a straight panel
// (one paragraph per line, **bold** / *em*), a 20-segment "Closes in N s" bar when the script gave a timeout, and
// the buttons with their keys (Esc / B cancels, Enter / A confirms). Centred unless the script says centered = false.
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useNuiEvent } from "../../hooks/useNuiEvent";
import { setUiTheme } from "../../stores/uiTheme";
import { fetchNui } from "../../utils/fetchNui";
import { Key, KitIcon, Layer, md, Segs, tr } from "../Kit";

interface AlertDialogData {
  header: string;
  content: string;
  centered?: boolean;
  cancel?: boolean;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  labels?: {
    cancel?: string;
    confirm?: string;
  };
  /** ms until Lua closes it (lib.alertDialog's second argument), for the countdown */
  timeout?: number;
}

// the mock's box is 50vh, its long one 64vh
const SIZE_MAP: Record<string, string> = {
  xs: "36vh",
  sm: "44vh",
  md: "50vh",
  lg: "58vh",
  xl: "64vh",
};

export default function AlertDialog() {
  const [data, setData] = useState<AlertDialogData | null>(null);
  const [n, setN] = useState(0);
  const [left, setLeft] = useState(0);

  const respond = (result: "confirm" | "cancel") => {
    if (!data) return;
    setData(null);
    fetchNui("ALERT_DIALOG_RESULT", result);
  };

  useNuiEvent<AlertDialogData>("SHOW_ALERT_DIALOG", (incoming) => {
    // Whose colours this belongs to. `App` wraps this component in <Themed>, so the whole thing renders in the
    // calling resource's palette.
    setUiTheme("alert", (incoming as { theme?: never } | undefined)?.theme);
    setData(incoming);
    setN((x) => x + 1);
  });

  useNuiEvent("CLOSE_ALERT_DIALOG", () => {
    setData(null);
    fetchNui("ALERT_DIALOG_RESULT", null);
  });

  // the countdown runs off the clock; Lua does the closing
  const total = data && typeof data.timeout === "number" && data.timeout > 0 ? data.timeout : 0;
  useEffect(() => {
    if (!total) return;
    const t0 = performance.now();
    setLeft(total);
    const iv = window.setInterval(() => setLeft(Math.max(0, total - (performance.now() - t0))), 100);
    return () => window.clearInterval(iv);
  }, [n, total]);

  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); respond("cancel"); }
      else if (e.key === "Enter") { e.preventDefault(); respond("confirm"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!data) return null;
  const width = SIZE_MAP[data.size ?? "md"] ?? SIZE_MAP.md;
  const paras = String(data.content ?? "").replace(/\r/g, "").split(/\n|\\n/).filter((p) => p.trim() !== "");
  const top = data.centered === false ? ({ top: "20vh", "--t": "translateX(-50%)" } as CSSProperties) : undefined;

  return (
    <Layer live>
      <div className="dlg alrt rise" key={n} style={{ width, ...top }}>
        <div className="pl edge wash hd">
          <span className="sk"><KitIcon name="warning" /></span>
          <div className="sk" style={{ minWidth: 0 }}><div className="T">{data.header}</div></div>
        </div>
        <div className="panel body">
          <div className="D">{paras.map((p, i) => <p key={i}>{md(p)}</p>)}</div>
          {total > 0 && (
            <div className="tmo">
              <span className="L">{tr("ui.closes_in", "Closes in %s s", Math.ceil(left / 1000))}</span>
              <Segs n={20} frac={left / total} />
            </div>
          )}
        </div>
        <div className="btns">
          {data.cancel && (
            <span className="pl btn hit" onClick={() => respond("cancel")}>
              <span className="sk"><Key kb="ESC" pad="B" sm /><span className="act">{data.labels?.cancel ?? tr("ui.cancel", "Cancel")}</span></span>
            </span>
          )}
          <span className="pl btn go hit" onClick={() => respond("confirm")}>
            <span className="sk"><Key kb="ENTER" pad="A" sm /><span className="act">{data.labels?.confirm ?? tr("ui.confirm", "Confirm")}</span></span>
          </span>
        </div>
      </div>
    </Layer>
  );
}
