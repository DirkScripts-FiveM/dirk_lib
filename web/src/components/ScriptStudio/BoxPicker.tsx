import { Flex, Text, useMantineTheme, alpha } from '@mantine/core';
import { motion } from 'framer-motion';
import { MapPin, Scan } from 'lucide-react';
import { useState } from 'react';
import { fetchNui, useAdminToolStore } from 'dirk-cfx-react';
import { useChrome } from './studioLocale';

/**
 * An AREA, marked out in the world rather than typed.
 *
 * Third of the in-world pickers, after the walk-there position and the prop
 * placer, and deliberately the same handshake as both: hide the panel through
 * the admin-tool store, hand over to the router, wait for the player to press
 * E, take the answer back.
 *
 * ── what makes it a different control ───────────────────────────────────────
 *
 * A position is a POINT and a prop is a point with a model on it. Neither can
 * answer "how much room is there". Fields like a delivery pile, a spawn patch
 * or a search area are about EXTENT — how much of the ground belongs to this —
 * and pointing a prop picker at one gives a centre and leaves the consumer to
 * invent the rest.
 *
 * ── why it is not the map ───────────────────────────────────────────────────
 *
 * `x-mapPaths` draws polygons on the Script Studio map, and for a region that
 * is right: a yard boundary is hundreds of metres and reads best from above.
 * This is the other end of the scale — two metres by three, tucked against a
 * shutter — where the only way to know it is right is to stand in front of it.
 *
 * ── the sample props ────────────────────────────────────────────────────────
 *
 * `x-boxSample` lets the schema say what will live in the box, and the tool
 * fills it with those while you place it. Only the schema knows this field is
 * a parcel pile; dirk_lib never learns that, exactly as with `x-propModel`.
 */

export type BoxValue = {
  /** Centre of the FLOOR, not of the volume. */
  x: number; y: number; z: number;
  /** Heading, so it matches every other placed thing in the panel. */
  w: number;
  length: number;
  width: number;
  height: number;
};

const ZERO: BoxValue = { x: 0, y: 0, z: 0, w: 0, length: 2, width: 2, height: 1 };

function isPlaced(v: BoxValue) {
  return v.x !== 0 || v.y !== 0 || v.z !== 0;
}

