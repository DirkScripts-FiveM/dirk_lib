/**
 * Talking to somebody, in the 19/10 look.
 *
 * NOT A PANEL. Whoever you are speaking to is on camera while this is open and
 * their face is doing half the talking, so there is no card and no scrim — a
 * gradient along the bottom with the conversation laid on it: who it is on a
 * slanted plate, what they just said as a quote, your replies in a 2 x 2 with
 * their keys (1-4, A / B / X / Y on a pad), the pinned reply on its own row
 * (Space / RT), and the readouts in a column on the right.
 *
 * NOTHING MOVES. Everything is anchored to the bottom of the screen, and a page
 * of replies that is short keeps its empty cells when there is more than one
 * page. A conversation whose buttons walk up the screen between reads is one
 * you misclick.
 *
 * The one thing ALLOWED to move is an emphasised readout, because watching a
 * number change is the payoff for the line you just picked.
 *
 * ── the right-hand column ───────────────────────────────────────────────────
 *
 * `metadata` is whatever the caller wants it to be. A haggle puts the asking
 * price, the price on the table and the seller's mood there; a scrapyard could
 * put your rep and how full the basket is. Three flags shape a row and nothing
 * about any particular script is known here:
 *
 *   emphasis  the big one — in the accent, and it pops when its value changes
 *   strike    struck through, for a figure that has been beaten
 *   tone      ok | warn | bad | muted, for colour
 *
 * ── who decides ─────────────────────────────────────────────────────────────
 *
 * Both. A dialogue whose responses carry `action` is client-driven and behaves
 * as it always has. One that declares `onSelect` is SERVER-DRIVEN: the pick
 * goes up, a whole new state comes back, and this renders it. The second is
 * what anything with money in it wants, because then nothing on this side of
 * the wire can be argued with.
 *
 * ── keys ────────────────────────────────────────────────────────────────────
 *
 * 1-4 pick the replies on the page, Space the pinned one, Q / E turn the page,
 * Esc walks away. A pad shows its buttons on the caps (glyphs only).
 */
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useNuiEvent } from "../../hooks/useNuiEvent";
import { locale } from "../../stores/locales";
import { setUiTheme } from "../../stores/uiTheme";
import { fetchNui } from "../../utils/fetchNui";
import { Key, KitIcon, KStrip, Layer, md, Segs, tr } from "../Kit";
import type { ResourceTheme } from "../Themed";
import "./dialog.css";

export type DialogTone = "ok" | "warn" | "bad" | "muted";

export type MetadataProps = {
  label: string;
  /** `value` is the field. `data` is the old name and still read. */
  value?: string;
  data?: string;
  tone?: DialogTone;
  emphasis?: boolean;
  strike?: boolean;
};

export type ResponseProps = {
  index: number;
  label: string;
  /** Held on its own row under the others, on every page. For the way out of a conversation. */
  pin?: boolean;
  disabled?: boolean;
  empty?: boolean;
  dontClose?: boolean;

  /* ── the card form ──────────────────────────────────────────────────────
   *
   * A reply carrying `image` is drawn as a CARD instead of a line of text:
   * a picture with three lines under it, four across. One card in the list
   * switches the whole row.
   *
   * It exists because some replies are not things you SAY, they are things
   * you are being OFFERED — three cars a scrapyard wants collecting, three
   * contracts, three boats. Told as text those read as three near-identical
   * sentences you have to parse; as cards you pick one at a glance.
   *
   * Any `src` the page can load. A `nui://<resource>/…` URL keeps the art in
   * the script it belongs to — dirk_lib must never learn what a scrapyard
   * job looks like — and a data: URI works for something generated.
   */
  image?: string;
  /**
   * What to draw when `image` will not load.
   *
   * Art for a specific thing usually comes off a service that has never heard
   * of half of what a server runs — a custom car, a model somebody renamed —
   * and a card with a broken picture in it is worse than one with a shape. So
   * the caller names the specific art AND something generic that always
   * exists, and the card falls back on its own.
   *
   * A LIST is tried in order, because the real chain is usually more than two
   * links: what this server put in its own folder, then whatever service it
   * points at, then a shape that is drawn rather than fetched.
   */
  imageFallback?: string | string[];
  /** The quiet second line: where it is, who it is from (on a text reply: why it's locked). */
  sub?: string;
  /** The figure, drawn in the accent. Money, distance, a count. */
  value?: string;
  /** A small chip over the art. The one word you want read first. */
  badge?: string;
  badgeTone?: DialogTone;
};

