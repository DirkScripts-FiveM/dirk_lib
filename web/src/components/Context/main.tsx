// lib.registerContext / lib.showContext, in the 19/10 look: a column on the right. A slanted title plate (with the
// back key when there's a menu to go back to), the search box, the rows (icon, title, description, a 10-segment
// bar for progress, a picture, a lock when disabled, a chevron when it opens a menu), the row's metadata on a plate
// to the left of the selected row, and the key strip (Move / Pick / Back / Close).
//
// Past 66vh (about 9 rows) the list scrolls, with a thin accent scroll bar in its own gutter, clear of the rows. The
// keyboard works: up / down move, Enter picks, Backspace goes back (closes at the top menu; while the search box has
// text it deletes instead), Escape closes.
import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNuiEvent } from "../../hooks/useNuiEvent";
import { useAudio } from "../../stores/audio/store";
import { setUiTheme } from "../../stores/uiTheme";
import { fetchNui } from "../../utils/fetchNui";
import { Ico, Key, KitIcon, KStrip, Layer, md, Segs, tr } from "../Kit";
import type { ContextItemProps } from "./ContextItem";
import "./context.css";

export type MenuProps = {
  id?: string
  title: string
  description?: string
  icon?: string
  canClose: boolean
  dialog?: string
  searchBar?: boolean
  menu?: string
  watermark?: string
  clickSounds: boolean
  hoverSounds: boolean
  options: ContextItemProps[]
}

type Meta = [string, string];

/** The scroll bar: how far down (0-1), how much of the list shows, and its gutter in px (outside the column / off the rows). */
type Bar = { p: number; h: number; out: number; pad: number };
const NO_BAR: Bar = { p: 0, h: 1, out: 0, pad: 0 };
/** The plates' skew (kit.css: skewX(-14deg)), as the run per unit of height; and the bar's sizes, in vh. */
const SLANT = Math.tan((14 * Math.PI) / 180);
const BAR_W = 0.35, BAR_GAP = 0.8, BAR_EDGE = 0.6;

/** ox_lib's metadata shapes: { label = value }, { 'line', ... } or { { label, value }, ... }. */
function metaOf(m: unknown): Meta[] {
  if (!m || typeof m !== "object") return [];
  if (Array.isArray(m)) {
    return m.filter((x) => x != null).map((x): Meta => {
      if (typeof x === "object") {
        const o = x as { label?: unknown; value?: unknown };
        return [String(o.label ?? ""), o.value == null ? "" : String(o.value)];
      }
      return [String(x), ""];
    });
  }
  return Object.entries(m as Record<string, unknown>).map(([k, v]): Meta => [k, v == null ? "" : typeof v === "object" ? String((v as { value?: unknown }).value ?? "") : String(v)]);
}