export function BoxPicker({ value, sample, min, max, onChange, disabled }: {
  value?: BoxValue | null;
  /**
   * Props to stand inside the box while it is being placed, so the size is
   * judged against what will actually be there rather than an empty outline.
   */
  sample?: { models?: string[]; count?: number } | null;
  /** Smallest and largest a side may be, in metres. */
  min?: number;
  max?: number;
  onChange: (next: BoxValue) => void;
  disabled?: boolean;
}) {
  const theme = useMantineTheme();
  const accent = theme.colors[theme.primaryColor][5];
  const t = useChrome();

  const [placing, setPlacing] = useState(false);
  const current = { ...ZERO, ...(value ?? {}) };
  const placed = isPlaced(current);

  /**
   * The SHARED admin-tool handshake.
   *
   * Going through the store is what HIDES the panel — cfx-react stamps
   * `data-dirk-instruction-active` on the body while a tool is running. Firing
   * `fetchNui` straight at the router answers correctly and leaves the placer
   * running behind a full-screen config panel, which is the bug the prop
   * picker had.
   */
  const beginTool = useAdminToolStore((s) => s.begin);

  const begin = async () => {
    if (disabled || placing) return;

    // ── one panel, two modes ──────────────────────────────────────────────
    //
    // Same title in both halves, because it is one job. The three shared keys
    // — swap, confirm, cancel — sit in the same slots at the bottom of each
    // list, so changing mode reads as the card changing rather than a second
    // card replacing it.
    //
    // Built HERE because the tool runs inside whichever resource pulled the
    // admin tools in, and `locale()` there reads THAT resource's file, not
    // dirk_lib's.
    const instructions = {
      title: t('box.card.title', 'Mark out the area'),
      hint: t('box.card.aim', 'Aim — it follows where you look.'),
      keys: [
        { key: '← →', action: t('box.key.turn', 'Turn') },
        { key: 'SHIFT', action: t('box.key.fine', 'Finer') },
        { key: 'G', action: t('box.key.size', 'Size it') },
        { key: 'E', action: t('box.key.place', 'Put it here') },
        { key: '⌫', action: t('box.key.cancel', 'Cancel') },
      ],
    };

    const sizeInstructions = {
      title: t('box.card.title', 'Mark out the area'),
      hint: t('box.card.size', 'Size — stretch it to fit.'),
      keys: [
        { key: '← →', action: t('box.key.wider', 'Wider / narrower') },
        { key: '↑ ↓', action: t('box.key.longer', 'Longer / shorter') },
        { key: 'SHIFT', action: t('box.key.fine', 'Finer') },
        { key: 'G', action: t('box.key.aim', 'Back to aiming') },
        { key: 'E', action: t('box.key.done', 'Done') },
        { key: '⌫', action: t('box.key.cancel', 'Cancel') },
      ],
    };

    setPlacing(true);
    // Armed BEFORE the fetch: the reply can land the moment the tool ends, and
    // a listener registered after it would miss its own answer.
    const pending = beginTool({ id: 'captureBox', ...instructions });
    fetchNui('ADMIN_TOOL_BEGIN', {
      id: 'captureBox',
      // Carried over so re-placing nudges what is there rather than starting
      // again from a default square.
      value: placed ? current : undefined,
      sample: sample ?? undefined,
      min,
      max,
      instructions,
      sizeInstructions,
    }).catch(() => useAdminToolStore.getState().cancelActive());

    const result = await pending as Partial<BoxValue> | null;
    setPlacing(false);
    if (result && typeof result.x === 'number') {
      onChange({
        x: result.x,
        y: result.y as number,
        z: result.z as number,
        w: result.w ?? 0,
        length: result.length ?? ZERO.length,
        width: result.width ?? ZERO.width,
        height: result.height ?? ZERO.height,
      });
    }
  };

  const goto = () => {
    if (disabled || !placed) return;
    fetchNui('ADMIN_TOOL_INVOKE', { id: 'gotoCoord', value: current });
  };

  const btn = (label: string, icon: React.ReactNode, onClick: () => void, off: boolean, hot?: boolean) => (
    <motion.button
      type="button"
      disabled={off}
      onClick={onClick}
      whileHover={off ? undefined : { background: alpha(accent, hot ? 0.22 : 0.12) }}
      whileTap={off ? undefined : { scale: 0.97 }}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.4vh',
        padding: '0.5vh 0.9vh',
        background: hot ? alpha(accent, 0.14) : 'rgba(255,255,255,0.05)',
        border: `0.1vh solid ${hot ? alpha(accent, 0.45) : 'rgba(255,255,255,0.12)'}`,
        borderRadius: theme.radius.xs,
        color: hot ? accent : 'rgba(255,255,255,0.75)',
        fontFamily: 'Akrobat SemiBold, sans-serif',
        fontSize: '1.1vh',
        cursor: off ? 'not-allowed' : 'pointer',
        opacity: off ? 0.4 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}{label}
    </motion.button>
  );

  /**
   * The SIZE, not the coordinates.
   *
   * A position field shows where it is because where is the only thing it
   * holds. This one holds an extent as well, and the extent is the part
   * somebody scanning a list of yards actually wants to compare — the
   * coordinates are six digits nobody reads. Goto is right there for anyone
   * who wants the other question answered.
   */
  const size = `${current.length.toFixed(1)} × ${current.width.toFixed(1)} × ${current.height.toFixed(1)} m`;

  return (
    <Flex align="center" gap="xs" style={{ flex: 1, minWidth: 0 }}>
      <Text
        style={{
          flex: 1, minWidth: 0,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '1.05vh',
          color: placed ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.3)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {placing
          ? t('box.placing', 'Marking it out — press E in game')
          : placed
            ? size
            : t('box.nowhere', 'Not marked out yet')}
      </Text>

      <Flex gap="0.3vh" style={{ flexShrink: 0 }}>
        {btn(t('object.goto', 'Goto'), <MapPin size="1.2vh" />, goto, !!disabled || !placed)}
        {btn(
          placed ? t('box.redo', 'Redo') : t('box.mark', 'Mark out'),
          <Scan size="1.2vh" />,
          begin,
          !!disabled || placing,
          true,
        )}
      </Flex>
    </Flex>
  );
}
