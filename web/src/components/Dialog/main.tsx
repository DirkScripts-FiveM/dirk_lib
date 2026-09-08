/**
 * Talking to somebody.
 *
 * NOT A PANEL. Whoever you are speaking to is on camera while this is open and
 * their face is doing half the talking, so there is no card and no scrim — a
 * gradient along the bottom with the conversation laid on it.
 *
 * NOTHING MOVES. Their line gets a fixed band whether it runs to one line or
 * four, and the replies are dealt four at a time into a 2x2 that pages rather
 * than grows — a short page keeps its empty cells. A conversation whose buttons
 * walk up the screen between reads is one you misclick.
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
 *   emphasis  the big one — rendered large and scale-pops when its value changes
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
 */
import { alpha, Flex, Text, useMantineTheme } from "@mantine/core";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useNuiEvent } from "../../hooks/useNuiEvent";
import { fetchNui } from "../../utils/fetchNui";
import { locale } from "../../stores/locales";
import type { ResourceTheme } from "../Themed";
import { setUiTheme } from "../../stores/uiTheme";

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
  /** Held in slot one of EVERY page. For the way out of a conversation. */
  pin?: boolean;
  disabled?: boolean;
  empty?: boolean;
  dontClose?: boolean;

  /* ── the card form ──────────────────────────────────────────────────────
   *
   * A reply carrying `image` is drawn as a CARD instead of a line of text:
   * bigger, three across instead of four in a grid, with room for a picture
   * and three lines under it. One card in the list switches the whole row.
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
  /** The quiet second line: where it is, who it is from. */
  sub?: string;
  /** The figure, drawn in the accent. Money, distance, a count. */
  value?: string;
  /** A small chip over the art. The one word you want read first. */
  badge?: string;
  badgeTone?: DialogTone;
};

/** A level and how far into it — the field names `lib.skill.progress` returns. */
export type SkillProps = {
  /** What this standing is CALLED here: "Reputation", "Fishing", a rank name. */
  label?: string;
  level: number;
  xp?: number;
  currentLevelXp?: number;
  nextLevelXp?: number;
  xpToNext?: number;
  /** 0-100. Already clamped by `lib.skill`. */
  progress?: number;
  maxed?: boolean;
  /** A rank NAME instead of a number, when the script has better words. */
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
   * Standing with whoever is talking, as a bar.
   *
   * The shape `lib.skill.progress` returns, plus a label — deliberately, so a
   * caller hands it straight through with nothing to convert and nothing to get
   * out of step:
   *
   *     skill = { label = 'Reputation', unpack of lib.skill.progressFor(...) }
   *
   * Reputation is the first use, but nothing here knows that. Any script with a
   * level worth showing while somebody is talking to you gets the same bar in
   * the same place — which is the point of it living in the dialogue rather
   * than in whichever script asked first.
   */
  skill?: SkillProps;
  responses?: ResponseProps[];
  /** Replaces the replies when there is nothing left to say. */
  note?: string;
  noteTone?: DialogTone;
  /** Hides the way out — for the moment between committing and finding out. */
  locked?: boolean;
  cantClose?: boolean;
  closeLabel?: string;
  clickSounds?: boolean;
  hoverSounds?: boolean;
};

/**
 * Four cells, and a pinned reply always holds the first.
 *
 * Accepting is not one option among the others — it is the way out, and it has
 * to be one click from wherever you are. Left in the paged list, a long list
 * buries it on page two and you have to page BACK to agree to something you had
 * already decided to do.
 */
const PER_PAGE = 4;

/**
 * Cards are wider and taller, so three fit where four lines did.
 *
 * The pinned reply is NOT one of them. It stays a text tile on its own row
 * underneath — it is the way out ("nothing today"), not a fourth offer, and
 * dressing it up as one invites picking it by mistake.
 */
const PER_PAGE_CARDS = 3;

