import { alpha, Flex, Text, useMantineTheme } from '@mantine/core';
import { ConfirmModal } from './Dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { NestedRowModal } from './NestedRowModal';
import { useItems } from 'dirk-cfx-react';
import { ItemArt, rowIdentity, singular, StudioButton } from './ui';
import { AnyIcon } from './Icon';
import type { SettingColumn } from './types';
import { useChrome } from './studioLocale';
import { newRow } from './newRow';

type Row = Record<string, unknown>;

/**
 * A table inside a row - a store's categories or stock, a fish's reward items.
 *
 * Compact SUMMARY rows, not live inputs. Rendering every column of every entry
 * as its own control meant a store's stock list ran dozens of boxes deep and
 * wide enough to fall off the edge of the modal containing it, and the shape of
 * the list was impossible to read at a glance. The outer lists already answered
 * this - a row you read, and click to edit - so this is the same pattern one
 * level down.
 */
export function NestedRows({
  column, resource, value, onChange, disabled, parentRow,
}: {
  column: SettingColumn;
  /**
   * The script this table belongs to.
   *
   * Needed by anything whose options come from the config rather than the
   * schema - a stock row's category is one of the categories of the store it
   * sits in, and resolving that means knowing whose config to look in. Missing
   * here, the picker silently fell back to a plain text box.
   */
  resource?: string;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  /** the row this table sits inside, for options sourced from it */
  parentRow?: Record<string, unknown>;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  /** a row being composed, not yet in the table */
  const [creating, setCreating] = useState<Record<string, unknown> | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const rows = Array.isArray(value) ? (value as Row[]) : [];
  const children = column.columns ?? [];

  const items = useItems();
  const { itemKey, iconKey } = rowIdentity(children, rows, items);

  /** What names this entry: its item, else the first text it carries. */
  const titleKey = itemKey
    ?? children.find((child) => /^(name|label|title|item)$/i.test(child.key))?.key
    ?? children[0]?.key;

  /** The rest, as label/value pairs - enough to tell two entries apart. */
  const summaryKeys = children
    .filter((child) => child.key !== titleKey && child.key !== iconKey
      && isSummarisable(child.type))
    .slice(0, 4);

  const one = singular(column.label).toLowerCase();

  const save = (index: number, next: Row) => {
    onChange(rows.map((row, i) => (i === index ? next : row)));
    setEditing(null);
  };

  const remove = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
    setEditing(null);
    setConfirmDelete(null);
  };

  return (
    <Flex direction="column" gap="xxs" style={{ width: '100%', minWidth: 0 }}>
      {rows.map((row, index) => (
        <Flex key={index} align="center" gap="xs" style={{ minWidth: 0 }}>
          <motion.button
            type="button"
            onClick={() => setEditing(index)}
            whileHover={{ background: alpha(color, 0.08) }}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.8vh',
              flex: 1, minWidth: 0,
              padding: '0.5vh 0.7vh',
              background: alpha(theme.colors.dark[9], 0.45),
              border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.3)}`,
              borderRadius: '0.3vh',
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            {/* The icon WINS over the item art. A category has a `name` and
                that name looks item-shaped, so the art slot claimed it and
                drew the missing-item box for "Rods" - while the row was
                carrying a perfectly good fish icon of its own. A declared
                icon is evidence; a name that resembles an item key is a
                guess. */}
            {itemKey && <ItemArt name={String(row[itemKey] ?? '')} size="2.8vh" />}

            {iconKey && (
              <Flex
                align="center" justify="center"
                style={{
                  width: '2.8vh', height: '2.8vh', flexShrink: 0,
                  background: alpha(theme.colors.dark[9], 0.6),
                  border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.4)}`,
                  borderRadius: '0.3vh',
                }}
              >
                <AnyIcon name={String(row[iconKey] ?? '')} size="1.4vh" color={color} />
              </Flex>
            )}

            <Text
              ff="Akrobat Bold" size="xs" c="rgba(255,255,255,0.88)"
              style={{ flexShrink: 0, maxWidth: '22vh' }}
              truncate
            >
              {display(row[titleKey ?? '']) || `${one} ${index + 1}`}
            </Text>

            <Flex align="center" gap="xs" style={{ flex: 1, minWidth: 0 }}>
              {summaryKeys.map((child) => {
                const text = display(row[child.key], child.type);
                if (!text) return null;
                return (
                  <Flex key={child.key} align="baseline" gap="0.35vh" style={{ minWidth: 0 }}>
                    <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.28)">{child.label}</Text>
                    <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.6)" truncate>{text}</Text>
                  </Flex>
                );
              })}
            </Flex>

            <ChevronRight size="1.4vh" color="rgba(255,255,255,0.3)" />
          </motion.button>

          <motion.button
            type="button"
            onClick={() => setConfirmDelete(index)}
            disabled={disabled}
            whileTap={{ scale: 0.94 }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              aspectRatio: '1 / 1', height: '2.8vh',
              background: 'transparent',
              border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.5)}`,
              borderRadius: '0.3vh',
              cursor: disabled ? 'not-allowed' : 'pointer',
              color: 'rgba(255,255,255,0.5)', flexShrink: 0,
            }}
            aria-label={`Remove ${one}`}
          >
            <Trash2 size="1.2vh" />
          </motion.button>
        </Flex>
      ))}

      {rows.length === 0 && (
        <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.3)">{t('nestedRows.nothing_here_yet', 'Nothing here yet')}</Text>
      )}

      <StudioButton
        label={`Add ${one}`}
        icon={Plus}
        disabled={disabled}
        // Composed, then appended on save - the same rule the outer lists
        // follow. A reward you started and abandoned should not be in the list.
        onClick={() => setCreating(newRow(column.rowTemplate, column.columns))}
        grow
      />

      <AnimatePresence>
        {creating && (
          <NestedRowModal
          resource={resource}
            column={column}
            parentRow={parentRow}
            row={creating}
            index={rows.length}
            disabled={disabled}
            onSave={(next) => {
              onChange([...rows, next]);
              setCreating(null);
            }}
            onDelete={() => setCreating(null)}
            onClose={() => setCreating(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editing !== null && rows[editing] && (
          <NestedRowModal
          resource={resource}
          parentRow={parentRow}
            column={column}
            row={rows[editing]!}
            index={editing}
            disabled={disabled}
            onSave={(next) => save(editing, next)}
            onDelete={() => setConfirmDelete(editing)}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDelete !== null && rows[confirmDelete] && (
          <ConfirmModal
            title={`Remove from ${column.label}`}
            description="This entry is removed when you save the row."
            confirmLabel="Remove"
            onConfirm={() => remove(confirmDelete)}
            onClose={() => setConfirmDelete(null)}
            zIndex={10500}
          />
        )}
      </AnimatePresence>
    </Flex>
  );
}

/** Worth putting on the summary line - a nested table or a slider is not. */
/** Meter scales, which all read as a proportion rather than a raw number. */
const METERS = new Set<SettingColumn['type']>([
  'chance', 'multiplier', 'difficulty', 'forgiveness',
  'rarity', 'balance', 'progression', 'generosity',
]);

function isSummarisable(type: SettingColumn['type']): boolean {
  // `range` belongs here. A min and a max is one of the most summarisable
  // things a row carries — "0.2 – 0.7" tells you what the entry IS — and
  // leaving it out meant a list of cars showed the model and nothing else.
  return type !== 'rows' && type !== 'object' && type !== 'tags' && type !== 'zones';
}

/** One short, readable cell value. */
function display(value: unknown, type?: SettingColumn['type']): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  // A meter is set as a proportion and read as a percentage. 0.05 in a summary
  // is a number you have to convert in your head to know it means "rare".
  if (typeof value === 'number') {
    return type && METERS.has(type) && value >= 0 && value <= 1
      ? `${Math.round(value * 100)}%`
      : String(value);
  }
  if (typeof value === 'string') return value;
  // A pair of numbers is a range, and its LENGTH is never the interesting part.
  if (Array.isArray(value)) {
    return value.length === 2 && value.every((v) => typeof v === 'number')
      ? `${value[0]} – ${value[1]}`
      : String(value.length);
  }
  return '';
}

function isRich(type: SettingColumn['type']): boolean {
  return type === 'slider' || type === 'range' || type === 'tags'
    || type === 'rows' || type === 'object';
}
