// lib.keycode, in the 19/10 look: a slanted title plate with the lock, a row of slanted slots (a dot per digit, a
// blinking caret in the next one), the tries left, a 3 x 4 pad (delete, 0, check) and the key strip. A wrong code
// turns the slots red ("Wrong code · 2 tries left"), the right one green ("Unlocked").
//
// Keys: 0-9 type, Backspace deletes, Enter checks, Escape leaves (when the script allows it). With a `length` the
// code is checked as soon as it's full; without one there are as many slots as you've typed (4 at least).
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useNuiEvent } from "../../hooks/useNuiEvent";
import { setUiTheme } from "../../stores/uiTheme";
import { fetchNui } from "../../utils/fetchNui";
import { BkspSvg, KitIcon, KStrip, Layer, tr } from "../Kit";

interface KeycodeData {
  code: string;
  title?: string;
  description?: string;
  multipleTries?: boolean;
  /** how many goes you get (default: 1, or as many as you like with multipleTries) */
  tries?: number;
  allowCancel?: boolean;
  length?: number;
}

type St = "typing" | "wrong" | "right";

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"];
const MAX_FREE = 12; // a code without a length stops taking digits here
const FLASH_MS = 700;

export default function Keycode() {
  const [data, setData] = useState<KeycodeData | null>(null);
  const [entry, setEntry] = useState("");
  const [st, setSt] = useState<St>("typing");
  const [left, setLeft] = useState(1);
  const [hot, setHot] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const responded = useRef(false);
  const hotT = useRef<number | undefined>(undefined);

  const respond = (correct: boolean) => {
    if (responded.current) return;
    responded.current = true;
    setData(null);
    fetchNui("KEYCODE_RESULT", { correct });
  };

  useNuiEvent<KeycodeData>("OPEN_KEYCODE", (incoming) => {
    // Whose colours this belongs to. `App` wraps this component in <Themed>, so the whole thing renders in the
    // calling resource's palette.
    setUiTheme("keycode", (incoming as { theme?: never } | undefined)?.theme);
    responded.current = false;
    const t = Number(incoming.tries);
    setLeft(Number.isFinite(t) && t >= 1 ? Math.floor(t) : incoming.multipleTries ? Infinity : 1);
    setData(incoming);
    setEntry("");
    setSt("typing");
    setN((x) => x + 1);
  });

  // Lets a caller (and the TestBed) dismiss the keypad without an answer: it counts as a wrong one.
  useNuiEvent("CLOSE_KEYCODE", () => {
    setData(null);
    if (!responded.current) {
      responded.current = true;
      fetchNui("KEYCODE_RESULT", { correct: false });
    }
  });

  const len = data && Number(data.length) > 0 ? Math.floor(Number(data.length)) : 0;

  const check = (value: string) => {
    if (!data || st !== "typing" || value === "") return;
    if (value === String(data.code)) {
      setSt("right");
      window.setTimeout(() => respond(true), FLASH_MS);
      return;
    }
    const rest = left - 1;
    setLeft(rest);
    setSt("wrong");
    window.setTimeout(() => {
      if (rest <= 0) { respond(false); return; }
      setEntry("");
      setSt("typing");
    }, FLASH_MS);
  };

  const press = (k: string) => {
    if (!data || st !== "typing") return;
    window.clearTimeout(hotT.current);
    setHot(k);
    hotT.current = window.setTimeout(() => setHot(null), 150);
    if (k === "del") { setEntry((p) => p.slice(0, -1)); return; }
    if (k === "ok") { check(entry); return; }
    const next = entry + k;
    if (next.length > (len || MAX_FREE)) return;
    setEntry(next);
    if (len && next.length >= len) check(next);
  };

  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); if (data.allowCancel !== false) respond(false); return; }
      if (e.key === "Backspace") { e.preventDefault(); press("del"); return; }
      if (e.key === "Enter") { e.preventDefault(); press("ok"); return; }
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!data) return null;

  const slotsN = len || Math.max(4, entry.length + (st === "typing" ? 1 : 0));
  const slots = [];
  for (let i = 0; i < slotsN; i++) {
    const cur = st === "typing" && i === entry.length;
    slots.push(<span key={i} className={"slot" + (cur ? " cur" : "")}><b>{i < entry.length ? "•" : ""}</b></span>);
  }

  const triesText = (k: number) => (k === 1 ? tr("ui.try_left", "1 try left") : tr("ui.tries_left", "%s tries left", k));
  let stat = "";
  if (st === "right") stat = tr("ui.unlocked", "Unlocked");
  else if (st === "wrong") stat = tr("ui.wrong_code", "Wrong code") + (Number.isFinite(left) && left > 0 ? " · " + (left === 1 ? tr("ui.last_try", "last try") : triesText(left)) : "");
  else if (Number.isFinite(left)) stat = triesText(left);

  const desc = data.description || (len ? tr("ui.keycode_digits", "Enter the %s-digit code", len) : tr("ui.keycode_any", "Enter the code"));
  const strip = [
    { kb: "0-9", label: tr("ui.type", "Type") },
    { kb: "BACKSPACE", pad: "B", label: tr("ui.delete", "Delete") },
    { kb: "ENTER", pad: "A", label: tr("ui.check", "Check") },
    ...(data.allowCancel !== false ? [{ kb: "ESC", pad: "BACK", label: tr("ui.leave", "Leave") }] : []),
  ];

  return (
    <Layer live>
      <div className={"dlg kc rise " + st} key={n} style={{ width: "44vh" }}>
        <div className="pl edge wash hd">
          <span className="sk"><KitIcon name="lock" /></span>
          <div className="sk" style={{ minWidth: 0 }}>
            <div className="T">{data.title || "Security Panel"}</div>
            <div className="D">{desc}</div>
          </div>
        </div>
        <div className="panel body">
          <div className="slots">{slots}</div>
          <div className="L stat">{stat || " "}</div>
          <div className="pad">
            {PAD.map((k, i) => (
              <span
                key={k}
                className={"pl rise hit" + (hot === k ? " hot" : "") + (k === "ok" ? " okk" : "") + (k === "del" ? " del" : "")}
                style={{ "--i": i, cursor: "pointer" } as CSSProperties}
                onMouseDown={(e) => { e.preventDefault(); press(k); }}
              >
                <span className="sk">{k === "del" ? <BkspSvg /> : k === "ok" ? <KitIcon name="check" /> : k}</span>
              </span>
            ))}
          </div>
        </div>
        <KStrip rows={strip} />
      </div>
    </Layer>
  );
}
