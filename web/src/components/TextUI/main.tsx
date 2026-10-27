// lib.showTextUI, in the 19/10 look: one slanted plate with an accent edge. Each line of the text is its own row
// (real newlines and a literal "\n" both break), a [KEY] in the text becomes a key cap (the controller button on
// a pad), **bold** comes out in the accent, and the plate stops growing at 48vh and wraps. The script's icon sits
// at the start of the first line (iconAnimation 'spin' spins it).
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { useNuiEvent } from "../../hooks/useNuiEvent";
import { setUiTheme } from "../../stores/uiTheme";
import { Ico, Key, Layer, md } from "../Kit";

type Pos = string | { top?: string | number; right?: string | number; bottom?: string | number; left?: string | number; transform?: string };

type TextUIOptions = {
  position?: Pos
  icon?: string
  iconColor?: string
  iconAnimation?: string
  style?: CSSProperties
  alignIcon?: "top" | "center" | "bottom"
}

const OFF = "3vh";

/** The named spots (3vh in from the edge), or a script's own top/left/... box. */
function placeOf(pos?: Pos): CSSProperties {
  const at = (top: string, right: string, bottom: string, left: string, transform = "none"): CSSProperties => ({ top, right, bottom, left, transform });
  if (pos && typeof pos === "object") {
    const v = (x?: string | number) => (x == null ? "auto" : typeof x === "number" ? `${x}px` : x);
    return at(v(pos.top), v(pos.right), v(pos.bottom), v(pos.left), pos.transform || "none");
  }
  switch (pos) {
    case "top-left": return at(OFF, "auto", "auto", OFF);
    case "top-center": return at(OFF, "auto", "auto", "50%", "translateX(-50%)");
    case "top-right": return at(OFF, OFF, "auto", "auto");
    case "left-center": return at("50%", "auto", "auto", OFF, "translateY(-50%)");
    case "right-center": return at("50%", OFF, "auto", "auto", "translateY(-50%)");
    case "bottom-left": return at("auto", "auto", OFF, OFF);
    case "bottom-right": return at("auto", OFF, OFF, "auto");
    default: return at("auto", "auto", OFF, "50%", "translateX(-50%)");
  }
}

/** One line: [KEY] -> a cap, the rest as words (with **bold** / *em*). */
function line(text: string, icon: ReactNode, i: number) {
  const parts = text.split(/(\[[^\]]+\])/).filter((p) => p.trim() !== "");
  return (
    <div className="ln" key={i}>
      {icon}
      {parts.map((p, j) =>
        /^\[[^\]]+\]$/.test(p)
          ? <Key key={j} kb={p.slice(1, -1).trim()} sm />
          : <span key={j}>{md(p.trim())}</span>,
      )}
    </div>
  );
}

export default function TextUI() {
  const [opened, setOpened] = useState(false);
  const [text, setText] = useState("");
  const [options, setOptions] = useState<TextUIOptions>({});
  const [n, setN] = useState(0);

  useNuiEvent("SHOW_TEXT_UI", (data: { text: string; options?: TextUIOptions }) => {
    // Whose colours this belongs to: App wraps this component in <Themed>, so the whole of it renders in the
    // calling resource's palette.
    setUiTheme("textui", (data.options as unknown as { theme?: never } | undefined)?.theme);
    setText(String(data.text ?? ""));
    setOptions(data.options || {});
    if (!opened) setN((x) => x + 1);
    setOpened(true);
  });

  useNuiEvent("HIDE_TEXT_UI", () => setOpened(false));
  useNuiEvent("UPDATE_TEXT_UI", (t: string) => setText(String(t ?? "")));

  if (!opened) return null;
  const lines = text.replace(/\r/g, "").split(/\n|\\n/).filter((l) => l.trim() !== "");
  const anim = options.iconAnimation;
  const icon = options.icon
    ? <Ico icon={options.icon} spin={anim === "spin"} className={anim && anim !== "spin" ? anim : undefined} style={options.iconColor ? { color: options.iconColor } : undefined} />
    : null;

  return (
    <Layer>
      <div className="tu" style={{ ...placeOf(options.position), ...options.style }}>
        <div key={n} className="pl edge pp in">
          <div className="sk">{lines.map((l, i) => line(l, i === 0 ? icon : null, i))}</div>
        </div>
      </div>
    </Layer>
  );
}