/** A level and how far into it — the field names `lib.skill.progress` returns. */
export type SkillProps = {
  /** What this standing is CALLED here: "Reputation", "Fishing", "Haggling". */
  label?: string;
  level: number;
  xp?: number;
  currentLevelXp?: number;
  nextLevelXp?: number;
  xpToNext?: number;
  /** 0-100. Already clamped by `lib.skill`. */
  progress?: number;
  maxed?: boolean;
  /** A rank NAME instead of the number, when the script has better words. */
  rankLabel?: string;
};

export type IDialogProps = {
  id: string;
  /**
   * The calling resource's palette, sent by the Lua side. Absent for a
   * resource with no override of its own, which then renders in dirk_lib's
   * theme exactly as before.
   */
  theme?: ResourceTheme | null;
  /** Who is talking. */
  title: string;
  /** Where you are, what this is about — the quiet line under the name. */
  subtitle?: string;
  /** What they just said. */
  dialog: string;
  /** Tone for that line, for a refusal that should not read like a greeting. */
  dialogTone?: DialogTone;
  metadata?: MetadataProps[];
  /**
   * Standing with whoever is talking, as a bar under the readouts.
   *
   * The shape `lib.skill.progress` returns, plus a label — deliberately, so a
   * caller hands it straight through with nothing to convert:
   *
   *     skill = { label = 'Reputation', unpack of lib.skill.progressFor(...) }
   */
  skill?: SkillProps;
  responses?: ResponseProps[];
  /**
   * A line under the replies (a hint: "He drops a little every time you push").
   * With no replies left it takes their place, for when there is nothing left to say.
   */
  note?: string;
  noteTone?: DialogTone;
  /** Hides the way out — for the moment between committing and finding out. */
  locked?: boolean;
  cantClose?: boolean;
  closeLabel?: string;
  clickSounds?: boolean;
  hoverSounds?: boolean;
};

/** Four replies a page: the four keys (1-4 / A B X Y). The pinned one is extra, on its own row. */
const PER_PAGE = 4;
const PAD_BTN = ["A", "B", "X", "Y"];

/**
 * A list of entries, with the holes taken out.
 *
 * Being an array is not enough. Lua builds these, and a table constructor with
 * a conditional in it — `{ a and x or nil, b and y or nil }` — leaves a HOLE
 * rather than a shorter list. That crosses the boundary as `[null, {...}]`,
 * and the first thing this component does with a response is read a field off
 * it, so one nil in a caller's table took the entire dialogue down with a
 * "Cannot read properties of null". (Lua's json.encode also writes `{}` for an
 * empty table, so an empty list can arrive as an object.)
 *
 * Every caller is a different resource, so the shape cannot be enforced at the
 * source — only defended against here. Dropping the empties is also the
 * behaviour the caller plainly INTENDED: a conditional entry that did not
 * apply is an entry that should not be in the list.
 */
function asArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry !== null && entry !== undefined) as T[];
}

/** The tone as a class: ok -> good (green), bad -> bad (red), warn, muted. */
const toneCls = (t?: DialogTone) => (t === "ok" ? " good" : t === "bad" ? " bad" : t === "warn" ? " warn" : t === "muted" ? " muted" : "");

/** A card's picture, walking the fallback chain when one won't load. */
function CardArt({ reply }: { reply: ResponseProps }) {
  if (!reply.image) return null;
  return (
    <img
      src={reply.image}
      alt=""
      onError={(e) => {
        const img = e.currentTarget;
        const chain = Array.isArray(reply.imageFallback)
          ? reply.imageFallback
          : reply.imageFallback ? [reply.imageFallback] : [];
        // Counted, so a chain walks forward and a chain that runs out stops.
        // Without it a fallback that is ALSO missing re-enters this handler
        // against itself for as long as the card is up.
        const step = Number(img.dataset.fell ?? 0);
        if (step >= chain.length) { img.style.visibility = "hidden"; return; }
        img.dataset.fell = String(step + 1);
        img.src = chain[step]!;
      }}
    />
  );
}

