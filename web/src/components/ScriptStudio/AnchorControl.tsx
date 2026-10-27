/**
 * A place on the screen, drawn as a place on the screen.
 *
 * Nine positions. The values are a plain enum, so a dropdown would work — and
 * it is the wrong control, because it asks you to read "middle right", picture
 * it, and then picture what it does to a design you cannot see. A screen with a
 * block in the corner is the answer already.
 *
 * There is no tenth "leave it alone" choice. Until a position is stored the
 * design's own layout IS the answer, so the cell it occupies is lit — outlined
 * rather than filled, which is the whole difference between "this is where it
 * happens to be" and "this is where I have pinned it".
 *
 * Built in rather than shipped by the script that wanted it first. A resource
 * CAN ship its own control with `x-component`, but that path renders in a
 * full-height pane meant for a map or a card grid — it took a whole section
 * to itself and left the other five settings below the fold. This is a field
 * like any other field, in the row with its label, at `x-control: "anchor"`.
 *
 * Any design-driven script has the same setting (chat, the loading screen, a
 * HUD), so it belongs here with `camera` and `discordChannel` rather than in
 * whichever one of them asked first.
 */
import { Flex, Text, useMantineTheme } from '@mantine/core';
import { motion } from 'framer-motion';

/** Reading order. Matches dirk-ui-studio's `DESIGN_ANCHORS`. */
const ANCHORS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

/**
 * Stored before anything was chosen, and never shown as a choice.
 *
 * "Leave it where it was drawn" is not a tenth position — it is what the design
 * already says, so the grid lights the cell the design occupies instead of
 * offering a mode nobody can point at. The host publishes that cell through
 * `x-anchorHintFrom`; this is only the value that means "it has not been
 * overridden", and older installs stored it literally.
 */
const AS_DRAWN = 'as-drawn';

const ALIGN: Record<string, 'flex-start' | 'center' | 'flex-end'> = {
  top: 'flex-start', middle: 'center', bottom: 'flex-end',
  left: 'flex-start', center: 'center', right: 'flex-end',
};

export type AnchorOption = { value: string; label: string };

export function AnchorControl({
  value, onChange, disabled, options, hint,
}: {
  value: unknown;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** `x-enumLabels`, already localised by the schema reader */
  options?: AnchorOption[];
  /**
   * Where the thing being placed ALREADY sits, from `x-anchorHintFrom`.
   *
   * It is what the grid shows until a position is pinned. Without it the grid
   * is nine identical empty cells that only mean something once you have
   * changed them, which is the wrong way round.
   */
  hint?: string | null;
}) {
  const theme = useMantineTheme();
  const accent = theme.colors[theme.primaryColor][5];

  const raw = String(value ?? '');
  const stored = ANCHORS.includes(raw) ? raw : null;
  // Nothing stored yet → the design's own position IS the value, so the grid
  // shows that rather than nine blank cells and a word nobody can select.
  const current = stored ?? (hint && ANCHORS.includes(hint) ? hint : null);
  const following = stored === null && current !== null;
  const label = (v: string) =>
    options?.find((o) => o.value === v)?.label
    ?? v.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join(' ');

  const line = alphaLine(0.14);
  const faint = alphaLine(0.3);

  return (
    <Flex align="center" gap="1vh" justify="flex-end" style={{ width: '32vh', flexShrink: 0 }}>
      <Text
        ff="Akrobat Bold"
        style={{ fontSize: '1.25vh', color: following ? 'rgba(255,255,255,0.6)' : accent, textAlign: 'right' }}
      >
        {current ? label(current) : ''}
      </Text>

      {/* One screen with nine places in it — a single outline with hairline
          dividers, not nine separate buttons, so it reads as a screen. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 3.4vh)',
          gridTemplateRows: 'repeat(3, 2vh)',
          gap: '0.1vh',
          padding: '0.1vh',
          background: line,
          border: `0.1vh solid ${line}`,
          borderRadius: '0.5vh',
          overflow: 'hidden',
          opacity: disabled ? 0.4 : 1,
          flexShrink: 0,
        }}
      >
        {ANCHORS.map((anchor) => {
          const [y, x] = anchor.split('-');
          const on = anchor === current;
          return (
            <motion.button
              key={anchor}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={label(anchor)}
              title={label(anchor)}
              onClick={() => !disabled && onChange(anchor)}
              whileTap={disabled ? undefined : { scale: 0.92 }}
              style={{
                display: 'flex',
                alignItems: ALIGN[y],
                justifyContent: ALIGN[x],
                padding: '0.3vh',
                border: 'none',
                background: on ? alpha(accent, following ? 0.1 : 0.18) : 'rgba(0,0,0,0.35)',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              <div
                style={{
                  width: '1vh',
                  height: '0.55vh',
                  borderRadius: '0.15vh',
                  // Filled means PINNED, outlined means "this is simply where the
                  // design sits". Same cell either way, and the difference only
                  // shows the day somebody makes a different design live.
                  background: on && !following ? accent : following && on ? 'transparent' : faint,
                  border: following && on ? `0.1vh solid ${alpha(accent, 0.8)}` : undefined,
                }}
              />
            </motion.button>
          );
        })}
      </div>

    </Flex>
  );
}

function alphaLine(a: number) {
  return `rgba(255,255,255,${a})`;
}

function alpha(hex: string, a: number) {
  const n = hex.replace('#', '');
  const v = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
