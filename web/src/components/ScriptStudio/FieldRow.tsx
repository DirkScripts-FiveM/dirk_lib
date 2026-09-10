import { alpha, Flex, Text, Tooltip, useMantineTheme } from '@mantine/core';
import { resolveItemDescription, resolveItemLabel, useItems } from 'dirk-cfx-react';
import { Info } from 'lucide-react';
import { RedirectKindControl } from './RedirectKindControl';
import { ObjectMapControl } from './ObjectMapControl';
import { SettingControl } from './Controls';
import { opensPicker } from './PickerDrawer';
import { CustomControl } from './CustomControl';
import { RangeControl, SliderControl, TagsControl } from './RichControls';
import { GroupsControl, KeyValueControl } from './MapControls';
import { KeybindMapControl } from './KeybindMapControl';
import { GroupGradeControl } from './GroupGradeControl';
import { WeekdayControl } from './WeekdayControl';
import { PedsField } from './PedControl';
import { FieldAction } from './FieldAction';
import { PositionListControl } from './PositionListControl';
import { PickListControl, PickOneControl } from './PickListControl';
import { WeightMapControl } from './WeightMapControl';
import { MantineColorControl, ShadeControl } from './ThemeControls';
import { NestedRows } from './NestedRows';
import type { SettingColumn } from './types';
import { useMemo } from 'react';
import { translate, useActiveLanguage, useBundles, useChrome } from './studioLocale';

type Row = Record<string, unknown>;

// NOTE: the meter scales are NOT handled here. SettingControl already renders
// them and this row falls through to it, so having a case here too drew the
// bar twice - once beside the label and once in the control column.


/** Types that need their own block rather than a right-hand control. */
export function isWideColumn(type: SettingColumn['type']): boolean {
  return type === 'slider' || type === 'range' || type === 'tags' || type === 'peds'
    || type === 'rows' || type === 'object'
    || type === 'keyvalue' || type === 'groups'
    || type === 'keybindMap' || type === 'mantineColor' || type === 'shade'
    || type === 'groupGrades' || type === 'weekdays' || type === 'positions'
    || type === 'pickList' || type === 'weightMap'
    || type === 'redirectKind' || type === 'objectMap';
}

/**
 * One field inside a row editor.
 *
 * Shared by the list row modal, the zone editor and nested tables - those last
 * two used to hand every column to SettingControl, which has no case for the
 * rich types, so sliders and nested tables silently rendered as text boxes.
 *
 * Also owns the inventory-sourced rule: when a row points at an item that the
 * server's inventory knows, that item's label and description are the truth and
 * this field mirrors them read-only. Editing them here would be editing a copy
 * nobody sees.
 */