/** Lua's json.encode writes `{}` for an empty table, so an empty list arrives as an object. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Small caps label, used for every field name in the band. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{
      fontFamily: "Akrobat Bold, sans-serif", fontSize: "0.95vh", fontWeight: 700,
      letterSpacing: "0.18em", textTransform: "uppercase",
      color: "rgba(255,255,255,0.42)", lineHeight: 1.2,
    }}>
      {children}
    </Text>
  );
}

function useTone() {
  const theme = useMantineTheme();
  const accent = theme.colors[theme.primaryColor][5];
  return (tone?: DialogTone, fallback = "#fff") => {
    switch (tone) {
      case "ok": return accent;
      case "warn": return theme.colors.yellow[5];
      case "bad": return theme.colors.red[6];
      case "muted": return "rgba(255,255,255,0.7)";
      default: return fallback;
    }
  };
}

/* ── one thing you are being offered ──────────────────────────────────────── */

/**
 * A reply with a picture.
 *
 * Same button, same disabled rules, same pick — only taller and stacked, so a
 * row of three can be read as three THINGS rather than three sentences. The
 * art is given the room and everything else is a caption under it.
 */
function ReplyCard({ reply, disabled, onPick }: {
  reply: ResponseProps; disabled: boolean; onPick: (index: number) => void;
}) {
  const theme = useMantineTheme();
  const accent = theme.colors[theme.primaryColor][5];
  const tone = useTone();
  const hot = !!reply.pin;
  const off = disabled || !!reply.disabled;

  return (
    <motion.button
      type="button"
      disabled={off}
      onClick={() => onPick(reply.index)}
      whileHover={off ? undefined : { background: alpha(accent, 0.13) }}
      whileTap={off ? undefined : { scale: 0.98 }}
      style={{
        display: "flex", flexDirection: "column",
        height: "100%", width: "100%", minWidth: 0, textAlign: "left",
        padding: "0.9vh",
        background: hot ? alpha(accent, 0.1) : "rgba(255,255,255,0.05)",
        border: `0.1vh solid ${hot ? alpha(accent, 0.45) : "rgba(255,255,255,0.1)"}`,
        borderRadius: theme.radius.xs,
        cursor: off ? "not-allowed" : "pointer",
        opacity: off ? 0.4 : 1,
        overflow: "hidden",
      }}
    >
      {/* the art, and the one word over it */}
      <div style={{
        position: "relative", width: "100%", flex: 1, minHeight: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: "0.5vh",
      }}>
        <img
          src={reply.image}
          alt=""
          onError={(e) => {
            const img = e.currentTarget;
            const chain = Array.isArray(reply.imageFallback)
              ? reply.imageFallback
              : reply.imageFallback ? [reply.imageFallback] : [];
            // Counted, so a chain walks forward and a chain that runs out
            // stops. Without it a fallback that is ALSO missing re-enters this
            // handler against itself for as long as the card is up.
            const step = Number(img.dataset.fell ?? 0);
            if (step >= chain.length) return;
            img.dataset.fell = String(step + 1);
            img.src = chain[step]!;
          }}
          style={{
            // Contain, never cover: a silhouette cropped to fill the box stops
            // being the shape that was the whole point of it.
            maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
            opacity: off ? 0.5 : 0.9,
          }}
        />
        {reply.badge && (
          <Text style={{
            position: "absolute", top: 0, left: 0,
            fontFamily: "Akrobat Bold, sans-serif", fontSize: "0.9vh", fontWeight: 700,
            letterSpacing: "0.16em", textTransform: "uppercase",
            color: tone(reply.badgeTone, "rgba(255,255,255,0.5)"),
          }}>
            {reply.badge}
          </Text>
        )}
      </div>

      <Text style={{
        fontSize: "1.3vh", lineHeight: 1.2, color: "#fff",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        width: "100%",
      }}>
        {reply.label}
      </Text>

      {reply.sub && (
        <Text style={{
          fontSize: "1.05vh", lineHeight: 1.3, color: "rgba(255,255,255,0.45)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          width: "100%",
        }}>
          {reply.sub}
        </Text>
      )}

      {reply.value && (
        <Text style={{
          fontFamily: "Akrobat Bold, sans-serif", fontSize: "1.25vh",
          color: accent, marginTop: "0.15vh",
        }}>
          {reply.value}
        </Text>
      )}
    </motion.button>
  );
}

