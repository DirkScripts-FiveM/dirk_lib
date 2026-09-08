/**
 * The fields of one row, drawn once.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * Two editors show the same thing: `RowModal` for a list row, and `ZoneMap`'s
 * shape editor for an area drawn on the map. Both walked the same columns and
 * rendered the same `FieldRow`, in two copies that were never diffed against
 * each other. They had already drifted three ways, and every difference was a
 * silent bug in whichever copy was behind:
 *
 *   • The PICKER. `RowModal` carried the nested child a field handed up;
 *     `ZoneMap` threw it away and opened the picker on the PARENT. So a blip's
 *     sprite inside a `blip` object opened an empty modal - the drawer has no
 *     picker for an object - and only in map sections. In a plain list the same
 *     field worked, which is what made it look like a schema problem.
 *
 *   • The PATH. `RowModal` passed `entry.path`, which is what a field label
 *     resolves its translation by. `ZoneMap` passed none, so every field in
 *     every map section was untranslatable and nothing said so.
 *
 *   • The DEFAULT. `RowModal` fell back to `column.default` for a row saved
 *     before a field existed; `ZoneMap` showed it blank - which is not what the
 *     server will use, so the form disagreed with the game.
 *
 * `bare` went the other way: only `ZoneMap` had it. So the merge is not "pick
 * one and delete the other", it is every behaviour both had, in one place.
 */
import { Flex } from '@mantine/core';
import { FieldRow, isWideColumn } from './FieldRow';
import { fieldGatedOff } from './ui';
import type { SettingColumn } from './types';

type Row = Record<string, unknown>;

/** What the picker is editing, and where its answer goes. */
export type PickerTarget = {
  column: SettingColumn;
  value: unknown;
  apply: (next: unknown) => void;
};

export function RowFields({
  columns, draft, resource, path, itemName, disabled, problemFor, setField, onPick,
  parentRow, gap = 'xs', className,
}: {
  columns: SettingColumn[];
  /** the row being edited, so a field can read its siblings for `x-enabledWhen` */
  draft: Row;
  resource?: string;
  /** the owning setting's path — what a field label resolves its locale key by */
  path?: string;
  /** the item this row IS, when it is one, so mirrored name/description fields resolve */
  itemName?: string;
  disabled?: boolean;
  problemFor?: (key: string) => string | undefined;
  setField: (key: string, value: unknown) => void;
  onPick: (target: PickerTarget) => void;
  /**
   * The row ABOVE this one, for a nested table.
   *
   * `x-boundsFrom` can point at a field on the parent - a permit's weight limit
   * only means anything inside the weights that species actually reaches - and
   * only the nested editor has a parent to point at.
   */
  parentRow?: Row;
  gap?: string;
  className?: string;
}) {
  return (
    <Flex
      direction="column" gap={gap} p="sm" className={className}
      style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}
    >
      {columns.map((column) => (
        <FieldRow
          key={column.key}
          // A tab holding exactly one wide control does not need a titled box
          // inside a titled tab saying the same thing twice.
          bare={columns.length === 1 && isWideColumn(column.type)}
          column={column}
          resource={resource}
          path={path}
          row={draft}
          parentRow={parentRow}
          // `?? column.default`: a row saved before a field existed has no key
          // for it, and blank is not what the server will use.
          value={draft[column.key] ?? column.default}
          itemName={itemName}
          // `readOnly` as well as the gate. A generated id is the key
          // smartMerge matches rows on, so typing over it silently orphans
          // anything pointing at the row.
          disabled={disabled || fieldGatedOff(column, draft) || !!column.readOnly}
          dimmed={fieldGatedOff(column, draft)}
          error={problemFor?.(column.key)}
          onChange={(value) => setField(column.key, value)}
          // A nested field hands up the CHILD column and a pair of accessors
          // into its own slot. Dropping either opens the picker on the parent,
          // which is how an object ended up in a drawer that cannot draw one.
          onPick={(child, access) => onPick({
            column: child ?? column,
            value: child ? access?.read() : draft[column.key],
            apply: (next) => (access ? access.write(next) : setField(column.key, next)),
          })}
        />
      ))}
    </Flex>
  );
}
