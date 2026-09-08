import { Flex, Text, useMantineTheme, alpha } from '@mantine/core';
import { motion } from 'framer-motion';
import { Box, Crosshair, MapPin } from 'lucide-react';
import { useState } from 'react';
import { fetchNui, useAdminToolStore } from 'dirk-cfx-react';
import { useChrome } from './studioLocale';

/**
 * Where a PROP goes, placed in the world rather than typed.
 *
 * The sibling of cfx-react's `WorldPositionPicker`, and it works the same way
 * on purpose: hide the panel, hand over to the admin-tool router, wait for the
 * player to press E, take the answer back. What differs is what is being
 * placed — a position is where you STAND, and there is only ever one of those,
 * so the picker can just read your feet. An object has to be looked at from
 * outside while you move it, so the game spawns the real prop and you put it
 * where it goes.
 *
 * The model comes from the schema (`x-propModel`), because only the schema
 * knows that this particular field is a laptop. dirk_lib never learns that.
 */

export type ObjectValue = {
  x: number; y: number; z: number;
  /**
   * Set when the admin pointed at a prop the map already had, rather than
   * placing one. The consumer then FINDS that prop instead of spawning a
   * second one on top of it.
   */
  existing?: boolean;
  /** Which prop was pointed at, so it can be found again. */
  model?: string;
  /** Heading, so a field that only reads four numbers matches the walk-there picker. */
  w: number;
  /** Tilt, for a prop resting on something that is not flat. */
  rx?: number; ry?: number;
};

const ZERO: ObjectValue = { x: 0, y: 0, z: 0, w: 0, rx: 0, ry: 0 };

function isPlaced(v: ObjectValue) {
  return v.x !== 0 || v.y !== 0 || v.z !== 0;
}