/* ── one thing you can say ────────────────────────────────────────────────── */

function ReplyTile({ reply, disabled, onPick, compact }: {
  reply: ResponseProps; disabled: boolean; onPick: (index: number) => void;
  /** Sized to its words rather than its column. For a reply that sits alone. */
  compact?: boolean;
}) {
  const theme = useMantineTheme();
  const accent = theme.colors[theme.primaryColor][5];
  const hot = !!reply.pin;
  const off = disabled || !!reply.disabled;

  return (
    <motion.button
      type="button"
      disabled={off}
      onClick={() => onPick(reply.index)}
      whileHover={off ? undefined : { background: alpha(accent, hot ? 0.18 : 0.13) }}
      whileTap={off ? undefined : { scale: 0.98 }}
      style={{
        display: "flex", alignItems: "center",
        height: "100%", width: compact ? "auto" : "100%", textAlign: "left",
        padding: "0.9vh 1.3vh",
        background: hot ? alpha(accent, 0.1) : "rgba(255,255,255,0.05)",
        border: `0.1vh solid ${hot ? alpha(accent, 0.45) : "rgba(255,255,255,0.1)"}`,
        borderRadius: theme.radius.xs,
        cursor: off ? "not-allowed" : "pointer",
        opacity: off ? 0.4 : 1,
      }}
    >
      <Text style={{
        fontSize: "1.4vh", lineHeight: 1.28,
        color: hot ? accent : "#fff",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}>
        {reply.label}
      </Text>
    </motion.button>
  );
}

/** An empty slot, so a page of three still has four cells and nothing reflows. */
function EmptyTile() {
  return (
    <div style={{
      border: "0.1vh dashed rgba(255,255,255,0.05)",
      borderRadius: "0.3vh", height: "100%",
    }} />
  );
}

function Pager({ dir, shown, onClick }: {
  dir: "left" | "right"; shown: boolean; onClick: () => void;
}) {
  const theme = useMantineTheme();
  return (
    <motion.button
      // Remounted when it appears or disappears.
      //
      // It is hidden rather than removed, so the pointer never "leaves" it and
      // framer keeps the hover background it had when it went. It then came
      // back on the next page still lit, wherever the mouse actually was.
      key={shown ? "on" : "off"}
      type="button"
      onClick={onClick}
      whileTap={shown ? { scale: 0.94 } : undefined}
      whileHover={shown ? { background: "rgba(255,255,255,0.09)" } : undefined}
      style={{
        // Hidden, never removed. Taking the arrow out of the flow on the first
        // page would slide every reply sideways the moment you paged.
        visibility: shown ? "visible" : "hidden",
        // And not a hit target while it is hidden.
        pointerEvents: shown ? "auto" : "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "2.6vh", flex: "none", alignSelf: "stretch",
        background: "rgba(0,0,0,0.3)",
        border: "0.1vh solid rgba(255,255,255,0.12)",
        borderRadius: theme.radius.xs,
        color: "rgba(255,255,255,0.5)",
        fontSize: "1.5vh", lineHeight: 1,
        cursor: "pointer",
      }}
    >
      {dir === "left" ? "‹" : "›"}
    </motion.button>
  );
}

/** Text in one of the four tones. */
function ToneText({ tone: t, fallback, style, children }: {
  tone?: DialogTone; fallback: string;
  style?: React.CSSProperties; children: React.ReactNode;
}) {
  const tone = useTone();
  return <Text style={{ ...style, color: tone(t, fallback) }}>{children}</Text>;
}

/* ── one readout on the right ─────────────────────────────────────────────── */

/**
 * Standing with the person in front of you, as a rank and a bar.
 *
 * Sits with the other readouts rather than anywhere new, because it IS one —
 * the same "here is a number about this conversation" as the price or the mood.
 * It just happens to be a number with a distance to the next one, and that
 * distance is the part worth drawing: a rank on its own says where you are,
 * the bar says whether another job gets you anywhere.
 *
 * Animated on the FILL, keyed on the level. A level-up therefore reads as the
 * bar emptying and the number stepping up, without the caller having to
 * orchestrate anything or diff before against after — which is what fishing's
 * two reward screens each do by hand, differently.
 */
function SkillReadout({ skill }: { skill: SkillProps }) {
  const theme = useMantineTheme();
  const accent = theme.colors[theme.primaryColor][5];
  const pct = Math.min(100, Math.max(0, skill.progress ?? 0));

  return (
    <Flex direction="column" align="flex-end" gap="0.2vh" style={{ minWidth: "11vh" }}>
      <Key>{skill.label ?? "Standing"}</Key>

      <motion.div
        key={skill.level}
        initial={{ scale: 1.16 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
      >
        <Text style={{
          fontFamily: "Akrobat Bold, sans-serif", fontWeight: 700,
          fontSize: "1.75vh", lineHeight: 1.15, color: "#fff",
        }}>
          {skill.rankLabel ?? skill.level}
        </Text>
      </motion.div>

      <div style={{
        width: "100%", height: "0.4vh", marginTop: "0.25vh",
        background: "rgba(255,255,255,0.12)", borderRadius: "0.2vh",
        overflow: "hidden",
      }}>
        {/*
          Grows from EMPTY on open.

          Without an explicit `initial`, framer takes the element's laid-out
          width as the start — which for a bar in a flex row is whatever it
          happened to be — and animates from there. Opening a dialogue therefore
          showed the bar sliding DOWN to the real figure, as though standing
          had just been taken off you.
        */}
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${skill.maxed ? 100 : pct}%` }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          style={{ height: "100%", background: accent, borderRadius: "0.2vh" }}
        />
      </div>

      {/* The number under the bar, only when it says something. At the top of
          the ladder there is no "to next", and a 0 there reads as a bug. */}
      <Text style={{
        fontFamily: "Akrobat SemiBold, sans-serif", fontSize: "0.95vh",
        letterSpacing: "0.08em", textTransform: "uppercase",
        color: "rgba(255,255,255,0.34)",
      }}>
        {skill.maxed
          ? "Highest"
          : skill.xpToNext !== undefined ? `${Math.max(0, Math.round(skill.xpToNext))} to go` : ""}
      </Text>
    </Flex>
  );
}

function Readout({ row }: { row: MetadataProps }) {
  const tone = useTone();
  const value = row.value ?? row.data ?? "";

  const body = (
    <Text style={{
      fontFamily: "Akrobat Bold, sans-serif",
      fontWeight: 700,
      fontSize: row.emphasis ? "3vh" : "1.75vh",
      lineHeight: row.emphasis ? 1.05 : 1.15,
      color: tone(row.tone, row.strike ? "rgba(255,255,255,0.34)" : "#fff"),
      textDecoration: row.strike ? "line-through" : undefined,
    }}>
      {value}
    </Text>
  );

  return (
    <Flex direction="column" align="flex-end" gap="0.2vh">
      <Key>{row.label}</Key>
      {row.emphasis ? (
        // Keyed on the VALUE, so it pops when the number changes and sits still
        // when the state updates for any other reason.
        <motion.div
          key={value}
          initial={{ scale: 1.16 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          {body}
        </motion.div>
      ) : body}
    </Flex>
  );
}

/* ── the band ─────────────────────────────────────────────────────────────── */

export default function Dialog() {
  const theme = useMantineTheme();
  const bad = theme.colors.red[6];

  const [data, setData] = useState<IDialogProps | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);

  useNuiEvent<IDialogProps | null>("DIALOG_STATE", (next) => {
    // Reported rather than applied here: `App` wraps this whole component, so
    // the hooks in its body see the caller's palette too.
    setUiTheme("dialog", next?.theme);
    setData(next ?? null);
    setBusy(false);
    // A brand new conversation starts on page one; a state update within the
    // same one leaves you where you were reading.
    setPage((p) => (next && data && next.id === data.id ? p : 0));
  });

  const locked = busy || !!data?.locked;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!data || locked || data.cantClose) return;
      setData(null);
      fetchNui("DIALOG_SELECTED", { index: "close" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, locked]);

  if (!data) return null;

  const rows = asArray<MetadataProps>(data.metadata);
  const all = asArray<ResponseProps>(data.responses).filter((r) => !r.empty);

  const pinned = all.find((r) => r.pin);
  const rest = all.filter((r) => !r.pin);

  // ONE reply with a picture puts the whole row into card mode. A row that was
  // half cards and half lines would be two different kinds of answer sharing a
  // grid, and neither would read.
  const cards = rest.some((r) => !!r.image);

  const perPage = cards ? PER_PAGE_CARDS : (pinned ? PER_PAGE - 1 : PER_PAGE);

  const pages = Math.max(1, Math.ceil(rest.length / perPage));
  const current = Math.min(page, pages - 1);
  const shown = rest.slice(current * perPage, current * perPage + perPage);
  const filled = shown.length + (pinned && !cards ? 1 : 0);

  const pick = (index: number) => {
    if (locked) return;
    // Held until something arrives. Every pick ends in either a close or a
    // fresh DIALOG_STATE, and both clear it — so a second click cannot land
    // while a server-driven answer is still in flight.
    setBusy(true);
    fetchNui("DIALOG_SELECTED", { index });
  };

  const close = () => {
    if (locked) return;
    setData(null);
    fetchNui("DIALOG_SELECTED", { index: "close" });
  };

  return (
    <AnimatePresence>
      <motion.div
        key="dialog"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9000,
          // Nothing here is text you copy. Dragging across a conversation and
          // highlighting half of it reads like a web page, not a game.
          userSelect: "none",
          // Only where the words are. Their face is the other half of this.
          background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.76) 34%,"
            + " rgba(0,0,0,0.3) 70%, transparent 100%)",
          paddingTop: "9vh",
          pointerEvents: "none",
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 14 }}
          transition={{ duration: 0.26, ease: "easeOut" }}
          style={{
            width: "100%", maxWidth: "128vh", margin: "0 auto",
            padding: "0 4vh 3.6vh", pointerEvents: "auto",
          }}
        >
          {/* ── who, and whatever the caller wants beside them ── */}
          <Flex justify="space-between" align="flex-end" gap="3vh">
            <Flex direction="column" gap="0.3vh" style={{ minWidth: 0 }}>
              <Text style={{
                fontFamily: "Akrobat Bold, sans-serif", fontSize: "2.1vh",
                lineHeight: 1.1, color: "#fff",
              }} truncate>
                {data.title}
              </Text>
              {!!data.subtitle && (
                <Text style={{
                  fontFamily: "Akrobat SemiBold, sans-serif", fontSize: "1.05vh",
                  letterSpacing: "0.14em", textTransform: "uppercase",
                  color: "rgba(255,255,255,0.42)",
                }} truncate>
                  {data.subtitle}
                </Text>
              )}
            </Flex>

            {(rows.length > 0 || !!data.skill) && (
              <Flex align="flex-end" gap="2.4vh" style={{ flex: "none" }}>
                {rows.map((row, i) => <Readout key={`${row.label}-${i}`} row={row} />)}
                {!!data.skill && <SkillReadout skill={data.skill} />}
              </Flex>
            )}
          </Flex>

          {/* ── what they just said ──
              Fixed height: a four-line answer and a one-line answer take the
              same room, so nothing below them ever moves. */}
          <Flex align="center" style={{ height: "7.4vh", marginTop: "1.2vh" }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={data.dialog}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.2 }}
                style={{ width: "100%" }}
              >
                <ToneText
                  tone={data.dialogTone}
                  fallback="rgba(255,255,255,0.9)"
                  style={{
                    fontSize: "1.85vh", lineHeight: 1.4, fontStyle: "italic",
                    maxWidth: "62ch",
                    textShadow: "0 0.1vh 1.4vh rgba(0,0,0,0.9)",
                  }}
                >
                  {`“${data.dialog}”`}
                </ToneText>
              </motion.div>
            </AnimatePresence>
          </Flex>

          {/* ── what you can say ── */}
          <Flex gap="0.8vh" style={{ height: cards ? "20vh" : "11.4vh", marginTop: "0.6vh" }}>
            <Pager
              dir="left"
              shown={pages > 1 && current > 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            />

            <Flex direction="column" gap="0.8vh" style={{ flex: 1, minWidth: 0, maxWidth: "74vh" }}>
              <div style={{
                flex: 1, minHeight: 0,
                display: "grid",
                gridTemplateColumns: cards ? "1fr 1fr 1fr" : "1fr 1fr",
                gridTemplateRows: cards ? "1fr" : "1fr 1fr",
                gap: "0.8vh",
              }}>
                {data.note ? (
                  <Flex align="center" style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}>
                    <ToneText
                      tone={data.noteTone}
                      fallback="rgba(255,255,255,0.45)"
                      style={{ fontSize: "1.6vh" }}
                    >
                      {data.note}
                    </ToneText>
                  </Flex>
                ) : cards ? (
                  <>
                    {shown.map((r) => (
                      <ReplyCard key={r.index} reply={r} disabled={locked} onPick={pick} />
                    ))}
                    {Array.from({ length: Math.max(0, PER_PAGE_CARDS - shown.length) }, (_, i) => (
                      <EmptyTile key={`gap${i}`} />
                    ))}
                  </>
                ) : (
                  <>
                    {pinned && (
                      <ReplyTile key={`pin-${pinned.index}`} reply={pinned} disabled={locked} onPick={pick} />
                    )}
                    {shown.map((r) => (
                      <ReplyTile key={r.index} reply={r} disabled={locked} onPick={pick} />
                    ))}
                    {Array.from({ length: Math.max(0, PER_PAGE - filled) }, (_, i) => (
                      <EmptyTile key={`gap${i}`} />
                    ))}
                  </>
                )}
              </div>

              {/* The way out, under the offers rather than among them.
                  Sized to its own words and pushed to the end: stretched
                  across all three it read as a fourth, larger choice, and it
                  would go on reading that way however many offers there are. */}
              {cards && pinned && !data.note && (
                <Flex justify="flex-end" style={{ height: "3.4vh", flexShrink: 0 }}>
                  <ReplyTile key={`pin-${pinned.index}`} reply={pinned} disabled={locked} onPick={pick} compact />
                </Flex>
              )}
            </Flex>

            <Pager
              dir="right"
              shown={pages > 1 && current < pages - 1}
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            />
          </Flex>

          {/* ── out ── */}
          {!data.cantClose && (
            <Flex justify="flex-end" style={{ marginTop: "1.2vh" }}>
              <motion.button
                type="button"
                onClick={close}
                disabled={locked}
                whileHover={locked ? undefined : { background: alpha(bad, 0.16) }}
                whileTap={locked ? undefined : { scale: 0.97 }}
                style={{
                  // Hidden, never unmounted. Pulling it out of the flow would
                  // move the row it sits in at the exact moment a deal lands.
                  visibility: locked ? "hidden" : "visible",
                  fontFamily: "Akrobat Bold, sans-serif", fontSize: "1.25vh",
                  letterSpacing: "0.09em", textTransform: "uppercase",
                  padding: "0.8vh 1.5vh", borderRadius: theme.radius.xs,
                  background: "rgba(0,0,0,0.3)",
                  border: `0.1vh solid ${alpha(bad, 0.34)}`,
                  color: alpha(bad, 0.92),
                  cursor: "pointer",
                }}
              >
                {data.closeLabel || locale("dialog.close")}
              </motion.button>
            </Flex>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
