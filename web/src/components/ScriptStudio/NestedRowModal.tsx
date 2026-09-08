import { alpha, Flex, Text, useMantineTheme } from '@mantine/core';
import { Modal } from 'dirk-cfx-react';
import { useState } from 'react';
import { useItems } from 'dirk-cfx-react';
import { PickerDrawer } from './PickerDrawer';
import { RowFields } from './RowFields';
import { ItemArt, rowIdentity, singular, StudioButton } from './ui';
import type { SettingColumn } from './types';
import { useChrome } from './studioLocale';

type Row = Record<string, unknown>;

/**
 * The editor for ONE entry of a table nested inside a row - a store's category,
 * a store's stock line, a fish's reward item.
 *
 * These used to render as live inputs stacked in the parent modal, which meant
 * a store with eight stock lines was forty-odd boxes deep and wide enough to
 * run off the edge. The outer lists already solved this: a compact row you
 * click to edit. This is the same idea one level down.
 */
export function NestedRowModal({
  column, resource, row, index, onSave, onDelete, onClose, disabled, parentRow,
}: {
  column: SettingColumn;
  /** the script this row belongs to, for options resolved from its config */
  resource?: string;
  row: Row;
  index: number;
  onSave: (next: Row) => void;
  onDelete: () => void;
  onClose: () => void;
  disabled?: boolean;
  /** the row this table sits inside, for options sourced from it */
  parentRow?: Record<string, unknown>;
}) {
  const t = useChrome();
  /**
   * A field in a NESTED row can open a picker too.
   *
   * This modal rendered its fields with no drill handler at all, so the item
   * picker on a reward-pool row - a nested table inside the fish editor - did
   * nothing whatsoever when clicked.
   */
  const [picker, setPicker] = useState<
    { column: SettingColumn; value: unknown; apply: (next: unknown) => void } | null
  >(null);
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const [draft, setDraft] = useState<Row>(() => JSON.parse(JSON.stringify(row)));

  const children = column.columns ?? [];
  // The same rule the list behind this modal uses. It had its own, with no
  // check at all, so a category called "Rods" arrived here as an item: a
  // broken picture at the top, and a name and description the form then made
  // read-only because it thought the inventory owned them.
  const items = useItems();
  const { itemKey } = rowIdentity(children, [draft], items);
  const itemName = itemKey ? String(draft[itemKey] ?? '') : '';


  const one = singular(column.label);

  return (
    <Modal
      title={`${one} ${index + 1}`}
      description={`Inside ${column.label.toLowerCase()}`}
      iconColor={color}
      onClose={onClose}
      width="104vh"
      height="72vh"
      // above the row modal that opened it, and above its confirm
      zIndex={10400}
    >
      <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
        {/* The header sits OUTSIDE the scroller now: `RowFields` brings its own
            padding and its own overflow, so leaving this wrapper as a second
            scrolling, padded box nested one inside the other double-padded the
            form and gave it two scrollbars. */}
        {itemName && (
          <Flex align="center" gap="sm" px="sm" pt="sm" style={{ flexShrink: 0 }}>
            <ItemArt name={itemName} size="5vh" />
            <Text ff="Akrobat Bold" size="sm" c="rgba(255,255,255,0.85)">{itemName}</Text>
          </Flex>
        )}

        <RowFields
            className="studio-scroll"
            columns={children}
            draft={draft}
            parentRow={parentRow}
            resource={resource}
            itemName={itemName}
            disabled={disabled}
            gap="xxs"
            setField={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
            onPick={setPicker}
          />

        {children.length === 0 && (
          <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.35)" px="sm" pb="sm">
            {t('nestedRowModal.nothing_to_edit_on_this_entry', 'Nothing to edit on this entry.')}
          </Text>
        )}

        {picker && (
          <PickerDrawer
            type={picker.column.type}
            label={picker.column.label}
            iconSet={picker.column.iconSet}
            value={picker.value}
            disabled={disabled}
            onApply={(next) => picker.apply(next)}
            onClose={() => setPicker(null)}
          />
        )}

        <Flex
          align="center" justify="space-between" px="sm" py="xs"
          style={{ borderTop: `0.1vh solid ${alpha(theme.colors.dark[4], 0.4)}`, flexShrink: 0 }}
        >
          <StudioButton label={t('nestedRowModal.remove', 'Remove')} danger disabled={disabled} onClick={onDelete} />
          <Flex align="center" gap="xs">
            <StudioButton label={t('nestedRowModal.cancel', 'Cancel')} onClick={onClose} />
            <StudioButton label={t('nestedRowModal.done', 'Done')} primary disabled={disabled} onClick={() => onSave(draft)} />
          </Flex>
        </Flex>
      </Flex>
    </Modal>
  );
}