/** Standing with the person in front of you: its name, the level chip, the XP into it and a 10-segment bar. */
function Skill({ skill, i }: { skill: SkillProps; i: number }) {
  const frac = skill.maxed ? 1 : Math.min(100, Math.max(0, Number(skill.progress) || 0)) / 100;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const xp = num(skill.xp), cur = num(skill.currentLevelXp), nxt = num(skill.nextLevelXp), toNext = num(skill.xpToNext);
  // "120 / 300 XP" when the level's span is known; else what's left to the next; nothing at the top
  // (a 0 there reads as a bug)
  let right = "";
  if (skill.maxed) right = tr("dialog.maxLevel", "Max level");
  else if (xp !== null && cur !== null && nxt !== null && nxt > cur) right = `${Math.round(xp - cur)} / ${Math.round(nxt - cur)} XP`;
  else if (toNext !== null) right = tr("dialog.toNext", "%s to level %s", String(Math.max(0, Math.round(toNext))), String(skill.level + 1));
  return (
    <div className="pl skill in" style={{ "--i": i } as CSSProperties}>
      <div className="sk">
        <div className="barTop">
          <span className="L" style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
            <span className="nm">{skill.label ?? tr("dialog.standing", "Standing")}</span>
            {/* keyed on the level: a level-up lands with a pop instead of the number silently changing */}
            <span className="lv" key={skill.level}><b>{skill.rankLabel ?? `${tr("dialog.lvl", "Lv")} ${skill.level}`}</b></span>
          </span>
          {right && <span className="L">{right}</span>}
        </div>
        <Segs n={10} frac={frac} />
      </div>
    </div>
  );
}