export function ObjectPicker({ value, model, allow, onChange, disabled }: {
  value?: ObjectValue | null;
  /** Prop to spawn while placing. Without one there is nothing to look at. */
  model?: string;
  /**
   * Models the PICK mode will accept. The schema knows which props this field
   * can use; the placer does not, so it is told rather than guessing.
   */
  allow?: string[];
  onChange: (next: ObjectValue) => void;
  disabled?: boolean;
}) {
  const theme = useMantineTheme();
  const accent = theme.colors[theme.primaryColor][5];
  const t = useChrome();

  const [placing, setPlacing] = useState(false);
  const current = { ...ZERO, ...(value ?? {}) };
  const placed = isPlaced(current);

  /**
   * The SHARED admin-tool handshake, not a private one.
   *
   * This used to `fetchNui` straight at the router and listen for the reply on
   * its own `window` listener. The answer came back fine — but nothing ever
   * told cfx-react a tool was running, and cfx-react is what HIDES the panel
   * (it stamps `data-dirk-instruction-active` on the body while a tool is
   * active). So the placer ran behind a full-screen config panel: focus was
   * gone, the world was there, and the panel was still drawn over all of it.
   *
   * Going through the store gets the hide, the reply, and the cancel for free,
   * exactly as the walk-there position picker does.
   */
  const beginTool = useAdminToolStore((s) => s.begin);

  const begin = async (mode?: 'pick') => {
    if (disabled || placing) return;
    if (mode !== 'pick' && !model) return;

    // ── one panel, two modes ──────────────────────────────────────────────
    //
    // Same title in both, because it is one job. The hint says which half you
    // are in, and the three shared keys — toggle, confirm, cancel — sit in the
    // same slots at the bottom of both lists. Only the rows above them change,
    // so switching mode reads as the panel changing rather than a second panel
    // replacing it.
    //
    // Built HERE because the placer runs inside whichever resource pulled the
    // admin tools in, and `locale()` there reads that resource's locale file,
    // not dirk_lib's. `action`, not `label`: the card draws the cap from `key`
    // and the words beside it from `action`.
    const instructions = mode === 'pick' ? {
      title: t('object.pick.title', 'Pick an object'),
      hint: t('object.pick.hint', 'Look at the one you want.'),
      // Shown instead while nothing usable is under the crosshair. The confirm
      // key is withheld at the same time, so the card never offers a press
      // that would do nothing.
      hintNone: t('object.pick.hintNone', 'Nothing here this can use.'),
      keys: [
        { key: 'E', action: t('object.pick.use', 'Use this one') },
        { key: '⌫', action: t('object.key.cancel', 'Cancel') },
      ],
    } : {
      title: t('object.card.title', 'Place it'),
      hint: t('object.card.rough', 'Rough — it follows where you look.'),
      keys: [
        { key: '← →', action: t('object.key.turn', 'Turn') },
        { key: '↑ ↓', action: t('object.key.tilt', 'Tilt') },
        { key: 'SHIFT ↑ ↓', action: t('object.key.height', 'Raise / lower') },
        { key: 'G', action: t('object.key.fine', 'Fine tune') },
        { key: 'E', action: t('object.key.place', 'Place it here') },
        { key: '⌫', action: t('object.key.cancel', 'Cancel') },
      ],
    };

    const preciseInstructions = {
      title: t('object.card.title', 'Place it'),
      hint: t('object.card.fine', 'Fine — drag the handles.'),
      keys: [
        { key: 'LMB', action: t('object.fine.grab', 'Grab a handle') },
        { key: 'T', action: t('object.fine.move', 'Move') },
        { key: 'R', action: t('object.fine.rotate', 'Rotate') },
        { key: 'G', action: t('object.key.rough', 'Back to aiming') },
        { key: 'E', action: t('object.key.place', 'Place it here') },
        { key: '⌫', action: t('object.key.cancel', 'Cancel') },
      ],
    };

    setPlacing(true);
    // Armed BEFORE the fetch: the reply can land the moment the tool ends, and
    // a listener registered after it would miss its own answer.
    const pending = beginTool({ id: 'captureObject', ...instructions });
    fetchNui('ADMIN_TOOL_BEGIN', {
      id: 'captureObject',
      mode,
      model,
      allow,
      // Carried over so re-placing nudges what is there rather than starting
      // again at your feet.
      value: placed ? current : undefined,
      instructions,
      preciseInstructions,
    }).catch(() => useAdminToolStore.getState().cancelActive());

    const result = await pending as Partial<ObjectValue> | null;
    setPlacing(false);
    if (result && typeof result.x === 'number') {
      onChange({
        x: result.x, y: result.y as number, z: result.z as number,
        w: result.w ?? 0,
        rx: result.rx ?? 0, ry: result.ry ?? 0,
        existing: result.existing === true || undefined,
        model: typeof result.model === 'string' ? result.model : undefined,
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
        {/*
          Which of the two things this field is doing, said in the field.

          There was a place/adopt toggle beside this for a while. It was a
          second way of saying what Pick already writes into the value, and two
          ways of saying one thing can disagree — so the toggle went and the
          field reports what it holds instead.
        */}
        {placing
          ? t('object.placing', 'Placing it — press Enter in game')
          : placed
            ? `${current.existing ? `${t('object.adopted', 'One that is here')} · ` : ''}`
              + `${current.x.toFixed(2)}, ${current.y.toFixed(2)}, ${current.z.toFixed(2)}`
            : t('object.nowhere', 'Not placed yet')}
      </Text>

      <Flex gap="0.3vh" style={{ flexShrink: 0 }}>
        {btn(t('object.goto', 'Goto'), <MapPin size="1.2vh" />, goto, !!disabled || !placed)}
        {/* Adopting one the map already has. Separate button rather than a
            mode inside the placer: they are two different intentions, and
            hiding one behind a keypress in the other means never finding it. */}
        {/* Adopting one the map already has. A peer of Place, not a mode
            inside it: they are two different intentions, and which one you
            press is the whole of how this field knows what it is. */}
        {btn(
          t('object.pickExisting', 'Pick'),
          <Crosshair size="1.2vh" />,
          () => begin('pick'),
          !!disabled || placing,
        )}
        {btn(
          // "Move" only when there is something of OURS to move. A prop the
          // map already had is not ours, and offering to move it invites
          // dragging a piece of the interior around.
          placed && !current.existing ? t('object.move', 'Move') : t('object.place', 'Place'),
          <Box size="1.2vh" />,
          () => begin(),
          !!disabled || placing || !model,
          true,
        )}
      </Flex>
    </Flex>
  );
}
