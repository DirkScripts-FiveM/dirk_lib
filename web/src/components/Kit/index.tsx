/**
 * The shared pieces every in-game part is built from (Liam's 19/10 mock):
 * key caps that follow the player's input (keyboard or controller), segmented
 * bars, key strips, the line icons, and the accent.
 *
 * ── the accent ──────────────────────────────────────────────────────────────
 *
 * Shade 6 of the CALLING script's palette. Each part is already wrapped in that
 * script's theme (see Themed.tsx), so useMantineTheme() in a part answers with
 * the caller's palette. The tints (--a18 / --a30 ...) are worked out here rather
 * than with color-mix(), which FiveM's CEF 103 doesn't have.
 *
 * ── keyboard or controller ──────────────────────────────────────────────────
 *
 * dirk_lib's Lua sends SET_INPUT_MODE ('kb' | 'pad') when the player switches
 * (src/ui/client/inputMode.lua), and the page asks once on load in case the
 * switch happened before it was up. Every cap then shows the keyboard key or
 * the controller button. A row can name its own pad button; otherwise PADMAP
 * gives a default. Glyphs only: pads don't drive the menus.
 */
import "./kit.css";
import { IconProp } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { rgba, useMantineTheme } from "@mantine/core";
import type { MantineColorsTuple } from "@mantine/core";
import React, { CSSProperties, Fragment, ReactNode } from "react";
import { create } from "zustand";
import { fetchNui } from "../../utils/fetchNui";
import { isEnvBrowser } from "../../utils/misc";
import { locale } from "../../stores/locales";

// ── keyboard or controller ──────────────────────────────────────────────────

export type InputMode = "kb" | "pad";
const modeStore = create<{ mode: InputMode }>(() => ({ mode: "kb" }));
export const useInputMode = () => modeStore((s) => s.mode);
export const getInputMode = () => modeStore.getState().mode;

window.addEventListener("message", (e: MessageEvent) => {
  const d = e.data;
  if (d && d.action === "SET_INPUT_MODE") modeStore.setState({ mode: d.data === "pad" ? "pad" : "kb" });
});
if (!isEnvBrowser()) {
  fetchNui<InputMode>("GET_INPUT_MODE")
    .then((m) => { if (m === "pad" || m === "kb") modeStore.setState({ mode: m }); })
    .catch(() => {});
}

// ── the accent ──────────────────────────────────────────────────────────────

const FALLBACK = "#7ac61f";

/** The tint set for one accent colour, as CSS variables for the part's root. */
export function accentVars(a: string): CSSProperties {
  let ok = a;
  try { rgba(a, 1); } catch { ok = FALLBACK; }
  return {
    "--a": ok,
    "--a18": rgba(ok, 0.18),
    "--a30": rgba(ok, 0.3),
    "--a34": rgba(ok, 0.34),
    "--a60": rgba(ok, 0.6),
  } as CSSProperties;
}

/** The calling script's accent (shade 6 of the theme this part is wrapped in). */
export function useAccent(): CSSProperties {
  const t = useMantineTheme();
  const pal = t.colors[t.primaryColor] as MantineColorsTuple | undefined;
  return accentVars((pal && pal[6]) || FALLBACK);
}

/** Shade 6 of a theme a payload carried (notifications aren't wrapped per script). */
export function useAccentOf() {
  const t = useMantineTheme();
  return (theme?: { primaryColor?: string; customTheme?: string[] } | null): string => {
    const base = (t.colors[t.primaryColor] as MantineColorsTuple | undefined)?.[6] || FALLBACK;
    if (!theme) return base;
    if (Array.isArray(theme.customTheme) && theme.customTheme.length === 10 && (!theme.primaryColor || theme.primaryColor === "custom")) return theme.customTheme[6];
    const pal = theme.primaryColor ? (t.colors[theme.primaryColor] as MantineColorsTuple | undefined) : undefined;
    return (pal && pal[6]) || base;
  };
}

// ── key names ───────────────────────────────────────────────────────────────

/** What the game calls a key -> what fits on a cap. */
const NAMES: Record<string, string> = {
  "LEFT MOUSE BUTTON": "LMB", "RIGHT MOUSE BUTTON": "RMB", "MOUSE1": "LMB", "MOUSE2": "RMB", "MOUSE_LEFT": "LMB", "MOUSE_RIGHT": "RMB",
  "SPACEBAR": "SPACE", "LEFT SHIFT": "SHIFT", "LSHIFT": "SHIFT", "LEFT CTRL": "CTRL", "LCONTROL": "CTRL", "LEFT ALT": "ALT", "LMENU": "ALT",
  "RETURN": "ENTER", "ESCAPE": "ESC", "BACK": "BACKSPACE", "BKSP": "BACKSPACE",
};