export default function Menu() {
  const [menu, setMenu] = useState<MenuProps | null>(null);
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState(-1);
  const [opened, setOpened] = useState(0);
  const [bar, setBar] = useState(NO_BAR);
  const [metaTop, setMetaTop] = useState<number | null>(null);
  const scr = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const play = useAudio((s) => s.play);

  const show = (data: MenuProps, fresh: boolean) => {
    // Whose colours this belongs to: App wraps this component in <Themed>, so the whole of it renders in the
    // calling resource's palette.
    setUiTheme("context", (data as unknown as { theme?: never })?.theme);
    setMenu(data);
    if (fresh) { setSearch(""); setSel(-2); setOpened((n) => n + 1); }
  };
  useNuiEvent("OPEN_CONTEXT", (data: MenuProps) => show(data, true));
  useNuiEvent("UPDATE_CONTEXT", (data: MenuProps) => show(data, false));
  useNuiEvent("CLOSE_CONTEXT", () => setMenu(null));

  // The list is checked before it is used, and so is every entry in it. These come from Lua, where a table
  // constructor with a conditional in it — `{ a and x or nil, ... }` — leaves a HOLE rather than a shorter
  // list, and that arrives here as `[null, {...}]`. Same defence as the dialogue's `asArray`.
  const all = useMemo(() => (menu && Array.isArray(menu.options) ? menu.options.filter((o) => o !== null && o !== undefined) : []), [menu]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((o) =>
      String(o.title ?? "").toLowerCase().includes(q) ||
      String(o.description ?? "").toLowerCase().includes(q) ||
      (o.metadata ? JSON.stringify(o.metadata).toLowerCase().includes(q) : false));
  }, [all, search]);

  const pickable = (o?: ContextItemProps) => !!o && !o.disabled && !o.readOnly;

  // a fresh menu (or a new search) selects its first row you can pick
  useEffect(() => {
    if (!menu) return;
    setSel((cur) => (cur === -2 || cur >= rows.length || !pickable(rows[cur]) ? rows.findIndex(pickable) : cur));
  }, [rows, menu]);

  const hasBack = !!(menu && (menu.menu || menu.dialog));
  const close = () => { if (menu && menu.canClose !== false) { setMenu(null); fetchNui("CLOSE_CONTEXT"); } };
  const back = () => { if (hasBack) fetchNui("CONTEXT_BACK"); else close(); };
  const pick = (o?: ContextItemProps) => {
    if (!o || !pickable(o)) return;
    if (menu?.clickSounds) play("click");
    if (o.onSelect || o.serverEvent || o.clientEvent || o.menu || o.dialog) fetchNui("CONTEXT_CLICKED", o.id);
  };

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement === searchRef.current;
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? 1 : -1;
        setSel((cur) => {
          for (let i = 1; i <= rows.length; i++) {
            const n = (((cur < 0 ? (d > 0 ? -1 : 0) : cur) + d * i) % rows.length + rows.length) % rows.length;
            if (pickable(rows[n])) { if (menu.hoverSounds) play("hover"); return n; }
          }
          return cur;
        });
        return;
      }
      if (e.key === "Enter") { e.preventDefault(); pick(rows[sel]); return; }
      if (e.key === "Backspace") {
        if (typing && search !== "") return;
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // the scroll bar follows the list; the selected row stays in view; its metadata sits beside it.
  // The bar runs in its own gutter, clear of every row's slanted end: a -14deg plate reaches out by
  // tan(14deg) * its height / 2 at its top corner, so the tallest row (a long description) sets the gutter.
  // The gutter goes outside the column, into the screen margin, while there is room, so the rows keep their full
  // width; only what doesn't fit there comes off the rows (padding on the list).
  const syncBar = () => {
    const el = scr.current, list = el?.parentElement;
    if (!el || !list || el.scrollHeight <= el.clientHeight + 1) { setBar(NO_BAR); return; }
    const vh = window.innerHeight / 100;
    let reach = 0;
    for (const row of Array.from(el.children) as HTMLElement[]) reach = Math.max(reach, row.offsetHeight * SLANT / 2);
    const need = reach + BAR_GAP * vh + BAR_W * vh;
    const room = Math.max(0, window.innerWidth - list.getBoundingClientRect().right - BAR_EDGE * vh);
    const out = Math.round(Math.min(room, need)), pad = Math.round(need) - out;
    const span = el.scrollHeight - el.clientHeight;
    const next = { p: span > 0 ? el.scrollTop / span : 0, h: el.clientHeight / el.scrollHeight, out, pad };
    setBar((b) => (b.p === next.p && b.h === next.h && b.out === out && b.pad === pad ? b : next));
  };
  // the padding narrows the rows, which can make them taller: measure again once it has landed (whole px, so it settles)
  useLayoutEffect(syncBar, [bar.pad]);
  useLayoutEffect(() => {
    const el = scr.current;
    if (!el) { setMetaTop(null); return; }
    const row = el.children[sel] as HTMLElement | undefined;
    if (row) {
      const top = row.offsetTop, bot = top + row.offsetHeight;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (bot > el.scrollTop + el.clientHeight) el.scrollTop = bot - el.clientHeight;
      const rb = row.getBoundingClientRect(), cb = root.current?.getBoundingClientRect();
      setMetaTop(cb ? rb.top - cb.top : null);
    } else setMetaTop(null);
    syncBar();
  }, [sel, rows, menu]);

  if (!menu) return null;
  const meta = sel >= 0 ? metaOf(rows[sel]?.metadata) : [];
  const strip = [
    { kb: "↑ ↓", label: tr("ui.move", "Move") },
    { kb: "ENTER", label: tr("ui.pick", "Pick") },
    { kb: "BACKSPACE", label: tr("ui.back", "Back") },
    ...(menu.canClose !== false ? [{ kb: "ESC", label: tr("ui.close", "Close") }] : []),
  ];

  return (
    <Layer>
      <div className="cx" key={opened} ref={root}>
        <div className="pl edge wash hd in hit" onClick={hasBack ? back : undefined} style={hasBack ? { cursor: "pointer" } : undefined}>
          {hasBack && <span className="sk"><Key kb="BACKSPACE" pad="B" /></span>}
          <div className="sk" style={{ minWidth: 0 }}>
            <div className="T">{menu.title}</div>
            {menu.description && <div className="D">{md(menu.description)}</div>}
          </div>
        </div>

        {menu.searchBar && (
          <label className="srch in hit" style={{ "--i": 1 } as CSSProperties}>
            <KitIcon name="search" />
            <input ref={searchRef} value={search} placeholder={tr("ui.search", "Search")} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
          </label>
        )}

        {meta.length > 0 && metaTop !== null && (
          <div className="pl edge meta in" style={{ top: metaTop, "--i": 0 } as CSSProperties}>
            <div className="sk" style={{ display: "grid", gap: ".8vh" }}>
              {meta.map(([l, v], i) => <div className="row" key={i}><span className="L">{l}</span>{v !== "" && <b>{v}</b>}</div>)}
            </div>
          </div>
        )}

        <div className={"list" + (bar.h < 1 ? " scroll" : "")} style={bar.h < 1 ? ({ "--gut": `${bar.pad}px`, "--out": `${bar.out}px` } as CSSProperties) : undefined}>
          <div className="scr hit" ref={scr} onScroll={syncBar}>
            {rows.map((o, i) => {
              const cls = "pl it in" + (i === sel ? " on" : "") + (o.disabled ? " off" : "") + (o.readOnly ? " ro" : "");
              return (
                <div
                  key={o.id ?? i}
                  className={cls}
                  style={{ "--i": Math.min(i, 12) + 2 } as CSSProperties}
                  onMouseEnter={() => { if (pickable(o) && i !== sel) { setSel(i); if (menu.hoverSounds) play("hover"); } }}
                  onClick={() => pick(o)}
                >
                  <div className="sk">
                    {o.icon && <Ico icon={o.icon} spin={o.iconAnimation === "spin"} />}
                    <div className="tx">
                      <div className="t">{o.title}</div>
                      {o.description && <div className="D">{md(o.description)}</div>}
                      {typeof o.progress === "number" && <Segs n={10} frac={o.progress / 100} />}
                    </div>
                    {o.image && <img className="thumb" src={o.image} alt="" />}
                    <span className="end">
                      {o.disabled ? <KitIcon name="lock" /> : o.menu || o.arrow ? <KitIcon name="chev" /> : null}
                    </span>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && <div className="L none">{tr("ui.no_results", "Nothing found")}</div>}
          </div>
          {bar.h < 1 && <div className="bar2" style={{ "--th": `max(${bar.h * 100}%, 3vh)`, "--tp": bar.p } as CSSProperties}><i /></div>}
        </div>

        <KStrip rows={strip} start={3} />
        {menu.watermark && <img className="wm" src={menu.watermark} alt="" />}
      </div>
    </Layer>
  );
}
