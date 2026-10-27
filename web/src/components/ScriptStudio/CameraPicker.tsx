import { alpha, Flex, Switch, Text, useMantineTheme } from '@mantine/core';
import { fetchNui, useAdminToolStore } from 'dirk-cfx-react';
import { motion } from 'framer-motion';
import { Video } from 'lucide-react';
import { useState } from 'react';
import { useChrome } from './studioLocale';

/**
 * A CAMERA SHOT, framed by flying to it rather than typed.
 *
 * Fourth of the in-world pickers, after position, prop and box, and the same
 * handshake: hide the panel through the admin-tool store, hand over to the
 * router, wait for the player to confirm, take the answer back.
 *
 * Six numbers and a field of view cannot be written by hand - nobody knows
 * what rotation -5.5, 0, 131 looks like - so the only way to set a shot is to
 * stand where the camera stands and look where it looks. The tool opens a
 * free camera at the saved shot (or where you are now, the first time), you
 * fly it into place, and what comes back is exactly what you were looking at.
 *
 * Stores `{ pos: {x,y,z}, rot: {x,y,z}, fov }`. Any OTHER keys on the value are
 * the owning script's business and are kept - a scene camera also carries
 * "follow the player", which is drawn here as a switch (see `flags`) so it
 * does not vanish from the form when the object becomes one control.
 */

export type CameraValue = {
  pos: { x: number; y: number; z: number };
  rot: { x: number; y: number; z: number };
  fov: number;
  [extra: string]: unknown;
};

export type CameraFlag = { key: string; label: string; help?: string };

const vec = (v: unknown) => {
  const o = (v ?? {}) as { x?: unknown; y?: unknown; z?: unknown };
  return {
    x: typeof o.x === 'number' ? o.x : 0,
    y: typeof o.y === 'number' ? o.y : 0,
    z: typeof o.z === 'number' ? o.z : 0,
  };
};

export function readCamera(value: unknown): CameraValue {
  const o = (value ?? {}) as Record<string, unknown>;
  return {
    ...o,
    pos: vec(o.pos),
    rot: vec(o.rot),
    fov: typeof o.fov === 'number' ? o.fov : 50,
  };
}

/** A shot that was never set is all zeros - the tool starts at the player then. */
export function isFramed(v: CameraValue) {
  return v.pos.x !== 0 || v.pos.y !== 0 || v.pos.z !== 0;
}

export function CameraPicker({ value, flags, onChange, disabled }: {
  value?: unknown;
  /** boolean keys on the same object, drawn as switches under the shot */
  flags?: CameraFlag[];
  onChange: (next: CameraValue) => void;
  disabled?: boolean;
}) {
  const theme = useMantineTheme();
  const accent = theme.colors[theme.primaryColor][5];
  const t = useChrome();
  const beginTool = useAdminToolStore((s) => s.begin);

  const [framing, setFraming] = useState(false);
  const current = readCamera(value);
  const framed = isFramed(current);

  const begin = async () => {
    if (disabled || framing) return;

    // Built HERE, not in Lua: the tool runs in whichever resource pulled the
    // admin tools in, and `locale()` there reads that resource's file.
    const instructions = {
      title: t('camera.card.title', 'Frame the shot'),
      hint: t('camera.card.hint', 'Fly the camera to where the shot should be.'),
      keys: [
        { key: 'W A S D', action: t('camera.key.move', 'Move') },
        { key: 'MOUSE', action: t('camera.key.look', 'Look') },
        { key: 'SHIFT / ALT', action: t('camera.key.speed', 'Faster / slower') },
        { key: 'Q / E', action: t('camera.key.zoom', 'Zoom') },
        { key: 'F', action: t('camera.key.set', 'Use this shot') },
        { key: '⌫', action: t('camera.key.cancel', 'Cancel') },
      ],
    };

    setFraming(true);
    // Armed BEFORE the fetch: the reply can land the moment the tool ends.
    const pending = beginTool({ id: 'captureCamera', ...instructions });
    fetchNui('ADMIN_TOOL_BEGIN', {
      id: 'captureCamera',
      // Start from the saved shot, so re-framing nudges it rather than
      // starting over from wherever the admin happens to be standing.
      value: framed ? { pos: current.pos, rot: current.rot, fov: current.fov } : undefined,
      instructions,
    }).catch(() => useAdminToolStore.getState().cancelActive());

    const result = await pending as Partial<CameraValue> | null;
    setFraming(false);
    if (result && result.pos && result.rot) {
      onChange({
        ...current,
        pos: vec(result.pos),
        rot: vec(result.rot),
        fov: typeof result.fov === 'number' ? result.fov : current.fov,
      });
    }
  };

  const summary = framed
    ? `${current.pos.x.toFixed(1)}, ${current.pos.y.toFixed(1)}, ${current.pos.z.toFixed(1)} · ${t('camera.fov', 'FOV')} ${Math.round(current.fov)}`
    : t('camera.unset', 'No shot framed yet');

  return (
    <Flex direction="column" gap="0.6vh" style={{ flex: 1, minWidth: 0 }}>
      <Flex align="center" gap="xs" style={{ minWidth: 0 }}>
        <Text
          style={{
            flex: 1, minWidth: 0,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '1.05vh',
            color: framed ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.3)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {framing ? t('camera.framing', 'Framing — press F in game') : summary}
        </Text>

        <motion.button
          type="button"
          disabled={!!disabled || framing}
          onClick={begin}
          whileHover={disabled || framing ? undefined : { background: alpha(accent, 0.22) }}
          whileTap={disabled || framing ? undefined : { scale: 0.97 }}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4vh',
            padding: '0.5vh 0.9vh',
            background: alpha(accent, 0.14),
            border: `0.1vh solid ${alpha(accent, 0.45)}`,
            borderRadius: theme.radius.xs,
            color: accent,
            fontFamily: 'Akrobat SemiBold, sans-serif',
            fontSize: '1.1vh',
            cursor: disabled || framing ? 'not-allowed' : 'pointer',
            opacity: disabled || framing ? 0.4 : 1,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <Video size="1.2vh" />
          {framed ? t('camera.reframe', 'Reframe') : t('camera.frame', 'Frame shot')}
        </motion.button>
      </Flex>

      {flags?.map((flag) => (
        <Flex key={flag.key} align="center" justify="space-between" gap="xs">
          <Flex direction="column" style={{ minWidth: 0 }}>
            <Text ff="Akrobat Bold" size="xxs" c="rgba(255,255,255,0.75)">{flag.label}</Text>
            {flag.help && (
              <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.35)" lineClamp={2}>{flag.help}</Text>
            )}
          </Flex>
          <Switch
            size="xs"
            checked={current[flag.key] === true}
            disabled={disabled}
            onChange={(e) => onChange({ ...current, [flag.key]: e.currentTarget.checked })}
          />
        </Flex>
      ))}
    </Flex>
  );
}