/** A keyboard key's default controller button, when the row doesn't name one. */
const PADMAP: Record<string, string> = {
  E: "A", G: "Y", H: "X", F: "X", X: "B", Q: "LB", R: "RB", T: "LB", BACKSPACE: "B", ENTER: "A", ESC: "BACK",
  LMB: "RT", RMB: "LT", SPACE: "A", TAB: "BACK", W: "LS", SHIFT: "LB",
  "↑ ↓": "DPAD:ud", "← →": "DPAD:lr", "0-9": "DPAD:udlr", "1": "A", "2": "B", "3": "X", "4": "Y",
};

/** The game's own controller names (lib.getKey's xbox) -> a cap. */
const PADNAMES: Record<string, string> = {
  "DPAD UP": "DPAD:u", "DPAD DOWN": "DPAD:d", "DPAD LEFT": "DPAD:l", "DPAD RIGHT": "DPAD:r",
  "LEFT STICK": "LS", "RIGHT STICK": "RS", "SELECT": "BACK", "VIEW": "BACK", "MENU": "START",
};

export const normKey = (k: unknown) => {
  const s = String(k ?? "").trim();
  const up = s.toUpperCase();
  return NAMES[up] || up;
};

const normPad = (p?: string | null) => {
  if (!p) return undefined;
  const up = String(p).trim().toUpperCase();
  if (!up || up === "(NONE)") return undefined;
  return PADNAMES[up] || up;
};

/** The cap text for one key: the keyboard key, or the controller button on a pad. */
export function keyFor(kb: string, pad: string | null | undefined, mode: InputMode) {
  if (mode !== "pad") return normKey(kb);
  return normPad(pad) || PADMAP[normKey(kb)] || normKey(kb);
}

// ── glyphs ──────────────────────────────────────────────────────────────────

const MouseSvg = ({ side }: { side: "L" | "R" }) => (
  <svg viewBox="0 0 16 22" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <rect x="1" y="1" width="14" height="20" rx="7" />
    <path d="M1 9h14M8 1v8" />
    {side === "L"
      ? <path d="M8 1.9A6.1 6.1 0 0 0 1.9 8v1H8z" fill="currentColor" stroke="none" />
      : <path d="M8 1.9A6.1 6.1 0 0 1 14.1 8v1H8z" fill="currentColor" stroke="none" />}
  </svg>
);

export const BkspSvg = () => (
  <svg viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
    <path d="M7 1h15a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7L1 8z" />
    <path d="M11 5l6 6M17 5l-6 6" />
  </svg>
);

const DpadSvg = ({ hot }: { hot: string }) => (
  <svg viewBox="0 0 24 24">
    <path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" fill="currentColor" opacity=".28" />
    {hot.includes("u") && <path d="M9 2h6v6l-3 3-3-3z" fill="currentColor" />}
    {hot.includes("d") && <path d="M9 22h6v-6l-3-3-3 3z" fill="currentColor" />}
    {hot.includes("l") && <path d="M2 9v6h6l3-3-3-3z" fill="currentColor" />}
    {hot.includes("r") && <path d="M22 9v6h-6l-3-3 3-3z" fill="currentColor" />}
  </svg>
);

type CapOpts = { sm?: boolean; hold?: number | null; className?: string; style?: CSSProperties };

/** One cap, already resolved to the key it shows. */
export function Cap({ k, mode, sm, hold, className, style }: CapOpts & { k: string; mode: InputMode }) {
  let cls = "cap" + (sm ? " sm" : "") + (hold != null ? " hold" : "") + (className ? " " + className : "");
  const st: CSSProperties = { ...(style || {}) };
  if (hold != null) (st as Record<string, string>)["--h"] = `${Math.round(Math.max(0, Math.min(1, hold)) * 100)}%`;
  let body: ReactNode = k;
  if (k === "LMB" || k === "RMB") body = <MouseSvg side={k[0] as "L" | "R"} />;
  else if (k === "BACKSPACE") body = <BkspSvg />;
  else if (k.startsWith("DPAD")) body = <DpadSvg hot={(k.split(":")[1] || "udlr").toLowerCase()} />;
  else if (mode === "pad") {
    if (/^[ABXY]$/.test(k)) cls += " round";
    else if (k === "LT" || k === "RT") cls += " trig";
    else if (k === "LB" || k === "RB") cls += " bump";
  }
  // the letters / glyph sit in <b>: inside a slanted plate the cap slants with it and only this stays upright (kit.css)
  return <span className={cls} style={st}><b>{body}</b></span>;
}

/**
 * A key as a script names it: `kb` is the keyboard key ("E", "LEFT MOUSE BUTTON",
 * or "LMB / E" for either), `pad` the controller button if the caller knows it.
 */
export function Key({ kb, pad, ...o }: CapOpts & { kb: string; pad?: string | null }) {
  const mode = useInputMode();
  const k = keyFor(kb, pad, mode);
  const parts = String(k).split(" / ");
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="h-or">/</span>}
          {/* on a pad, BACK is the controller's View button, not the keyboard's Backspace */}
          <Cap k={mode === "pad" && p.trim().toUpperCase() === "BACK" ? "BACK" : normKey(p)} mode={mode} {...o} />
        </Fragment>
      ))}
    </>
  );
}

