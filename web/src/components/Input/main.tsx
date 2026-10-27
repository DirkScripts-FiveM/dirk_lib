// lib.inputDialog, in the 19/10 look: a centred dialog. A slanted title plate (icon, title, description) over a
// straight body of fields, then slanted Cancel / Confirm buttons with their keys. More than 6 fields go to two
// columns.
//
// Every field type draws: input (password too), number (with - / + steps, min / max), checkbox, color, textarea,
// slider, select, multi-select, date, date-range and time. Defaults are filled in and come back with the answer;
// a required field left empty stops Confirm and says so under it. Enter confirms (not inside a textarea),
// Escape cancels. The answer is the same as before: a table keyed by each field's label.
import { ColorPicker } from "@mantine/core";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNuiEvent } from "../../hooks/useNuiEvent";
import { setUiTheme } from "../../stores/uiTheme";
import { fetchNui } from "../../utils/fetchNui";
import { Cap, Ico, Key, KitIcon, Layer, md, Segs, tr } from "../Kit";
import "./input.css";

type Opt = { value: string; label?: string };
type Field = {
  type?: string
  label: string
  description?: string
  placeholder?: string
  icon?: string
  required?: boolean
  disabled?: boolean
  default?: unknown
  checked?: boolean
  password?: boolean
  min?: number | string
  max?: number | string
  step?: number
  precision?: number
  format?: string
  returnString?: boolean
  options?: Opt[]
  maxSelectedValues?: number
  autosize?: boolean
}

type InfoProps = {
  title: string
  description?: string
  icon?: string
  prevDialog?: string
  prevContext?: string
  allowCancel?: boolean
}

type Values = Record<string, unknown>;

const asField = (f: Field | string): Field => (typeof f === "string" ? { type: "input", label: f } : { ...f, type: f.type || "input" });
const num = (v: unknown) => (typeof v === "number" ? v : v == null || v === "" ? undefined : Number(v));
const pad2 = (n: number) => String(n).padStart(2, "0");