export function FieldRow({
  column, value, onChange, onPick, disabled, itemName, resource, path, dimmed, row, parentRow, bare, error,
}: {
  column: SettingColumn;
  /**
   * Draw the control alone - no label, no container.
   *
   * For when the surrounding chrome already says what this is: a tab holding
   * one wide control was a titled box inside a titled tab, which reads as two
   * things when there is only one.
   */
  bare?: boolean;
  /**
   * What is wrong with this field.
   *
   * On the field rather than only in a summary: being told "2 things need
   * fixing" and having to hunt for them is worse than the field saying so
   * where you are already looking.
   */
  error?: string;
  /**
   * Path of the setting this row belongs to, so the field's label and help can
   * be looked up in the owning script's locale files - `settings.<path>.<key>`.
   */
  path?: string;
  /** which script this row belongs to - pickList resolves its options from it */
  resource?: string;
  value: unknown;
  onChange: (next: unknown) => void;
  /**
   * Open the picker for this field, or for one nested inside it.
   *
   * A nested child hands over how to read and write itself, because the modal
   * that owns the picker cannot know that `blip.color` lives two levels down.
   */
  onPick?: (
    child?: SettingColumn,
    access?: { read: () => unknown; write: (next: unknown) => void },
  ) => void;
  disabled?: boolean;
  /** the item this row represents, if any - drives label/description mirroring */
  itemName?: string;
  /**
   * Switched off by another field, rather than by permission.
   *
   * Dimmed as well as disabled, the same way the settings list treats a gated
   * row - a field that is merely read-only to you should still look normal,
   * but one that does not currently apply should look like it.
   */
  dimmed?: boolean;
  /** the row this field belongs to, for options sourced from a sibling field */
  row?: Record<string, unknown>;
  /** the row above it, for options sourced from the row it sits inside */
  parentRow?: Record<string, unknown>;
}) {
  const t = useChrome();
  const theme = useMantineTheme();

  /**
   * Bounds read off a sibling field, when the column asks for them.
   *
   * `self.` is this row, `parent.` the row it sits inside - the same prefixes
   * `x-optionsFrom` and `x-enabledWhen` use, so a schema author learns them
   * once. A pair of numbers is a range; a single number is a ceiling.
   */
  const bounds = useMemo((): [number | undefined, number | undefined] | undefined => {
    const path = column.boundsFrom?.path;
    if (!path) return undefined;
    const source = path.startsWith('parent.') ? parentRow : row;
    const key = path.replace(/^(self|parent)\./, '');
    const found = source?.[key];
    if (Array.isArray(found)) {
      const [low, high] = found.map(Number);
      return [Number.isFinite(low) ? low : undefined, Number.isFinite(high) ? high : undefined];
    }
    return Number.isFinite(Number(found)) ? [0, Number(found)] : undefined;
  }, [column.boundsFrom?.path, row, parentRow]);
  const items = useItems();
  const wide = isWideColumn(column.type);

  // The script's own words where it has them, the schema's English otherwise -
  // the same fallback chain every other label in the panel uses.
  const language = useActiveLanguage();
  const bundles = useBundles();
  const localised = (suffix: string, fallback: string) => (
    (resource && path)
      ? translate(bundles, language, resource, `settings.${path}.${column.key}.${suffix}`, fallback)
      : fallback
  );
  const fieldLabel = localised('label', column.label);
  const fieldHelp = column.help ? localised('description', column.help) : undefined;

  /**
   * The WORDS a field puts on screen beyond its own name.
   *
   * A dropdown's option labels and a slider's band names come from the schema,
   * which is English - so a fully translated panel still had "Sports Classics"
   * and "Extra large" in it, with no key anyone could translate. Both are
   * derived from the field's path like every other string here, so a script
   * translates them by adding entries, never by annotating the schema:
   *
   *   settings.<path>.<key>.enum.<value>
   *   settings.<path>.<key>.bands.<index>
   *
   * By INDEX for bands, because they are a ladder: renaming the English word
   * should not orphan its translation.
   */
  const localisedOptions = useMemo(
    () => column.options?.map((option) => ({
      ...option,
      label: localised(`enum.${option.value}`, option.label),
    })),
    [column.options, bundles, language, resource, path, column.key],
  );

  const localisedBands = useMemo(
    () => column.bandLabels?.map((band, i) => localised(`bands.${i}`, band)),
    [column.bandLabels, bundles, language, resource, path, column.key],
  );

  /**
   * The two sides of a `boolChoice`, under
   *
   *   settings.<path>.<key>.bool.true / .bool.false
   *
   * By the SIDE rather than by the English word, for the same reason bands go
   * by index: rewording the schema should not orphan the translation.
   */
  const localisedBools = useMemo(
    () => column.boolLabels && {
      true: localised('bool.true', column.boolLabels.true ?? '') || undefined,
      false: localised('bool.false', column.boolLabels.false ?? '') || undefined,
    },
    [column.boolLabels, bundles, language, resource, path, column.key],
  );

  /** The column as the controls should see it - already in the right language. */
  const shownColumn = useMemo(
    () => ({
      ...column,
      options: localisedOptions,
      bandLabels: localisedBands,
      boolLabels: localisedBools,
    }),
    [column, localisedOptions, localisedBands, localisedBools],
  );

  const known = itemName ? items[itemName] : undefined;
  const mirrors = known
    && ((column.key === 'label' && !!known.label)
      || (column.key === 'description' && !!known.description));

  const shown = mirrors
    ? (column.key === 'label'
      ? resolveItemLabel(items, itemName!, String(value ?? ''))
      : resolveItemDescription(items, itemName!, String(value ?? '')))
    : value;

  return (
    <Flex
      direction={wide ? 'column' : 'row'}
      align={wide ? 'stretch' : 'center'}
      justify="space-between"
      gap={wide ? 'xs' : 'sm'}
      px={bare ? 0 : 'sm'} py={bare ? 0 : 'xs'}
      style={{
        background: bare ? 'transparent' : alpha(theme.colors.dark[8], 0.5),
        border: bare
          ? 'none'
          : `0.1vh solid ${error ? alpha('#E0776B', 0.6) : alpha(theme.colors.dark[5], 0.35)}`,
        borderRadius: theme.radius.xs,
        // Dimmed rather than hidden: knowing the field exists, and that
        // something else is switching it off, beats it vanishing.
        opacity: dimmed ? 0.4 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {!bare && (
      <Flex direction="column" style={{ minWidth: 0, lineHeight: 1.2 }}>
        <Flex align="center" gap="0.5vh">
          <Text ff="Akrobat Bold" size="xs" c="rgba(255,255,255,0.85)">{fieldLabel}</Text>

          {/* The schema's description, on hover. Inline it would reflow the
              form every time a field had something to say. */}
          {fieldHelp && !mirrors && (
            <Tooltip
              label={fieldHelp}
              position="top"
              withArrow
              multiline
              w={300}
              zIndex={10500}
              styles={{
                tooltip: {
                  background: alpha(theme.colors.dark[7], 0.97),
                  border: '0.1vh solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.75)',
                  fontFamily: 'Akrobat SemiBold',
                  fontSize: '1.2vh',
                  padding: '0.6vh 0.8vh',
                  lineHeight: 1.35,
                },
              }}
            >
              <Flex align="center" style={{ cursor: 'help' }}>
                <Info size="1.2vh" color="rgba(255,255,255,0.35)" />
              </Flex>
            </Tooltip>
          )}

          {mirrors && (
            <Tooltip
              label={t('fieldRow.comes_from_this_item_in_your_inventory_r', 'Comes from this item in your inventory — rename it there and it changes everywhere')}
              position="top"
              withArrow
              multiline
              w={260}
              zIndex={10500}
              styles={{
                tooltip: {
                  background: alpha(theme.colors.dark[7], 0.97),
                  border: '0.1vh solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.75)',
                  fontFamily: 'Akrobat SemiBold',
                  fontSize: '1.2vh',
                  padding: '0.6vh 0.8vh',
                },
              }}
            >
              <Flex align="center" style={{ cursor: 'help' }}>
                <Info size="1.2vh" color="rgba(255,255,255,0.4)" />
              </Flex>
            </Tooltip>
          )}
        </Flex>
        <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.28)">
          {mirrors ? t('fieldRow.from_inventory', 'from inventory') : column.key}
        </Text>
        {error && (
          <Text ff="Akrobat SemiBold" size="xxs" c="#E0776B" pt="0.2vh">
            {error}
          </Text>
        )}
      </Flex>
      )}

      {/* A field the owning script draws itself. Handed the whole row, because
          what it has to say is usually about a sibling. */}
      {column.type === 'custom' && column.component && resource && (
        <CustomControl
          resource={resource}
          component={column.component}
          value={value}
          onChange={onChange}
          canEdit={!disabled}
          row={row}
        />
      )}

      {column.type === 'slider' && (
        <SliderControl value={value} min={column.min} max={column.max ?? 1}
          bands={localisedBands} disabled={disabled} onChange={onChange} />
      )}

      {column.type === 'range' && (
        <RangeControl
          value={value}
          min={bounds?.[0] ?? column.min}
          max={bounds?.[1] ?? column.max}
          step={column.step}
          disabled={disabled}
          suffix={column.suffix}
          onChange={onChange}
        />
      )}

      {/* A row field can DO something too - testing the webhook you just
          pasted into a route is precisely when the button is wanted. */}
      {column.action && resource && (
        <Flex justify="flex-end">
          <FieldAction
            resource={resource}
            action={column.action}
            value={value}
            section={row}
            disabled={disabled}
          />
        </Flex>
      )}

      {column.type === 'peds' && (
        <PedsField
          value={value}
          disabled={disabled}
          label={column.label}
          onChange={onChange}
        />
      )}

      {column.type === 'objectMap' && (
        <ObjectMapControl
          value={value}
          columns={column.columns ?? []}
          optionsFrom={column.optionsFrom}
          resource={resource}
          disabled={disabled}
          onChange={onChange}
        />
      )}

      {column.type === 'redirectKind' && (
        <RedirectKindControl value={value} disabled={disabled} onChange={onChange} />
      )}

      {column.type === 'tags' && (
        <TagsControl
          value={value}
          disabled={disabled}
          numeric={column.numeric
            ?? (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'number'))}
          onChange={onChange}
        />
      )}

      {column.type === 'object' && (
        <Flex direction="column" gap="xxs" style={{ width: '100%' }}>
          {(column.columns ?? []).map((child) => (
            <Flex
              key={child.key}
              align="center" justify="space-between" gap="sm"
              px="xs" py="0.4vh"
              style={{
                background: alpha(theme.colors.dark[9], 0.4),
                border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.25)}`,
                borderRadius: '0.3vh',
              }}
            >
              <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.6)">{child.label}</Text>
              <SettingControl
                resource={resource}
                type={child.type}
                column={child}
                value={(value as Row | undefined)?.[child.key]}
                disabled={disabled}
                compact
                onChange={(next) => onChange({ ...(value as Row ?? {}), [child.key]: next })}
                onDrill={opensPicker(child.type) && onPick
                  ? () => onPick(child, {
                    read: () => (value as Row | undefined)?.[child.key],
                    write: (next) => onChange({ ...(value as Row ?? {}), [child.key]: next }),
                  })
                  : undefined}
              />
            </Flex>
          ))}
        </Flex>
      )}

      {column.type === 'groupGrades' && (
        <GroupGradeControl value={value} disabled={disabled} onChange={onChange} />
      )}

      {column.type === 'weekdays' && (
        <WeekdayControl value={value} disabled={disabled} onChange={onChange} />
      )}

      {column.type === 'positions' && (
        <PositionListControl value={value} disabled={disabled} onChange={onChange} />
      )}

      {column.type === 'weightMap' && (
        <WeightMapControl
          resource={resource}
          value={value}
          disabled={disabled}
          min={column.min}
          max={column.max}
          sourcePath={column.optionsFrom?.path}
          sourceKey={column.optionsFrom?.key}
          onChange={onChange}
        />
      )}

      {column.type === 'pickOne' && column.optionsFrom && resource && (
        <PickOneControl
          resource={resource}
          row={row}
          parentRow={parentRow}
          sourcePath={column.optionsFrom.path}
          sourceKey={column.optionsFrom.key}
          sourceLabelKey={column.optionsFrom.labelKey}
          value={value}
          disabled={disabled}
          onChange={onChange}
          anyLabel={column.anyLabel}
        />
      )}

      {column.type === 'pickList' && column.optionsFrom && resource && (
        <PickListControl
          resource={resource}
          sourcePath={column.optionsFrom.path}
          sourceKey={column.optionsFrom.key}
          sourceLabelKey={column.optionsFrom.labelKey}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      )}

      {column.type === 'keybindMap' && (
        <KeybindMapControl value={value} disabled={disabled} onChange={onChange} />
      )}

      {column.type === 'mantineColor' && (
        <MantineColorControl value={value} resource={resource} disabled={disabled} onChange={onChange} />
      )}

      {column.type === 'shade' && (
        <ShadeControl value={value} resource={resource} disabled={disabled} onChange={onChange} />
      )}

      {column.type === 'keyvalue' && (
        <KeyValueControl value={value} disabled={disabled} onChange={onChange} />
      )}

      {column.type === 'groups' && (
        <GroupsControl value={value} disabled={disabled} onChange={onChange} />
      )}

      {column.type === 'rows' && (
        <NestedRows
          column={column}
          resource={resource}
          value={value}
          disabled={disabled}
          onChange={onChange}
          parentRow={row}
        />
      )}

      {/* `pickOne` is handled above, out of the row it belongs to - it cannot
        * come from SettingControl, which has no idea what "the categories of
        * the store this row is inside" means. Without this it fell through to
        * the default text box and drew BOTH. */}
      {!wide && column.type !== 'pickOne' && (
        <SettingControl
          type={column.type}
          column={shownColumn}
          value={shown}
          disabled={disabled || mirrors}
          onChange={onChange}
          onDrill={opensPicker(column.type) && onPick ? () => onPick() : undefined}
        />
      )}
    </Flex>
  );
}