// ── bars and strips ─────────────────────────────────────────────────────────

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** n segments filled to `frac` (0..1), the last lit one partly. */
export function Segs({ n, frac, style }: { n: number; frac: number; style?: CSSProperties }) {
  const f = clamp01(frac);
  return (
    <div className="segs" style={style}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ "--fill": clamp01(f * n - i).toFixed(2) } as CSSProperties} />
      ))}
    </div>
  );
}

export type StripRow = { kb: string; pad?: string | null; label: ReactNode; on?: boolean };

/** The row of small key plates under a menu or dialog (Move / Pick / Back...). */
export function KStrip({ rows, className, start = 0 }: { rows: StripRow[]; className?: string; start?: number }) {
  return (
    <div className={"kstrip" + (className ? " " + className : "")}>
      {rows.map((r, i) => (
        <span key={i} className={"pl kp in" + (r.on ? " on" : "")} style={{ "--i": i + start } as CSSProperties}>
          <span className="sk"><Key kb={r.kb} pad={r.pad} sm /><span className="act">{r.label}</span></span>
        </span>
      ))}
    </div>
  );
}

// ── text ────────────────────────────────────────────────────────────────────

/** **bold** and *em*, the only markup scripts use in these strings. */
export function md(s: unknown): ReactNode {
  const str = s == null ? "" : String(s);
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(str))) {
    if (m.index > last) out.push(str.slice(last, m.index));
    out.push(m[1] != null ? <b key={n++}>{m[1]}</b> : <em key={n++}>{m[2]}</em>);
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push(str.slice(last));
  return out;
}

/**
 * A dirk_lib locale string, with the English beside it for when the key isn't there (a browser with no Lua, or a
 * locale file that hasn't got it yet). %s fills in order.
 */
export function tr(key: string, en: string, ...args: (string | number)[]): string {
  const v = locale(key, ...args.map(String));
  if (v && v !== key) return v;
  let i = 0;
  return en.replace(/%s/g, () => String(args[i++] ?? ""));
}

export const mmss = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
  const p = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
};

export const fmtNum = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-GB");

// ── icons (24 box, stroked) ─────────────────────────────────────────────────

const ICONS: Record<string, string> = {
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  success: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
  warning: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  inform: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  box: '<path d="M3.5 7.5 12 3.5l8.5 4v9l-8.5 4-8.5-4z"/><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="1.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  wrench: '<path d="M14.5 6.5a4.5 4.5 0 0 0 5.6 5.6L12 20.2a2.5 2.5 0 0 1-3.5-3.5l8.1-8.1a4.5 4.5 0 0 1-2.1-2.1z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  spinner: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  power: '<path d="M12 3v8"/><path d="M6.6 6.6a7.5 7.5 0 1 0 10.8 0"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M6 12h12M12 6v12"/>',
};

export function KitIcon({ name, className, style, strokeWidth = 2 }: { name: string; className?: string; style?: CSSProperties; strokeWidth?: number }) {
  return (
    <svg
      className={"ico" + (className ? " " + className : "")}
      style={style}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "check" ? 3 : strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICONS[name] || ICONS.inform }}
    />
  );
}

const isUrl = (s: string) => /^(https?:)?\/\//.test(s) || s.startsWith("nui://") || /\.(png|jpe?g|webp|gif|svg)$/i.test(s);

/**
 * A script's icon: one of ours by name, an image by URL, else a FontAwesome name
 * ("house", "fas fa-house"). Nothing for an empty one.
 */
export function Ico({ icon, className, style, spin, kit }: { icon?: string | null; className?: string; style?: CSSProperties; spin?: boolean; kit?: boolean }) {
  if (!icon) return null;
  const cls = "ico" + (spin ? " spin" : "") + (className ? " " + className : "");
  if (kit !== false && ICONS[icon]) return <KitIcon name={icon} className={(spin ? "spin" : "") + (className ? " " + className : "")} style={style} />;
  if (isUrl(icon)) return <img className={cls} style={{ objectFit: "contain", ...style }} src={icon} alt="" />;
  return <FontAwesomeIcon icon={icon as IconProp} className={cls} style={style as React.ComponentProps<typeof FontAwesomeIcon>["style"]} />;
}

/** The full-screen layer a part draws in, wearing its accent. */
export const Layer = React.forwardRef<HTMLDivElement, { children: ReactNode; live?: boolean; style?: CSSProperties; className?: string; accent?: CSSProperties }>(
  function Layer({ children, live, style, className, accent }, ref) {
    const own = useAccent();
    return (
      <div ref={ref} className={"dk dk-layer" + (live ? " live" : "") + (className ? " " + className : "")} style={{ ...(accent || own), ...style }}>
        {children}
      </div>
    );
  },
);