export default function Dialog() {
  const [data, setData] = useState<IDialogProps | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [n, setN] = useState(0);

  useNuiEvent<IDialogProps | null>("DIALOG_STATE", (next) => {
    // Reported rather than applied here: `App` wraps this whole component, so
    // the hooks in its body see the caller's palette too.
    setUiTheme("dialog", next?.theme);
    // A brand new conversation starts on page one; a state update within the
    // same one leaves you where you were reading.
    const same = !!(next && data && next.id === data.id);
    setPage((p) => (same ? p : 0));
    if (!same) setN((x) => x + 1);
    setData(next ?? null);
    setBusy(false);
  });

  const locked = busy || !!data?.locked;

  const rows = data ? asArray<MetadataProps>(data.metadata) : [];
  const all = data ? asArray<ResponseProps>(data.responses).filter((r) => !r.empty) : [];
  const pinned = all.find((r) => r.pin);
  const rest = all.filter((r) => !r.pin);
  // ONE reply with a picture puts the whole row into card mode. A row that was
  // half cards and half lines would be two different kinds of answer sharing a
  // grid, and neither would read.
  const cards = rest.some((r) => !!r.image);
  const pages = Math.max(1, Math.ceil(rest.length / PER_PAGE));
  const current = Math.min(page, pages - 1);
  const shown = rest.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);

  const pick = (r?: ResponseProps) => {
    if (!r || locked || r.disabled) return;
    // Held until something arrives. Every pick ends in either a close or a
    // fresh DIALOG_STATE, and both clear it — so a second click cannot land
    // while a server-driven answer is still in flight.
    setBusy(true);
    fetchNui("DIALOG_SELECTED", { index: r.index });
  };

  const close = () => {
    if (!data || locked || data.cantClose) return;
    setData(null);
    fetchNui("DIALOG_SELECTED", { index: "close" });
  };

  const turn = (d: number) => setPage(Math.max(0, Math.min(pages - 1, current + d)));

  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (/^[1-4]$/.test(e.key)) { e.preventDefault(); pick(shown[Number(e.key) - 1]); return; }
      if (e.key === " ") { e.preventDefault(); pick(pinned); return; }
      const k = e.key.toLowerCase();
      if (k === "q" && pages > 1) turn(-1);
      if (k === "e" && pages > 1) turn(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!data) return null;

  const who = (
    <div className="who in">
      <div className="pl edge wash pp">
        <div className="sk">
          <div className="T">{data.title}</div>
          {!!data.subtitle && <div className="L">{data.subtitle}</div>}
        </div>
      </div>
    </div>
  );
  const line = (
    <div className={"line rise" + toneCls(data.dialogTone)} key={data.dialog}>
      <q>{data.dialog}</q>
    </div>
  );

  const rep = (r: ResponseProps, i: number, kb: string, pad: string) => (
    <div
      key={`r${r.index}`}
      className={"pl rep in hit" + (hover === r.index && !r.disabled ? " on" : "") + (r.pin ? " pin" : "") + (r.disabled ? " lock" : "")}
      style={{ "--i": i } as CSSProperties}
      onMouseEnter={() => setHover(r.index)}
      onMouseLeave={() => setHover((h) => (h === r.index ? null : h))}
      onClick={() => pick(r)}
    >
      <div className="sk">
        <Key kb={kb} pad={pad} />
        <span className="tx">{md(r.label)}{r.sub && <small>{r.sub}</small>}</span>
        {r.disabled && <KitIcon name="lock" />}
      </div>
    </div>
  );

  const pinRow = pinned ? rep(pinned, PER_PAGE, "SPACE", "RT") : null;
  // with more than one page a short page keeps its cells, so paging never moves anything
  const gaps = pages > 1 ? PER_PAGE - shown.length : 0;
  const noReplies = all.length === 0;
  const note = data.note ? <span className={"nt" + toneCls(data.noteTone)}>{data.note}</span> : null;

  return (
    <Layer live>
      <div className={"npc" + (locked ? " busy" : "") + (data.locked ? " locked" : "")} key={n}>
        <div className={"say" + (cards ? " row" : "")}>
          {who}
          {line}
        </div>

        {(rows.length > 0 || !!data.skill) && (
          <div className="side">
            {rows.map((m, i) => {
              const v = m.value ?? m.data ?? "";
              const cls = (m.emphasis ? " em" : "") + (m.strike ? " strike" : "") + toneCls(m.tone);
              return (
                <div key={`${m.label}-${i}`} className={"pl md in" + cls} style={{ "--i": i } as CSSProperties}>
                  <span className="sk L">{m.label}</span>
                  {/* keyed on the VALUE, so the big one pops when the number changes and sits still otherwise */}
                  <span className={"sk V" + (m.emphasis ? " pop" : "")} key={m.emphasis ? v : undefined}>{v}</span>
                </div>
              );
            })}
            {!!data.skill && <Skill skill={data.skill} i={rows.length} />}
          </div>
        )}

        {noReplies ? (
          note && <div className="ntbig in">{note}</div>
        ) : cards ? (
          <>
            <div className="cards">
              {shown.map((r, i) => (
                <div
                  key={`c${r.index}`}
                  className={"card in hit" + (hover === r.index && !r.disabled ? " on" : "") + (r.disabled ? " off" : "")}
                  style={{ "--i": i } as CSSProperties}
                  onMouseEnter={() => setHover(r.index)}
                  onMouseLeave={() => setHover((h) => (h === r.index ? null : h))}
                  onClick={() => pick(r)}
                >
                  <div className="im"><CardArt reply={r} /></div>
                  {r.badge && <span className={"badge" + toneCls(r.badgeTone)}><b>{r.badge}</b></span>}
                  <Key kb={String(i + 1)} pad={PAD_BTN[i]} sm />
                  <div className="bd">
                    <div className="T">{r.label}</div>
                    {r.sub && <div className="L">{r.sub}</div>}
                    {r.value && <div className="V">{r.value}</div>}
                  </div>
                  {r.disabled && <KitIcon name="lock" className="lk" />}
                </div>
              ))}
              {Array.from({ length: gaps }, (_, i) => <div key={`g${i}`} className="card gap" />)}
            </div>
            {pinRow && <div className="pinrow">{pinRow}</div>}
          </>
        ) : (
          <div className="reps">
            {shown.map((r, i) => rep(r, i, String(i + 1), PAD_BTN[i]))}
            {Array.from({ length: gaps }, (_, i) => <div key={`g${i}`} className="rep gap" />)}
            {pinRow}
          </div>
        )}

        {pages > 1 ? (
          <div className="pager">
            <span className="hit pgk" onClick={() => turn(-1)} style={{ opacity: current > 0 ? 1 : 0.35 }}><Key kb="Q" pad="LB" sm /></span>
            <span className="L" style={{ color: "#fff" }}>{current + 1} / {pages}</span>
            <span className="hit pgk" onClick={() => turn(1)} style={{ opacity: current < pages - 1 ? 1 : 0.35 }}><Key kb="E" pad="RB" sm /></span>
            {!noReplies && note && <span className="note2">{note}</span>}
          </div>
        ) : (
          !noReplies && note && <div className="note">{note}</div>
        )}

        {!data.cantClose && (
          // Hidden, never unmounted: pulling it out would move the row it sits in at the exact moment a deal lands.
          <div className="close hit" onClick={close} style={locked ? { visibility: "hidden" } : undefined}>
            <KStrip rows={[{ kb: "ESC", pad: "BACK", label: data.closeLabel || tr("dialog.close", "Close") }]} />
          </div>
        )}
      </div>
    </Layer>
  );
}
