import { alpha, Flex, Text, useMantineTheme } from '@mantine/core';
import { ConfirmModal } from './Dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CameraPicker, type CameraValue } from './CameraPicker';
import { StudioButton } from './ui';
import { useChrome } from './studioLocale';

const BLANK = { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } };

/**
 * A list of camera shots - a camera PATH, like the drift behind a character
 * select screen.
 *
 * The generic table made each shot a row that opened into six number boxes,
 * which is the data and none of the job: a shot is set by looking at it. Each
 * row here is the same Frame shot picker a single camera gets, in order, so
 * the path is framed point by point in game.
 */
export function CameraListControl({
  value, onChange, disabled,
}: {
  value: unknown;
  onChange: (next: Record<string, unknown>[]) => void;
  disabled?: boolean;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const rows = Array.isArray(value)
    ? (value as Record<string, unknown>[]).filter((row) => row && typeof row === 'object')
    : [];

  const update = (index: number, next: CameraValue) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));

  return (
    <Flex direction="column" gap="xxs" style={{ width: '100%' }}>
      {rows.map((row, index) => (
        <Flex
          key={index}
          align="center" gap="xs"
          px="xs" py="0.6vh"
          style={{
            background: alpha(theme.colors.dark[9], 0.45),
            border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.3)}`,
            borderRadius: theme.radius.xs,
          }}
        >
          <Flex
            align="center" justify="center" px="0.6vh"
            style={{
              background: alpha(color, 0.14),
              border: `0.1vh solid ${alpha(color, 0.35)}`,
              borderRadius: '0.3vh',
              flexShrink: 0,
            }}
          >
            <Text ff="Akrobat Bold" size="xxs" c={color}>#{index + 1}</Text>
          </Flex>

          <CameraPicker value={row} disabled={disabled} onChange={(next) => update(index, next)} />

          {!disabled && (
            <motion.button
              type="button"
              onClick={() => setConfirmDelete(index)}
              title={t('cameraList.remove', 'Remove shot')}
              whileHover={{ background: alpha('#ef4444', 0.15) }}
              whileTap={{ scale: 0.95 }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '2.6vh', height: '2.6vh', flexShrink: 0,
                background: 'transparent',
                border: `0.1vh solid ${alpha('#ef4444', 0.2)}`,
                borderRadius: theme.radius.xs,
                cursor: 'pointer',
              }}
            >
              <Trash2 size="1.3vh" color="rgba(239,68,68,0.6)" />
            </motion.button>
          )}
        </Flex>
      ))}

      {rows.length === 0 && (
        <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.3)">
          {t('cameraList.none', 'No shots yet')}
        </Text>
      )}

      {!disabled && (
        <StudioButton
          label={t('cameraList.add', 'Add shot')}
          icon={Plus}
          onClick={() => onChange([...rows, { ...BLANK }])}
          grow
        />
      )}

      <AnimatePresence>
        {confirmDelete !== null && rows[confirmDelete] && (
          <ConfirmModal
            title={t('cameraList.remove', 'Remove shot')}
            description={t('cameraList.removeDesc', 'Shot #{} is removed when you save.').replace('{}', String(confirmDelete + 1))}
            confirmLabel={t('cameraList.removeConfirm', 'Remove')}
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
