import { toBodyHeight } from './bodyHeight';
import { alpha, Flex, Text, useMantineTheme } from '@mantine/core';
import { Vector4DeleteButton, Vector4Display, WorldPositionPicker, type Vector4Value } from 'dirk-cfx-react';
import { ConfirmModal } from './Dialog';
import { AnimatePresence } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { StudioButton } from './ui';
import { useChrome } from './studioLocale';

type Position = { x: number; y: number; z: number; w?: number };

const ZERO: Position = { x: 0, y: 0, z: 0, w: 0 };

/**
 * A list of world positions - a store's counters, a zone's markers.
 *
 * The generic nested-table renderer turned each one into four number boxes,
 * which is technically the data and practically useless: nobody types
 * coordinates. The old fishing panel got this right and this matches it - read
 * the position, teleport to it, or set it to wherever you are standing.
 */
export function PositionListControl({
  value, onChange, disabled, bodyHeight,
}: {
  value: unknown;
  onChange: (next: Position[]) => void;
  disabled?: boolean;
  /** `x-bodyHeight` - captured positions are lifted to body height */
  bodyHeight?: boolean;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const rows: Position[] = Array.isArray(value)
    ? (value as Position[]).filter((row) => row && typeof row === 'object')
    : [];

  const update = (index: number, next: Vector4Value) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));

  return (
    <Flex direction="column" gap="xxs" style={{ width: '100%' }}>
      {rows.map((row, index) => (
        <Flex
          key={index}
          direction="column" gap="0.4vh"
          px="xs" py="0.6vh"
          style={{
            background: alpha(theme.colors.dark[9], 0.45),
            border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.3)}`,
            borderRadius: theme.radius.xs,
          }}
        >
          <Flex align="center" gap="xs">
            <Flex
              align="center" justify="center"
              px="0.6vh"
              style={{
                background: alpha(color, 0.14),
                border: `0.1vh solid ${alpha(color, 0.35)}`,
                borderRadius: '0.3vh',
              }}
            >
              <Text ff="Akrobat Bold" size="xxs" c={color}>#{index + 1}</Text>
            </Flex>

            <Flex flex={1} />

            {/* Set + Goto as one unit. The Set button runs the real in-game
                flow - instructions overlay, walk to the spot, press E - which
                is the whole reason nobody has to type coordinates. */}
            <Flex gap="0.3vh">
              <WorldPositionPicker
                value={row as Vector4Value}
                onChange={(next: Vector4Value) => update(index, toBodyHeight(next, bodyHeight))}
                compact
              />
              <Vector4DeleteButton onClick={() => setConfirmDelete(index)} compact />
            </Flex>
          </Flex>

          <Vector4Display value={row as Vector4Value} />
        </Flex>
      ))}

      {rows.length === 0 && (
        <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.3)">{t('positionListControl.no_positions_set', 'No positions set')}</Text>
      )}

      {!disabled && (
        <StudioButton
          label={t('positionListControl.add_position', 'Add position')}
          icon={Plus}
          onClick={() => onChange([...rows, { ...ZERO }])}
          grow
        />
      )}

      <AnimatePresence>
        {confirmDelete !== null && rows[confirmDelete] && (
          <ConfirmModal
            title={t('positionListControl.remove_position', 'Remove position')}
            description={`Position #${confirmDelete + 1} is removed when you save.`}
            confirmLabel="Remove"
            onConfirm={() => {
              onChange(rows.filter((_, i) => i !== confirmDelete));
              setConfirmDelete(null);
            }}
            onClose={() => setConfirmDelete(null)}
            zIndex={10500}
          />
        )}
      </AnimatePresence>
    </Flex>
  );
}

/** `[{x,y,z,w?}, ...]` — a list of world positions, not a generic table. */
export function isPositionList(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((row) => row && typeof row === 'object' && !Array.isArray(row)
    && typeof (row as Position).x === 'number'
    && typeof (row as Position).y === 'number'
    && typeof (row as Position).z === 'number');
}