/** A date as the script asked for it back: ox_lib's shape, a timestamp, or a string in `format` (DD/MM/YYYY). */
function dateOut(d: Date | null, f: Field): unknown {
  if (!d) return null;
  if (!f.returnString) return d.getTime();
  return (f.format || "DD/MM/YYYY").replace("YYYY", String(d.getFullYear())).replace("MM", pad2(d.getMonth() + 1)).replace("DD", pad2(d.getDate()));
}
function dateIn(v: unknown): Date | null {
  if (v === true) { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string" && v) {
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
const dateText = (d: Date | null) => (d ? `${pad2(d.getDate())} / ${pad2(d.getMonth() + 1)} / ${d.getFullYear()}` : "");

/** What a field starts at (its default), in the shape it comes back in. */
function startValue(f: Field): unknown {
  switch (f.type) {
    case "checkbox": return !!f.checked;
    case "number": return num(f.default) ?? null;
    case "slider": return num(f.default) ?? num(f.min) ?? 0;
    case "multi-select": return Array.isArray(f.default) ? f.default : f.default != null ? [f.default] : [];
    case "date": return f.default != null ? dateOut(dateIn(f.default), f) : null;
    case "date-range": return Array.isArray(f.default) ? f.default.map((x) => dateOut(dateIn(x), f)) : [null, null];
    default: return f.default ?? (f.type === "select" || f.type === "time" ? null : "");
  }
}

const empty = (f: Field, v: unknown) => {
  if (f.type === "checkbox") return v !== true;
  if (Array.isArray(v)) return f.type === "date-range" ? v.some((x) => x == null) : v.length === 0;
  return v == null || v === "";
};

export default function Input() {
  const [info, setInfo] = useState<InfoProps | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [values, setValues] = useState<Values>({});
  const [tried, setTried] = useState(false);
  const [openDd, setOpenDd] = useState<string | null>(null);
  const [n, setN] = useState(0);

  useNuiEvent("OPEN_INPUT_DIALOG", (data: { info: InfoProps; inputs: (Field | string)[] }) => {
    // Whose colours this belongs to: App wraps this component in <Themed>, so the whole of it renders in the
    // calling resource's palette.
    setUiTheme("input", (data as unknown as { theme?: never })?.theme);
    const fs = (Array.isArray(data.inputs) ? data.inputs : []).filter((x) => x != null).map(asField);
    const v: Values = {};
    for (const f of fs) v[f.label] = startValue(f);
    setInfo(data.info || { title: "" });
    setFields(fs);
    setValues(v);
    setTried(false);
    setOpenDd(null);
    setN((x) => x + 1);
  });
  useNuiEvent("CLOSE_INPUT_DIALOG", () => setInfo(null));

  const missing = useMemo(() => fields.filter((f) => f.required && empty(f, values[f.label])).map((f) => f.label), [fields, values]);
  const set = (label: string, v: unknown) => setValues((prev) => ({ ...prev, [label]: v }));

  const cancel = () => {
    if (!info || info.allowCancel === false) return;
    setInfo(null);
    fetchNui("INPUT_DIALOG_SUBMIT");
  };
  const confirm = () => {
    if (!info) return;
    if (missing.length) { setTried(true); return; }
    setInfo(null);
    fetchNui("INPUT_DIALOG_SUBMIT", values);
  };
  const goBack = () => { if (info) fetchNui("INPUT_GO_BACK", { prevContext: info.prevContext, prevDialog: info.prevDialog }); };

  useEffect(() => {
    if (!info) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); if (openDd) setOpenDd(null); else cancel(); return; }
      if (e.key === "Enter" && !(document.activeElement instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        if (openDd) setOpenDd(null); else confirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!info) return null;
  const two = fields.length > 6;
  const hasPrev = !!(info.prevContext || info.prevDialog);

  return (
    <Layer live>
      <div className="dlg rise inp" key={n} style={{ width: two ? "92vh" : "56vh" }} onMouseDown={(e) => { if (!(e.target as HTMLElement).closest(".dd, .ddw")) setOpenDd(null); }}>
        <div className="pl edge wash hd">
          {hasPrev && <span className="sk back" onClick={goBack}><KitIcon name="back" /></span>}
          {info.icon && <span className="sk"><Ico icon={info.icon} /></span>}
          <div className="sk" style={{ minWidth: 0 }}>
            <div className="T">{info.title}</div>
            {info.description && <div className="D">{md(info.description)}</div>}
          </div>
        </div>
        <div className={"panel body" + (two ? " two" : "")}>
          {fields.map((f, i) => (
            <FieldView key={i} f={f} id={String(i)} v={values[f.label]} set={(v) => set(f.label, v)} bad={tried && missing.includes(f.label)} openDd={openDd} setOpenDd={setOpenDd} />
          ))}
        </div>
        <div className="btns">
          {info.allowCancel !== false && (
            <span className="pl btn hit" onClick={cancel}><span className="sk"><Key kb="ESC" pad="B" sm /><span className="act">{tr("ui.cancel", "Cancel")}</span></span></span>
          )}
          <span className={"pl btn go hit" + (missing.length ? " no" : "")} onClick={confirm}><span className="sk"><Key kb="ENTER" pad="A" sm /><span className="act">{tr("ui.confirm", "Confirm")}</span></span></span>
        </div>
      </div>
    </Layer>
  );
}

type FieldProps = { f: Field; id: string; v: unknown; set: (v: unknown) => void; bad: boolean; openDd: string | null; setOpenDd: (k: string | null) => void };

function Label({ f }: { f: Field }) {
  return (
    <div className="L">
      {f.icon && f.type !== "input" && f.type !== "checkbox" ? <Ico icon={f.icon} className="lic" /> : null}
      {f.label}{f.required ? <b>*</b> : null}
      {f.description ? <small>{f.description}</small> : null}
    </div>
  );
}

function FieldView(p: FieldProps) {
  const { f, v, set, bad } = p;
  const [focus, setFocus] = useState(false);
  const box = (extra = "") => "in2" + (focus ? " focus" : "") + (bad ? " bad" : "") + (f.disabled ? " dis" : "") + extra;
  const err = bad ? <span className="err">{tr("ui.required", "Required")}</span> : null;
  const fx = { onFocus: () => setFocus(true), onBlur: () => setFocus(false), disabled: f.disabled };
  const isOpen = p.openDd === p.id;
  const toggle = () => { if (!f.disabled) p.setOpenDd(isOpen ? null : p.id); };

  switch (f.type) {
    case "checkbox":
      return (
        <div className="fl">
          <div className={"chk hit" + (f.disabled ? " dis" : "")} onClick={() => !f.disabled && set(!v)}>
            <span className={"bx" + (v ? " y" : "")}>{v ? <KitIcon name="check" /> : null}</span>
            <span>{f.label}{f.required ? <b className="req">*</b> : null}</span>
          </div>
          {f.description && <div className="L"><small>{f.description}</small></div>}
          {err}
        </div>
      );

    case "number": {
      const step = f.step ?? 1, min = num(f.min), max = num(f.max);
      const clamp = (x: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, x));
      const fix = (x: number) => (f.precision != null ? Number(x.toFixed(f.precision)) : x);
      const bump = (d: number) => { if (!f.disabled) set(fix(clamp((typeof v === "number" ? v : min ?? 0) + d * step))); };
      return (
        <div className="fl">
          <Label f={f} />
          <div className={box()}>
            <input className="tin" inputMode="decimal" value={v == null ? "" : String(v)} placeholder={f.placeholder} {...fx}
              onChange={(e) => { const t = e.target.value.replace(/[^\d.,-]/g, ""); if (t === "" || t === "-") return set(t === "" ? null : t); const x = Number(t.replace(",", ".")); set(isNaN(x) ? v : t.endsWith(".") ? t : x); }}
              onBlur={() => { setFocus(false); if (typeof v === "string") { const x = Number(v); set(isNaN(x) ? null : fix(clamp(x))); } else if (typeof v === "number") set(fix(clamp(v))); }} />
            <span className="hit stp" onMouseDown={(e) => { e.preventDefault(); bump(-1); }}><Cap k="−" mode="kb" sm /></span>
            <span className="hit stp" onMouseDown={(e) => { e.preventDefault(); bump(1); }}><Cap k="+" mode="kb" sm /></span>
          </div>
          {err}
        </div>
      );
    }

    case "textarea":
      return (
        <div className="fl">
          <Label f={f} />
          <div className={box(" area")}>
            <textarea className="tin" rows={3} value={String(v ?? "")} placeholder={f.placeholder} {...fx} onChange={(e) => set(e.target.value)} />
          </div>
          {err}
        </div>
      );

    case "color": {
      const c = String(v || "");
      return (
        <div className="fl ddw">
          <Label f={f} />
          <div className={box()}>
            <input className="tin" value={c} placeholder={f.placeholder || "#FFFFFF"} {...fx} onChange={(e) => set(e.target.value)} />
            <i className="sw2 hit" style={{ background: c || "transparent", boxShadow: c ? undefined : "inset 0 0 0 .2vh rgba(255,255,255,.4)" }} onClick={toggle} />
          </div>
          {isOpen && <div className="dd pick"><ColorPicker value={c || "#ffffff"} onChange={(x) => set(x)} format={(f.format as "hex") || "hex"} size="sm" /></div>}
          {err}
        </div>
      );
    }

    case "slider": {
      const min = num(f.min) ?? 0, max = num(f.max) ?? 100, step = f.step ?? 1;
      const val = typeof v === "number" ? v : min;
      const frac = max > min ? (val - min) / (max - min) : 0;
      return (
        <div className="fl">
          <Label f={f} />
          <Slider frac={frac} disabled={f.disabled} onFrac={(fr) => set(Math.min(max, Math.max(min, Math.round((min + fr * (max - min)) / step) * step)))}>
            <div className="row"><span className="L">{min}</span><span className="L" style={{ color: "#fff" }}>{val}</span><span className="L">{max}</span></div>
          </Slider>
          {err}
        </div>
      );
    }

    case "select": {
      const opts = (f.options || []).filter(Boolean);
      const cur = opts.find((o) => o.value === v);
      return (
        <div className="fl ddw">
          <Label f={f} />
          <div className={box(" hit sel" + (isOpen ? " focus" : ""))} onClick={toggle}>
            <span className={cur ? undefined : "ph"}>{cur ? cur.label ?? cur.value : f.placeholder || ""}</span>
            <KitIcon name="down" />
          </div>
          {isOpen && (
            <div className="dd">
              {opts.map((o) => <div key={o.value} className={"ddo" + (o.value === v ? " on" : "")} onClick={() => { set(o.value); p.setOpenDd(null); }}>{o.label ?? o.value}</div>)}
            </div>
          )}
          {err}
        </div>
      );
    }

    case "multi-select": {
      const opts = (f.options || []).filter(Boolean);
      const cur = Array.isArray(v) ? (v as string[]) : [];
      const flip = (val: string) => {
        if (cur.includes(val)) return set(cur.filter((x) => x !== val));
        if (f.maxSelectedValues && cur.length >= f.maxSelectedValues) return;
        set([...cur, val]);
      };
      return (
        <div className="fl ddw">
          <Label f={f} />
          <div className={box(" hit sel" + (isOpen ? " focus" : ""))} style={{ paddingBlock: ".8vh" }} onClick={toggle}>
            {cur.length
              ? <span className="chips">{cur.map((x) => <i className="chip" key={x}><b>{opts.find((o) => o.value === x)?.label ?? x}</b></i>)}</span>
              : <span className="ph">{f.placeholder || ""}</span>}
            <KitIcon name="down" />
          </div>
          {isOpen && (
            <div className="dd">
              {opts.map((o) => (
                <div key={o.value} className={"ddo" + (cur.includes(o.value) ? " on" : "")} onClick={() => flip(o.value)}>
                  <span className={"bx" + (cur.includes(o.value) ? " y" : "")}>{cur.includes(o.value) ? <KitIcon name="check" /> : null}</span>{o.label ?? o.value}
                </div>
              ))}
            </div>
          )}
          {err}
        </div>
      );
    }

    case "date":
    case "date-range": {
      const range = f.type === "date-range";
      const vals = range ? (Array.isArray(v) ? v : [null, null]) : [v];
      return (
        <div className="fl ddw">
          <Label f={f} />
          <div className={range ? "rng" : undefined}>
            {vals.map((x, i) => {
              const d = dateIn(x), key = `${p.id}:${i}`, open = p.openDd === key;
              return (
                <div key={i} style={{ position: "relative", minWidth: 0 }}>
                  <div className={box(" hit sel" + (open ? " focus" : ""))} onClick={() => !f.disabled && p.setOpenDd(open ? null : key)}>
                    <span className={d ? undefined : "ph"}>{d ? dateText(d) : f.placeholder || "DD / MM / YYYY"}</span>
                    <KitIcon name="cal" />
                  </div>
                  {open && <Calendar value={d} min={dateIn(f.min)} max={dateIn(f.max)} onPick={(nd) => {
                    const out = dateOut(nd, f);
                    if (range) { const nv = [...vals]; nv[i] = out; set(nv); } else set(out);
                    p.setOpenDd(null);
                  }} />}
                </div>
              );
            })}
          </div>
          {err}
        </div>
      );
    }

    case "time":
      return (
        <div className="fl">
          <Label f={f} />
          <div className={box()}>
            <input className="tin" value={String(v ?? "")} placeholder={f.placeholder || "HH:MM"} {...fx}
              onChange={(e) => set(e.target.value.replace(/[^\d:]/g, "").slice(0, 5))}
              onBlur={() => {
                setFocus(false);
                const m = String(v ?? "").match(/^(\d{1,2}):?(\d{2})$/);
                if (!m) { if (v) set(null); return; }
                const h = Math.min(23, +m[1]), mi = Math.min(59, +m[2]);
                set(`${pad2(h)}:${pad2(mi)}`);
              }} />
            <KitIcon name="clock" />
          </div>
          {err}
        </div>
      );

    default:
      return (
        <div className="fl">
          <Label f={f} />
          <div className={box()}>
            <input className="tin" type={f.password ? "password" : "text"} value={String(v ?? "")} placeholder={f.placeholder} maxLength={num(f.max)} {...fx} onChange={(e) => set(e.target.value)} />
            {f.icon ? <Ico icon={f.icon} /> : f.password ? <KitIcon name="lock" /> : null}
          </div>
          {err}
        </div>
      );
  }
}

/** The 20-segment slider with its knob; drag anywhere on it. */
function Slider({ frac, onFrac, disabled, children }: { frac: number; onFrac: (f: number) => void; disabled?: boolean; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (x: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (r && r.width) onFrac(Math.min(1, Math.max(0, (x - r.left) / r.width)));
  };
  return (
    <div className="sld hit" ref={ref} style={{ cursor: disabled ? "default" : "pointer" }}
      onPointerDown={(e) => { if (disabled) return; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); at(e.clientX); }}
      onPointerMove={(e) => { if (!disabled && e.buttons & 1) at(e.clientX); }}>
      <Segs n={20} frac={frac} />
      <i className="knob" style={{ left: `${Math.min(1, Math.max(0, frac)) * 100}%` }} />
      {children}
    </div>
  );
}

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

/** A month you can page through; days outside min / max are off. */
function Calendar({ value, min, max, onPick }: { value: Date | null; min: Date | null; max: Date | null; onPick: (d: Date) => void }) {
  const [view, setView] = useState(() => { const d = value || new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const first = (view.getDay() + 6) % 7, days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: ReactNode[] = [];
  for (let i = 0; i < first; i++) cells.push(<span key={"e" + i} />);
  for (let d = 1; d <= days; d++) {
    const date = new Date(view.getFullYear(), view.getMonth(), d);
    const off = (min && date < min) || (max && date > max);
    const on = value && date.toDateString() === value.toDateString();
    cells.push(<span key={d} className={"dy" + (on ? " on" : "") + (off ? " off" : "")} onClick={() => !off && onPick(date)}>{d}</span>);
  }
  const month = view.toLocaleString(undefined, { month: "long", year: "numeric" });
  return (
    <div className="dd cal" style={{ "--i": 0 } as CSSProperties}>
      <div className="calh">
        <span className="hit" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}><KitIcon name="back" /></span>
        <span className="L" style={{ color: "#fff" }}>{month}</span>
        <span className="hit" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}><KitIcon name="chev" /></span>
      </div>
      <div className="grid">{DOW.map((d, i) => <span key={"h" + i} className="L">{d}</span>)}{cells}</div>
    </div>
  );
}
