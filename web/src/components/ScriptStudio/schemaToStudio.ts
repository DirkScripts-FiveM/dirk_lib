// Walks a real schema.json and produces the payload the hub renders.
//
// This is a working prototype of the Phase 2 adapter: everything the panel
// shows is derived here, so whatever this cannot express is a genuine gap in
// the schema vocabulary rather than a UI problem. Two such gaps are already
// visible in fishing and are handled explicitly below:
//
//   1. Several arrays (zones, stores, depthOverride) carry no `items` schema
//      at all - only `type: array` plus a `default`. Columns have to be
//      inferred from the default data. Filling in `items` is conversion work.
//   2. Nothing in the schema says which control to draw, so control type is
//      guessed from JSON Schema type + key naming. That guessing is exactly
//      what an explicit `x-control` annotation replaces.

import type { ScriptPage, ControlType, EnabledWhen, RowTab, SettingColumn, SettingEntry, SettingGroup, StudioScript } from './types';
import type { ValidationRule } from './conditions';

type JsonSchema = Record<string, any>;

export type StudioMeta = {
  resource: string;
  label: string;
  icon: string;
  version: string;
  shared?: boolean;
  /** group id -> lucide icon name */
  groupIcons?: Record<string, string>;
  /** paths that should render as the map control rather than a plain list */
  mapPaths?: string[];
  /** modal tabs per list path - fishing's fish editor has four of them */
  rowTabs?: Record<string, { id: string; label: string; icon: string; keys: string[] }[]>;
  /** demo overrides so MODIFIED / revert states are visible in the mock */
  overrides?: Record<string, unknown>;
  /**
   * Reassigns settings to a section by path, so one oversized top-level key
   * (fishing's `basic` holds ~40 settings covering six unrelated concerns)
   * becomes several findable sections. This is exactly what an `x-group`
   * annotation on each property does in Phase 2 - declared here so the
   * grouping can be judged before the schema is edited.
   *
   * First matching rule wins; anything unmatched keeps its schema section.
   */
  /**
   * Paths this script owns but does NOT show in its own rail, because the
   * panel presents them somewhere central instead - `access` belongs to the
   * Admins page. They stay in `entries` so that page can read and write them;
   * they just stop generating a section nobody should edit twice.
   */
  managedElsewhere?: string[];
  sections?: {
    id: string;
    label: string;
    icon: string;
    description?: string;
    /** this section owns the pane instead of joining the scrolling stack */
    workspace?: boolean;
    /** exact paths or prefixes (a prefix matches `prefix` and `prefix.*`) */
    paths: string[];
  }[];
};

// ── naming ──────────────────────────────────────────────────────────────────

/** `maxArtificialDepth` -> `Max Artificial Depth`, `baitDig` -> `Bait Dig` */
export function humanise(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ── control inference ───────────────────────────────────────────────────────

/**
 * How many numbers this place actually has.
 *
 * A yard's owner is a vector4 - somewhere to stand and a way to face. A zone
 * corner is a vector2; it has no height, and the map draws the ring flat. Ask
 * the same control for both and it writes back all four every time, so a corner
 * silently grows a `z` and a `w` that nothing reads and every diff shows.
 *
 * Declared beats counted: a field whose default is `{}` has nothing to count.
 */
export function vectorDims(node: JsonSchema, value?: unknown): 2 | 3 | 4 {
  if (node?.['x-vector2']) return 2;
  if (node?.['x-vector3']) return 3;
  if (node?.['x-vector4']) return 4;

  const props = node?.properties;
  if (props) {
    if ('w' in props) return 4;
    if ('z' in props) return 3;
    if ('x' in props && 'y' in props) return 2;
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (typeof v.w === 'number') return 4;
    if (typeof v.z === 'number') return 3;
  }

  // Four is what every position picker produces, so it is the safe guess for a
  // field that never said and has nothing stored yet.
  return 4;
}

function looksLikeCoords(value: unknown, node: JsonSchema): boolean {
  const props = node?.properties;
  if (props && 'x' in props && 'y' in props) return true;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return typeof v.x === 'number' && typeof v.y === 'number';
  }
  return false;
}

/**
 * Every field the rows of a list actually use, in the order first seen.
 *
 * Reading the shape off the FIRST row assumes every row has the same fields,
 * and real config does not work that way: of fishing's stock lines, forty
 * carry a `variance` and four carry a `ref`, and neither happens to be on the
 * first one. Those columns did not exist, so those values were invisible in
 * the panel, uneditable, and any rule written about them silently never ran.
 *
 * A field one row uses is a field of that list. Union, not sample.
 */
function keysAcross(rows: unknown[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const key of Object.keys(row as Record<string, unknown>)) seen.add(key);
  }
  return [...seen];
}

/** Every control the panel can render, for validating `x-control`. */
const CONTROL_TYPES = new Set<string>([
  'boolean', 'number', 'integer', 'percent', 'string', 'secret', 'weekdays',
  'text', 'enum', 'enumList', 'pickList', 'pickOne', 'color', 'blipColor', 'blipSprite',
  'blipDisplay', 'ped', 'peds', 'vehicle', 'vehicles', 'coords', 'positions', 'time', 'keybind',
  'control', 'controls', 'item', 'list', 'zones', 'palette', 'slider', 'range',
  'chance', 'multiplier', 'difficulty', 'forgiveness', 'rarity', 'balance', 'progression',
  'generosity',
  'group',
  'tags', 'model', 'account', 'accounts', 'mantineColor', 'shade', 'keyvalue',
  'icon',
  'custom',
  'keybindMap', 'groupGrades', 'weightMap',
  'discordChannel', 'redirectKind', 'duration', 'hourOfDay', 'boolChoice', 'objectMap',
  // A PROP placed in the world. Not to be confused with `objectMap`, which is
  // a map of arbitrary keys to values and has nothing to do with entities -
  // nor with the `object` TYPE, which is a nested block of sub-fields and is
  // inferred from the shape, never declared.
  'prop',
]);

/**
 * Declared controls that still have to go through inference.
 *
 * Not because the declaration is in doubt, but because these are assembled
 * from the schema below: `rows` needs its child columns, `pickList` its source
 * list, `range` its bounds. Returning one early gives you the right control
 * with nothing in it.
 */
const ENRICHED_BY_INFERENCE = new Set<string>([
  'rows', 'pickList', 'pickOne', 'weightMap', 'enumList', 'range', 'positions',
]);

/**
 * Annotations that NAME the control outright.
 *
 * These are read before any name matching, and that ordering is the whole
 * point. `x-secret` used to be ignored entirely, so `apiKeys.fivemanageKey`
 * fell past the credential rule (which wanted the key to end in "apiKey") into
 * the keybind rule (which only wanted it to end in "key") - and a Fivemanage
 * API token was configured by pressing a button on the keyboard.
 *
 * A schema that states what a field IS must never lose to a guess about what
 * it might be called. `x-itemPicker` and `x-vector4` were documented and never
 * read either; they are honoured here now.
 */
const EXPLICIT_CONTROLS: { flag: string; control: ControlType }[] = [
  { flag: 'x-secret', control: 'secret' },
  { flag: 'x-itemPicker', control: 'item' },
  { flag: 'x-installItem', control: 'item' },
  // All three say the same thing - "this is a place" - and differ only in how
  // much of one. The control is the same; what it WRITES BACK is trimmed to
  // the shape asked for, so a zone corner never grows a heading it has no use
  // for and a 2D point never grows a height.
  { flag: 'x-vector4', control: 'coords' },
  { flag: 'x-vector3', control: 'coords' },
  { flag: 'x-vector2', control: 'coords' },
  { flag: 'x-keybind', control: 'keybind' },
  { flag: 'x-groupPicker', control: 'group' },
  { flag: 'x-iconPicker', control: 'icon' },
];

/**
 * Best guess at which control a value wants. Order matters: explicit schema
 * annotations beat key naming, key naming beats raw JSON type - and the first
 * of those is absolute, not a tiebreak.
 */
export function inferControl(key: string, node: JsonSchema, value: unknown, inItemList = false): ControlType {
  const lower = key.toLowerCase();

  // 1. What the schema SAYS. Nothing below can override this.
  //
  // `x-control` names a control directly - the escape hatch for anything the
  // rules below get wrong, so a script never has to rename a field to be
  // rendered properly.
  // Naming a component is itself the declaration - `x-control: "custom"` is
  // then optional rather than a second thing to remember.
  if (typeof node?.['x-component'] === 'string') return 'custom';

  const declared = node?.['x-control'];
  if (typeof declared === 'string' && CONTROL_TYPES.has(declared)) return declared as ControlType;

  for (const { flag, control } of EXPLICIT_CONTROLS) {
    if (node?.[flag]) return control;
  }

  // 2. Everything else is inference.
  if (inItemList) return 'item';
  if (Array.isArray(node?.enum) || Array.isArray(node?.['x-enum'])) return 'enum';

  // A two-number array IS a range, whether or not it happens to ship a default.
  // Judging this by the value alone meant fish.weightLimits (has a default) got
  // the range control while fish.permitWeightLimit and rewardItems[].amount -
  // identical shape, no default - fell through to free-text chips.
  if (node?.type === 'array' && node.minItems === 2 && node.maxItems === 2) {
    const itemType = (node.items as JsonSchema | undefined)?.type;
    if (itemType === 'number' || itemType === 'integer') return 'range';
  }

  // 0-6, and nobody remembers which end Sunday is on
  if (/^days?ofweek$/.test(lower)) return 'weekdays';

  // An open map of name -> BOUNDED number: a weight, which is a slider.
  //
  // A `maximum` is what makes it a weight. Without one it is an open-ended
  // count - `basic.permitRevokers` is `{ police: 2 }`, a group and the rank it
  // needs - and treating that as a weight put a strength slider on it, capped
  // at 1, reporting rank 2 as "STRONG". Grade maps are handled further down.
  if (!/revokers?$/.test(lower)) {
    const openValues = node?.additionalProperties as JsonSchema | undefined;
    if (openValues
      && (openValues.type === 'number' || openValues.type === 'integer')
      && openValues.maximum !== undefined) {
      return 'weightMap';
    }
  }

  // an array constrained to a fixed set of members
  if (node?.type === 'array' && Array.isArray(node.items?.enum ?? node.items?.['x-enum'])) return 'enumList';

  // ── NO NAME GUESSING BELOW THIS LINE ──────────────────────────────────
  //
  // There used to be a run of rules here that picked a control from what the
  // key was CALLED: `/account$/` -> an account picker, `/model$/` -> a model
  // picker, `/^notes?$/` -> a textarea, and a dozen more. They were wrong in
  // ways nobody could predict from the schema: `maxBackupsPerAccount` is a
  // number and got an account picker; `defaultSync.notes` is a boolean and got
  // a textarea. Every fix was another guard on another regex.
  //
  // Every field that relied on one now declares `x-control` instead - taken
  // from what those rules actually produced, so the migration changed nothing
  // except the two that were wrong. What is left reads the DATA (a hex string
  // is a colour, a {_key} object is a keybind, an array of {x,y} is a polygon),
  // which is a fact about the value rather than a guess about English.

  // A hex string is a colour whatever the field is called - iconColors.zone
  // says nothing about colour in its own name.
  if (typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return 'color';
  // { _type, _key } is the library's keybind shape
  if (value && typeof value === 'object' && '_key' in (value as object)) return 'keybind';
  if (looksLikeCoords(value, node)) return 'coords';

  const type = node?.type ?? typeofValue(value);
  if (type === 'object' && !node?.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    // defaultControls is action -> { main: {_type,_key}, alt? } - a keybind map,
    // which the generic key/value editor cannot express
    const entries = Object.values(value as Record<string, unknown>);
    const isKeybindMap = entries.length > 0 && entries.every((entry) => {
      const main = (entry as { main?: unknown })?.main as { _key?: unknown } | undefined;
      return !!main && typeof main === 'object' && '_key' in main;
    });
    if (isKeybindMap) return 'keybindMap';
    // { police = 2 } is group -> minimum grade, which GroupSelect already
    // models properly (it knows the jobs and what each grade is called)
    const isGradeMap = entries.length > 0 && entries.every((entry) => typeof entry === 'number');
    if (isGradeMap || /revokers?$/i.test(lower)) return 'groupGrades';
    return 'keyvalue';
  }
  if (type === 'boolean') return 'boolean';
  if (type === 'integer') return 'integer';
  if (type === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (type === 'array') return 'list';
  if (type === 'object') return looksLikeCoords(value, node) ? 'coords' : 'string';
  return 'string';
}

function typeofValue(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null || value === undefined) return 'string';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function enumOptions(node: JsonSchema): { value: string; label: string }[] | undefined {
  const raw = node?.enum ?? node?.['x-enum'];
  if (!Array.isArray(raw)) return undefined;
  // `x-enumLabels` lets a schema name its own values. Humanising the raw value
  // is fine for `cut`/`crush`, and useless for locale codes - "Zh-TW" tells
  // nobody it is Traditional Chinese.
  const labels = (node?.['x-enumLabels'] ?? {}) as Record<string, string>;
  // Icons and colours for the same values. The owning script knows what its
  // categories LOOK like; dirk_lib does not and should not.
  const icons = (node?.['x-enumIcons'] ?? {}) as Record<string, string>;
  const colors = (node?.['x-enumColors'] ?? {}) as Record<string, string>;
  return raw.map((v: unknown) => {
    const value = String(v);
    return {
      value,
      label: labels[value] ?? humanise(value),
      icon: icons[value],
      color: colors[value],
    };
  });
}

// ── array columns ───────────────────────────────────────────────────────────

/**
 * Columns come from `items.properties` when the schema has them, and from the
 * first default row when it does not - which is the case for several of
 * fishing's arrays today.
 */
function columnsFor(node: JsonSchema, rows: unknown[]): { columns: SettingColumn[]; template: Record<string, unknown> } {
  const itemProps: JsonSchema | undefined = node?.items?.properties;

  // A live row first, then a SHIPPED one.
  //
  // Several of these arrays declare no `items` schema - their shape is only
  // ever implied by their default rows - so an emptied list had nothing left
  // to describe itself with: no sample, no columns, and a row editor with
  // nothing in it. Worse, it was unrecoverable from the panel, because adding
  // a row back needs the very columns that had just gone missing. The defaults
  // still know the shape, so they are the fallback.
  const isRow = (r: unknown) => !!r && typeof r === 'object' && !Array.isArray(r);
  const defaults = Array.isArray(node?.default) ? node.default : [];
  const sample = (rows.find(isRow) ?? defaults.find(isRow) ?? {}) as Record<string, unknown>;
  const installList = !!node?.['x-installItemList'];
  const arrayKey: string | undefined = node?.['x-arrayKey'];
  // Reward-pool rows name their own kind. baitDig.randomItems ships no `items`
  // schema and no x-installItemList, so `type: 'item'` is the only evidence
  // that `name` holds an item - and without it the old panel's item picker
  // came through as a plain text box.
  const itemRow = String(sample.type ?? '') === 'item';

  const requiredKeys = new Set<string>(Array.isArray(node?.items?.required) ? node.items.required : []);
  // Several of fishing's arrays declare no `items` schema at all - their shape
  // comes from the default rows - so a rule has no node to hang on. Declaring a
  // full item schema just to carry two rules is a lot of ceremony, so the array
  // itself carries them keyed by column. Keys may be dotted to reach a table
  // inside a row: `x-validateRows: { "stock.variance": [...] }` - which matters
  // because `stores` has BOTH a `name` and a `stock[].name`.
  const rowRules = (node?.['x-validateRows'] ?? {}) as Record<string, ValidationRule[]>;
  // Controls for those same columns, for the same reason: several of fishing's
  // arrays declare no `items` schema at all - their shape comes from the
  // default rows - so there is no per-field node to put `x-control` on. Keyed
  // by column, dotted to reach inside a nested object: `"blip.color"`.
  /**
   * A control name, or a control WITH its options.
   *
   * Several of these arrays ship no `items` schema, so there is no per-field
   * node to hang `enum` or `x-optionsFrom` on - and adding a partial one would
   * silently drop every column it did not list, because the keys come from
   * `items.properties` the moment that exists. The long form says the same
   * things here instead:
   *
   *   "type":           { "control": "enum", "options": ["equipment", ...] }
   *   "stock.category": { "control": "pickOne",
   *                       "optionsFrom": { "path": "self.categories" } }
   */
  type RowControl = string | {
    control: string;
    options?: (string | { value: string; label?: string })[];
    optionsFrom?: { path: string; key?: string; labelKey?: string };
    anyLabel?: string;
    iconSet?: 'lucide' | 'fontawesome';
    boundsFrom?: { path: string };
    /**
     * Greyed out unless a sibling field says otherwise.
     *
     * The same statement `x-enabledWhen` makes, written where there is room
     * for it: several of these arrays ship no `items` schema at all, so a zone
     * has no node for its permit price to carry the rule on - and the price
     * and interval then sat there fully editable on a zone that requires no
     * permit, saying nothing about why they did nothing.
     */
    enabledWhen?: { path: string; equals?: unknown };
    action?: { label: string; callback: string; icon?: string; sendSection?: boolean };
    /**
     * A component the owning script ships, for a field inside a ROW.
     *
     * Settings could already have one; row fields could not, so anything a
     * script wanted to draw its own way had to become a top-level setting or
     * go without. Same contract as `x-component`, written where row controls
     * are declared because that is where a row's fields are described.
     */
    component?: string;
  };
  const rowControls = (node?.['x-rowControls'] ?? {}) as Record<string, RowControl>;

  const controlName = (entry: RowControl) => (typeof entry === 'string' ? entry : entry.control);

  /** Everything the long form adds, written onto a built column. */
  const applyRowControl = (target: SettingColumn, entry: RowControl) => {
    const name = controlName(entry);
    if (!CONTROL_TYPES.has(name)) return;
    target.type = name as SettingColumn['type'];
    if (typeof entry === 'string') return;

    if (entry.options) {
      target.options = entry.options.map((option) => (typeof option === 'string'
        ? { value: option, label: humanise(option) }
        : { value: option.value, label: option.label ?? humanise(option.value) }));
    }
    if (entry.optionsFrom) {
      target.optionsFrom = {
        path: entry.optionsFrom.path,
        key: entry.optionsFrom.key ?? 'name',
        labelKey: entry.optionsFrom.labelKey,
      };
    }
    if (entry.component) {
      target.type = 'custom';
      target.component = entry.component;
    }
    if (entry.anyLabel) target.anyLabel = entry.anyLabel;
    if (entry.iconSet) target.iconSet = entry.iconSet;
    if (entry.action?.callback) target.action = entry.action;
    if (entry.enabledWhen?.path) {
      target.enabledWhen = {
        path: entry.enabledWhen.path,
        equals: entry.enabledWhen.equals === undefined ? true : entry.enabledWhen.equals,
      };
    }
    if (entry.boundsFrom?.path) target.boundsFrom = { path: entry.boundsFrom.path };
  };
  /**
   * The order fields appear in the row editor.
   *
   * Without this the order is whatever order the keys happen to sit in - the
   * `items` schema if there is one, otherwise the first default row - which is
   * an accident of how the data was written, not a decision about what you
   * read first. Listed keys lead, in this order; everything else keeps its
   * existing position behind them.
   *
   * Same idea as `x-sections.paths` does for a page.
   */
  const declaredOrder: string[] = Array.isArray(node?.['x-rowOrder']) ? node['x-rowOrder'] : [];

  // Live rows first, then the shipped defaults - an emptied list still knows
  // its shape, and a list someone has added a field to still shows it.
  const naturalKeys = itemProps
    ? Object.keys(itemProps)
    : keysAcross(rows.length > 0 ? rows : defaults);
  const keys = declaredOrder.length > 0
    ? [
      ...declaredOrder.filter((key) => naturalKeys.includes(key)),
      ...naturalKeys.filter((key) => !declaredOrder.includes(key)),
    ]
    : naturalKeys;
  const columns: SettingColumn[] = [];
  const template: Record<string, unknown> = {};

  const shapeSource = rows.length > 0 ? rows : defaults;

  for (const key of keys) {
    const child: JsonSchema = itemProps?.[key] ?? {};
    // The sample row, or whichever row actually HAS this field.
    //
    // Four of fishing's stores carry a numeric `lvlRequired` and the first one
    // does not, so the column was built against `undefined` and came out as a
    // text box for what is a number. A field is described by a row that uses
    // it, not by a row that happens to be first.
    const value = sample[key] !== undefined
      ? sample[key]
      : (shapeSource.find((row) => row && typeof row === 'object'
        && (row as Record<string, unknown>)[key] !== undefined) as
          Record<string, unknown> | undefined)?.[key];
    const isItemKey = /name$|^item$/.test(key);
    const declaredItem = installList && key === arrayKey;
    const column = buildColumn(
      key,
      // An x-rowControls entry is the same statement `x-control` makes, just
      // written where there is room for it.
      rowControls[key] ? { ...child, 'x-control': controlName(rowControls[key]!) } : child,
      value,
      declaredItem || (itemRow && isItemKey),
      declaredItem,
      shapeSource.map(
        (row) => (row && typeof row === 'object' ? (row as Record<string, unknown>)[key] : undefined),
      ),
    );
    // An opaque identity the panel fills in, not something to type. Read-only
    // because the key is what smartMerge matches rows on - editing it after
    // other rows or saved data reference it silently orphans them.
    const genId = child?.['x-generateId'];
    if (genId) {
      column.generated = true;
      column.readOnly = true;
      if (typeof genId === 'string') column.idPrefix = genId;
    }

    const iconSet = child?.['x-iconSet'];
    if (iconSet === 'fontawesome' || iconSet === 'lucide') column.iconSet = iconSet;

    const bounds = child?.['x-boundsFrom'];
    if (bounds?.path) column.boundsFrom = { path: String(bounds.path) };
    if (requiredKeys.has(key)) column.required = true;
    if (rowRules[key]) column.validate = [...(column.validate ?? []), ...rowRules[key]!];
    if (rowControls[key]) applyRowControl(column, rowControls[key]!);
    columns.push(column);
    // NOT `?? value`. `sample` is the first existing row and it is here to
    // infer what a column IS when the schema does not say - it is not what a
    // NEW row should contain. Seeding from it meant "Add fish" opened already
    // filled in with another fish, and anything left untouched was saved as a
    // silent duplicate of it.
    //
    // The exception is a key every SHIPPED row agrees on. `type: "item"` is the
    // same in all nine of the reward-pool defaults - it describes the shape
    // rather than any one entry, and a new row without it is malformed. A key
    // the defaults disagree on is content, and stays blank.
    template[key] = child.default ?? constantDefault(defaults, key) ?? defaultForControl(column.type);
  }

  // dotted keys, resolved against the columns just built
  for (const [dotted, entry] of Object.entries(rowControls)) {
    if (!dotted.includes('.')) continue;
    const [parent, child] = dotted.split('.');
    const target = columns.find((c) => c.key === parent)?.columns?.find((c) => c.key === child);
    if (target) applyRowControl(target, entry);
  }

  for (const [key, rules] of Object.entries(rowRules)) {
    if (!key.includes('.')) continue;
    const parts = key.split('.');
    let level: SettingColumn[] | undefined = columns;
    let target: SettingColumn | undefined;
    for (const part of parts) {
      target = level?.find((column) => column.key === part);
      level = target?.columns;
    }
    if (target) target.validate = [...(target.validate ?? []), ...rules];
  }

  return { columns, template };
}

/**
 * Builds one column, including the nested shapes a row can hold: a pair of
 * numbers is a range, a list of strings is a tag set, a list of objects is a
 * nested table, and a bounded 0..n float is a slider.
 */
function buildColumn(
  key: string,
  child: JsonSchema,
  value: unknown,
  isItem: boolean,
  declaredItem = false,
  /**
   * This field's value on EVERY row, not just the sample one.
   *
   * A nested table is described by the rows it holds, and the sample row holds
   * only its own: the first store's stock lines carry no `variance`, forty
   * lines in other stores do, and reading the shape off the first store alone
   * meant that column did not exist anywhere. The whole list describes the
   * whole list.
   */
  siblings?: unknown[],
): SettingColumn {
  // Rows written before a field existed simply do not carry it, and the editor
  // showed those blank - fish[].minigameType is declared `default: "cut"` and
  // only the eight crustaceans store "crush", so every other species opened
  // with an empty gutting minigame. Carrying the schema default through means
  // the row editor can show what the server will actually use.
  const built = buildColumnInner(key, child, value, isItem, siblings);
  const out: SettingColumn = child.default !== undefined ? { ...built, default: child.default } : built;
  // A field inside a row editor had nowhere to say what it means. Inline help
  // works in the settings list because every row is one line; in a modal it
  // would push the form around, so this rides on a hover instead.
  if (typeof child.description === 'string' && child.description) out.help = child.description;
  // "Only applies while that field says X", within the row. Same `self.`
  // convention x-validate already uses for referring to a sibling field.
  const gate = child['x-enabledWhen'] as { path?: string; equals?: unknown } | undefined;
  if (gate?.path) out.enabledWhen = { path: gate.path, equals: gate.equals };
  // Only a DECLARED item counts for the install audit. `isItem` also covers the
  // reward-pool heuristic, which is right for rendering a picker and wrong for
  // telling someone their inventory is missing an entry.
  if (declaredItem || child['x-installItem']) out.installItem = true;
  if (child['x-validateWith']) out.validateWith = child['x-validateWith'];
  // constraints ride along so a row editor can be validated the same way a
  // top-level setting is
  if (typeof child.minItems === 'number') out.minItems = child.minItems;
  const rules = child['x-validate'] as ValidationRule[] | undefined;
  if (Array.isArray(rules)) out.validate = rules;
  return out;
}

function buildColumnInner(
  key: string,
  child: JsonSchema,
  value: unknown,
  isItem: boolean,
  siblings?: unknown[],
): SettingColumn {
  // A declared `title` wins over the humanised key. Without this a column
  // could only ever be called what its property is called, so `channelId`
  // read as "Channel Id" and `url` as "Url" no matter what the schema said.
  const label = typeof child.title === 'string' && child.title ? child.title : humanise(key);
  const min = child.minimum;
  const max = child.maximum;

  // A SINGLE value that has to name a row in another list - a tournament runs
  // in one fishing zone, or anywhere. x-optionsFrom was only honoured on
  // arrays, so the scalar case had nowhere to go and fell through to free
  // text, where a typo silently means "nowhere".
  const mapsObjects = (child.additionalProperties as JsonSchema | undefined)?.type === 'object';
  if (child.type !== 'array' && !mapsObjects) {
    const one = child['x-optionsFrom'] as
      { path?: string; key?: string; labelKey?: string } | string | undefined;
    if (one) {
      const path = typeof one === 'string' ? one : one.path;
      if (path) {
        return {
          key, label, type: 'pickOne',
          // "Leave blank for any location" is a real choice, not an empty
          // field, so the blank option is named rather than nameless.
          anyLabel: typeof child['x-anyLabel'] === 'string'
            ? (child['x-anyLabel'] as string)
            : undefined,
          optionsFrom: {
            path,
            key: (typeof one === 'string' ? 'name' : one.key) ?? 'name',
            labelKey: typeof one === 'string' ? undefined : one.labelKey,
          },
        };
      }
    }
  }

  // arrays inside a row
  const arrayValue = Array.isArray(value) ? value : (Array.isArray(child.default) ? child.default : undefined);
  const isArray = child.type === 'array' || arrayValue !== undefined;

  if (isArray && !looksLikeCoords(value, child)) {
    /**
     * A DECLARED control beats shape inference. The same rule the nested-object
     * branch had to learn.
     *
     * Everything below this line reads the VALUE to work out what kind of list
     * this is — and every one of those guesses used to run before `x-control`
     * was consulted at all, so declaring one on an array did precisely nothing.
     * `fitsModels` asked for a vehicle picker and got free-text chips, with no
     * error to say why.
     *
     * The exceptions are the controls that are NOT self-sufficient: the
     * branches below are what give them their options, their columns or their
     * bounds, and short-circuiting would hand back an empty one.
     */
    const declared = child['x-control'];
    if (typeof declared === 'string'
      && CONTROL_TYPES.has(declared)
      && !ENRICHED_BY_INFERENCE.has(declared)) {
      return { key, label, type: declared as SettingColumn['type'] };
    }

    const rows = arrayValue ?? [];
    const sample = rows.find((r) => r && typeof r === 'object' && !Array.isArray(r)) as Record<string, unknown> | undefined;
    const itemProps: JsonSchema | undefined = child?.items?.properties;

    // A list of world positions, not a generic table - four number boxes per
    // entry is the data but not the job. Checked BEFORE the object branch,
    // which would otherwise claim it.
    if (rows.length > 0 && rows.every((r) => r && typeof r === 'object' && !Array.isArray(r)
      && typeof (r as Record<string, unknown>).x === 'number'
      && typeof (r as Record<string, unknown>).y === 'number'
      && typeof (r as Record<string, unknown>).z === 'number')) {
      return { key, label, type: 'positions' };
    }

    if (sample || itemProps) {
      // Every row of this table, from every row of the table it sits in.
      const everyRow = siblings
        ? [...rows, ...siblings.flatMap((cell) => (Array.isArray(cell) ? cell : []))]
        : rows;
      const nestedKeys = itemProps ? Object.keys(itemProps) : keysAcross(everyRow);
      const nested: SettingColumn[] = [];
      const nestedTemplate: Record<string, unknown> = {};
      for (const nestedKey of nestedKeys) {
        const nestedChild: JsonSchema = itemProps?.[nestedKey] ?? {};
        // ...and the sample VALUE for a key the first row lacks comes from
        // whichever row does have it, or the column has nothing to judge by.
        const nestedValue = sample?.[nestedKey] !== undefined
          ? sample[nestedKey]
          : (everyRow.find((r) => r && typeof r === 'object'
            && (r as Record<string, unknown>)[nestedKey] !== undefined) as
              Record<string, unknown> | undefined)?.[nestedKey];
        const built = buildColumn(nestedKey, nestedChild, nestedValue, /name$|^item$/.test(nestedKey));
        // A nested table declares what it requires the same way a top-level
        // one does. Without this a store's stock rows could be saved blank -
        // the outer row validated, the table inside it was merely non-empty,
        // and nothing looked at the rows themselves.
        if (Array.isArray(child.items?.required)
          && (child.items.required as string[]).includes(nestedKey)) {
          built.required = true;
        }
        nested.push(built);
        nestedTemplate[nestedKey] = nestedChild.default ?? defaultForControl(built.type);
      }
      return {
        key, label, type: 'rows',
        columns: nested,
        rowTemplate: nestedTemplate,
        rowLabelKey: nested.find((c) => c.type === 'item')?.key ?? nested[0]?.key,
      };
    }

    // payment accounts come from the framework, so they get the account picker
    // rather than a free-text tag editor. `paymentMethods` holds the same thing
    // as `permitAccounts`, it is just named for what the store does with it.
    if (/accounts$/i.test(key) || /^paymentmethods$/i.test(key)) return { key, label, type: 'accounts' };
    // "Job / gang / ACE group names" - suggest the framework's own groups but
    // still allow a typed ACE name like group.admin
    if (/groups$/i.test(key)) return { key, label, type: 'groups' };
    // 0-6, and nobody remembers which end Sunday is on
    if (/^days?ofweek$/i.test(key)) return { key, label, type: 'weekdays' };

    // A list of names that must match rows in ANOTHER setting - a tournament's
    // `fish` has to name species that exist. Declared with x-optionsFrom, or
    // inferred when the key is simply the name of a top-level list ('fish' ->
    // fish[].name). Free text here accepts a typo and the tournament then
    // scores nothing, silently.
    const from = child['x-optionsFrom'] as
      { path?: string; key?: string; labelKey?: string } | string | undefined;
    if (from) {
      const path = typeof from === 'string' ? from : from.path;
      if (path) {
        return {
          key, label, type: 'pickList',
          optionsFrom: {
            path,
            key: (typeof from === 'string' ? 'name' : from.key) ?? 'name',
            // What a person should SEE when the stored value is an opaque id.
            // A business points at places by id; showing the id back is a
            // worse control than the free-text box it replaced.
            labelKey: typeof from === 'string' ? undefined : from.labelKey,
          },
        };
      }
    }
    if (siblingLists.has(key) && rows.every((r) => typeof r === 'string')) {
      return { key, label, type: 'pickList', optionsFrom: { path: key, key: 'name' } };
    }

    // A list whose members come from a fixed set - fish.waterTypes is
    // ["fresh","salt"] and nothing else. Free-text chips accept "saltwater"
    // and the fish then never spawns anywhere, silently.
    const memberEnum = child.items?.enum ?? child.items?.['x-enum'];
    if (Array.isArray(memberEnum) && memberEnum.length > 0) {
      return {
        key, label, type: 'enumList',
        options: memberEnum.map((option) => ({ value: String(option), label: humanise(String(option)) })),
      };
    }

    // A fixed pair of numbers reads as a range, not a list. Take that from the
    // SCHEMA where it says so - judging by the value alone meant an identical
    // field got the range control only when it happened to ship a default
    // (fish.weightLimits did, fish.permitWeightLimit and rewardItems[].amount
    // did not, and those two fell through to free-text chips).
    const numericItems = child.items?.type === 'number' || child.items?.type === 'integer';
    // Bounds on a PAIR live on the items, not on the array - `minimum` beside
    // `minItems` would be a length, not a value. Reading only the array's own
    // minimum left a depth of -10 perfectly acceptable.
    const pairMin = min ?? child.items?.minimum;
    const pairMax = max ?? child.items?.maximum;
    if (child.minItems === 2 && child.maxItems === 2 && numericItems) {
      return {
        key, label, type: 'range', min: pairMin, max: pairMax,
        step: child.items?.multipleOf ?? (child.items?.type === 'integer' ? 1 : undefined),
      };
    }

    const allNumbers = rows.length > 0 && rows.every((r) => typeof r === 'number');
    if (allNumbers && rows.length === 2) return { key, label, type: 'range', min: pairMin, max: pairMax };
    // Whether these are numbers is declared, not inferred from the current
    // value: an EMPTY list satisfies `every()` vacuously, so a list of script
    // names with nothing in it yet read as numeric and turned the first name
    // typed into 0.
    return { key, label, type: 'tags', numeric: numericItems || allNumbers };
  }

  // An OPEN map of name -> weight, declared by additionalProperties. Falling
  // through to the object branch below froze the keys to whatever the first
  // default row happened to carry, so fish[].baitTypes showed one fish's baits
  // on every fish and nothing could be added.
  // same rule as above: a `maximum` is what makes an open numeric map a weight
  const openValues = child.additionalProperties as JsonSchema | undefined;
  if (openValues
    && (openValues.type === 'number' || openValues.type === 'integer')
    && openValues.maximum !== undefined
    && !/revokers?$/i.test(key)) {
    return {
      key, label, type: 'weightMap',
      min: openValues.minimum ?? 0,
      max: openValues.maximum ?? 1,
      optionsFrom: weightMapSource(key),
    };
  }

  // An OPEN map whose values are OBJECTS - `{ [anything]: { a, b } }`.
  //
  // The numeric case above is rescued; this one was not, so it fell into the
  // plain-object branch and froze the keys to whichever entries the shipped
  // default happened to carry. zones[].perFishModifiers came out as three
  // fixed species, each a nested box, with no way to add a fourth.
  //
  // Where the keys come from is DECLARED (`x-optionsFrom`), never guessed from
  // the field name - the panel has no business knowing what a fish is.
  const openObjects = child.additionalProperties as JsonSchema | undefined;
  if (openObjects?.type === 'object' && openObjects.properties
    && Object.keys(openObjects.properties).length > 0) {
    const shape = openObjects.properties as JsonSchema;
    return {
      key,
      label,
      type: 'objectMap',
      columns: Object.keys(shape).map((childKey) =>
        buildColumn(childKey, shape[childKey] as JsonSchema, undefined, false)),
      optionsFrom: child['x-optionsFrom'] as { path: string; key: string } | undefined,
    };
  }

  // plain nested object
  //
  // Skipped entirely when the field DECLARES a control. This branch fires on
  // `type: 'object'` alone, so it used to claim every declared object before
  // `inferControl` below was ever reached — meaning `x-control` on an object
  // field silently did nothing and the field rendered as a run of plain boxes.
  // An explicit declaration beats shape inference; that is what declaring is.
  if (!child['x-control']
    && (child.type === 'object' || (value !== null && typeof value === 'object' && !Array.isArray(value) && !looksLikeCoords(value, child)))) {
    const sample = (value ?? child.default ?? {}) as Record<string, unknown>;
    const props: JsonSchema | undefined = child.properties;
    const nestedKeys = props ? Object.keys(props) : Object.keys(sample);
    if (nestedKeys.length > 0) {
      return {
        key, label, type: 'object',
        columns: nestedKeys.map((nestedKey) =>
          buildColumn(nestedKey, props?.[nestedKey] ?? {}, sample[nestedKey], false)),
      };
    }

    // An object with no fixed fields is a MAP - its keys are data. A zone's
    // per-species overrides are keyed by fish name, so listing the species
    // that happen to be in the shipped zones would say those are the only ones
    // a zone may modify. Declared `additionalProperties`, or simply empty
    // right now: either way it takes key/value pairs, and falling through to
    // the default text box - which is what an emptied one used to do - offers
    // a box that cannot hold what the field is.
    return { key, label, type: 'keyvalue' };
  }

  const control = inferControl(key, child, value, isItem);

  // a bounded float is a slider - biteChance, fightChance, strengthPerUnit and
  // abundance are all 0..1 or 0..2 in fishing's schema
  if ((control === 'number' || control === 'integer')
    && typeof min === 'number' && typeof max === 'number' && max <= 2) {
    // `x-bandLabels` names the steps. Without it the slider borrows fishing's
    // difficulty words, so a blip's SIZE reads "Weak" at its smallest.
    return { key, label, type: 'slider', min, max, bandLabels: child?.['x-bandLabels'] };
  }

  return {
    key, label, type: control, options: enumOptions(child), min, max,
    bandLabels: child?.['x-bandLabels'],
    // What the two sides of a `boolChoice` are called. Rows were the one place
    // this never made it through, so a `x-boolLabels` inside an array item was
    // read, validated, and then dropped - the control fell back to "Off / On"
    // with nothing to say why.
    boolLabels: child?.['x-boolLabels'],
    vectorDims: control === 'coords' ? vectorDims(child, value) : undefined,
    // Which prop the placer spawns. Per-field, because only the schema
    // knows this one is a laptop and the next one is a vending machine.
    propModel: typeof child['x-propModel'] === 'string' ? child['x-propModel'] : undefined,
  };
}

/**
 * The value of `key` when every shipped row has the SAME one, else undefined.
 *
 * That is the test for "structural": a discriminator like `type: "item"` is
 * part of what a row IS, while a name or a price is what one particular row
 * happens to say.
 */
function constantDefault(defaults: unknown[], key: string): unknown {
  const rows = defaults.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
  if (rows.length === 0) return undefined;
  const first = rows[0]![key];
  // Only worth carrying for primitives; two objects being "the same" is a
  // deeper question than a new row needs answered.
  if (first === undefined || (typeof first === 'object' && first !== null)) return undefined;
  return rows.every((row) => row[key] === first) ? first : undefined;
}

function defaultForControl(control: ControlType): unknown {
  switch (control) {
    case 'boolean': return false;
    case 'number': case 'integer': case 'percent': case 'chance': case 'slider': return 0;
    case 'blipColor': return 46;
    case 'blipSprite': return 1;
    case 'blipDisplay': return 4;
    case 'weekdays': return [];
    case 'enumList': return [];
    case 'pickList': return [];
    case 'weightMap': return {};
    case 'text': return '';
    case 'secret': return '';
    case 'coords': return { x: 0, y: 0, z: 0 };
    case 'range': return [0, 0];
    case 'keyvalue': case 'keybindMap': case 'groupGrades': return {};
    case 'refs': return [];
    case 'positions': return [];
    case 'mantineColor': return 'dirk';
    case 'shade': return 5;
    case 'groups': return [];
    case 'tags': case 'rows': case 'peds': return [];
    case 'object': return {};
    default: return '';
  }
}

/**
 * Which field titles a row in a list.
 *
 * `x-itemTitle` names it outright and wins - it was documented and never read,
 * so a schema that said "title these rows by `name`" was still guessed at.
 * Everything after it is the guess, in descending order of confidence.
 */
/** One entry of `x-mapPaths` in its long form. */
type MapPathSpec = {
  path: string;
  color?: string;
  shape?: 'polygon' | 'marker';
  /** Named positions within each row, when a row is more than one place. */
  points?: { key: string; label?: string; color?: string }[];
  /**
   * May a pin on this layer be dragged?
   *
   * `false` for anything captured by STANDING somewhere: a barn find's owner
   * has a height and a heading, and a map has neither to give back. Those are
   * shown on the map and set in the row editor.
   */
  movable?: boolean;
};

/** The declared map paths, plus the styling declared alongside them. */
type MapMeta = Set<string> & {
  colors: Map<string, string>;
  shapes: Map<string, 'polygon' | 'marker'>;
  points: Map<string, { key: string; label?: string; color?: string }[]>;
  movable: Map<string, boolean>;
};

/**
 * Outline or pin?
 *
 * A row carrying an array of {x,y} is a boundary. A row carrying x and y
 * directly is a single point. The second is by far the more common geographic
 * shape in FiveM - every store, ATM, garage and spawn list - and used to draw
 * nothing at all, because the map only knew how to render polygons.
 */
function detectMapShape(rows: unknown[]): 'polygon' | 'marker' {
  const sample = rows.find((row) => row && typeof row === 'object' && !Array.isArray(row)) as
    Record<string, unknown> | undefined;
  if (!sample) return 'polygon';

  const hasOutline = Object.values(sample).some((value) => Array.isArray(value)
    && value.length > 2
    && typeof (value[0] as { x?: unknown })?.x === 'number');
  if (hasOutline) return 'polygon';

  if (typeof sample.x === 'number' && typeof sample.y === 'number') return 'marker';
  return 'polygon';
}

/**
 * Sections that are a WORKSPACE go last, in their declared order among
 * themselves.
 *
 * A workspace control fills the pane, so one sitting in the middle of the
 * running order means scrolling through a full screen of map to reach the next
 * toggle. Putting them at the end keeps the ordinary settings as one continuous
 * read, and a map is somewhere you go rather than something you scroll past.
 *
 * This is the one place the panel overrides the order a schema declared. The
 * rail still lists them, so nothing is hidden - it is the reading order that
 * changes, not the contents.
 */
function orderGroups(groups: SettingGroup[], entries: SettingEntry[]): SettingGroup[] {
  const declared = new Set(groups.filter((g) => g.workspace).map((g) => g.id));

  const isWorkspace = (id: string) => {
    // Declared with `x-workspace` counts the same as inferred from content.
    // Ordering used to judge only by what a section CONTAINS, so a declared
    // one kept its place in the scrolling stack while behaving like a
    // workspace - in the rail it sat among the ordinary sections instead of
    // down with its own kind.
    if (declared.has(id)) return true;
    const mine = entries.filter((entry) => entry.group === id);
    if (mine.length === 0) return false;
    // Dominated by one, rather than merely containing one: a section with a map
    // and a dozen settings still reads as settings.
    const workspaces = mine.filter((entry) => entry.type === 'zones' || entry.type === 'custom');
    return workspaces.length > 0 && mine.length - workspaces.length <= 2;
  };

  const ordinary = groups.filter((g) => !isWorkspace(g.id));
  const workspaces = groups.filter((g) => isWorkspace(g.id));
  return [...ordinary, ...workspaces];
}

function rowLabelKey(
  columns: SettingColumn[],
  arrayKey?: string,
  itemTitle?: string,
): string | undefined {
  if (itemTitle && columns.some((column) => column.key === itemTitle)) return itemTitle;
  const stringCols = columns.filter((c) => c.type === 'string');
  const label = stringCols.find((c) => c.key === 'label' || c.key === 'name');
  if (label) return label.key;
  if (arrayKey && columns.some((c) => c.key === arrayKey)) return arrayKey;
  return stringCols[0]?.key ?? columns[0]?.key;
}

function rowItemKey(columns: SettingColumn[]): string | undefined {
  return columns.find((c) => c.type === 'item')?.key;
}

// ── the walk ────────────────────────────────────────────────────────────────

/**
 * Where an open map's KEYS should be picked from, when we can tell.
 * `baitTypes` names baits, and a script that configures bait has them in a list
 * already - offering those beats free text that has to match exactly.
 */
function weightMapSource(key: string): { path: string; key: string } | undefined {
  // NOT gated on siblingLists: that set only holds top-level ARRAYS, and
  // fishing's `equipment` is an object holding rods/reel/line/bait/... so the
  // guard was never true and the bait picker came up empty every time. The
  // control resolves the path against the real entry list at render, so a
  // script without `equipment.bait` just gets no suggestions.
  if (/^baittypes?$/i.test(key)) return { path: 'equipment.bait', key: 'name' };
  return undefined;
}

/** Group id for settings shown on a central page rather than the script's rail. */
export const MANAGED_ELSEWHERE = '__managed_elsewhere';

/**
 * Top-level settings that ARE a list, for the conversion currently running.
 * A column named after one of them (a tournament's `fish`) is a reference to
 * it, not free text. Module-level because buildColumn sits several frames down
 * and threading it through every signature would be noise; it is written once
 * at the top of each conversion and read synchronously below.
 */
let siblingLists = new Set<string>();

/** Follow a dotted path into a schema's properties. */
function nodeAt(schema: JsonSchema, path: string): JsonSchema | undefined {
  let node: JsonSchema | undefined = schema;
  for (const part of path.split('.')) {
    node = node?.properties?.[part];
    if (!node) return undefined;
  }
  return node;
}

/**  declared on each array, gathered into the shape the walk wants. */
function collectRowTabs(topLevel: JsonSchema): Record<string, RowTab[]> {
  const out: Record<string, RowTab[]> = {};

  // Walks the whole tree, keyed by PATH.
  //
  // This only read top-level properties, so an array nested inside a section -
  // `logger.routes` - declared tabs that were collected for nobody and its
  // editor stayed a flat list with the row's internal key on show. Paths are
  // what the lookup uses at the other end, so the key must be the full path
  // rather than the property name, which is not unique across branches.
  const walk = (node: JsonSchema | undefined, path: string) => {
    if (!node || typeof node !== 'object') return;

    const tabs = node['x-rowTabs'] as RowTab[] | undefined;
    if (Array.isArray(tabs) && path) out[path] = tabs;

    const props = node.properties as JsonSchema | undefined;
    if (props) {
      for (const [name, child] of Object.entries(props)) {
        walk(child as JsonSchema, path ? `${path}.${name}` : name);
      }
    }
  };

  for (const [name, node] of Object.entries(topLevel)) walk(node as JsonSchema, name);
  return out;
}

export function schemaToStudio(schema: JsonSchema, meta: StudioMeta): StudioScript {
  const groups: SettingGroup[] = [];
  const entries: SettingEntry[] = [];
  const overrides = meta.overrides ?? {};
  const mapPaths: MapMeta = Object.assign(new Set(meta.mapPaths ?? []), {
    colors: new Map<string, string>(),
    shapes: new Map<string, 'polygon' | 'marker'>(),
    points: new Map<string, { key: string; label?: string; color?: string }[]>(),
    movable: new Map<string, boolean>(),
  });
  const mapColors = mapPaths.colors;
  const mapShapes = mapPaths.shapes;
  const mapPoints = mapPaths.points;
  const mapMovable = mapPaths.movable;

  const topLevel: JsonSchema = schema?.properties ?? {};

  // A script's LAYOUT is the script's business, so it travels in the script's
  // schema rather than a table inside dirk_lib. The meta still wins when one is
  // supplied, which keeps the door open for a host override, but nothing needs
  // to supply it - a script that ships its own layout just works.
  const sections = meta.sections ?? (schema?.['x-sections'] as StudioMeta['sections']);
  /**
   * Pages this script supplies. Declared, never inferred - the panel has no
   * way to guess that a resource ships a screen, and a missing file should be
   * a page that says so rather than a rail entry that was never offered.
   */
  const pages: ScriptPage[] = Array.isArray(schema['x-pages'])
    ? (schema['x-pages'] as Record<string, string>[])
      .filter((page) => page?.id && page?.component)
      .map((page) => ({
        id: String(page.id),
        label: String(page.label ?? humanise(String(page.id))),
        icon: String(page.icon ?? 'square-dashed'),
        component: String(page.component),
        description: page.description ? String(page.description) : undefined,
      }))
    : [];

  const rowTabs = meta.rowTabs ?? collectRowTabs(topLevel);
  // `x-mapPaths` takes either a bare path or `{ path, color, shape }`. The
  // colour matters: ZoneMap used to pick one by matching the path against
  // 'seaBoundary' and 'depthOverride' by name - fishing's field names, hardcoded
  // inside dirk_lib, which is exactly the per-script knowledge that must live in
  // the owning schema.
  const declaredMapPaths = (schema?.['x-mapPaths'] as (string | MapPathSpec)[]) ?? [];
  for (const declared of declaredMapPaths) {
    const spec = typeof declared === 'string' ? { path: declared } : declared;
    if (!spec?.path) continue;
    mapPaths.add(spec.path);
    if (spec.color) mapColors.set(spec.path, spec.color);
    if (spec.shape) mapShapes.set(spec.path, spec.shape);
    if (spec.points) mapPoints.set(spec.path, spec.points);
    if (spec.movable !== undefined) mapMovable.set(spec.path, spec.movable !== false);
  }

  siblingLists = new Set(
    Object.entries(topLevel)
      .filter(([, node]) => node?.type === 'array' || Array.isArray(node?.default))
      .map(([name]) => name),
  );

  for (const [groupId, groupNode] of Object.entries(topLevel)) {
    groups.push({
      id: groupId,
      label: humanise(groupId),
      icon: (groupNode?.['x-icon'] as string) ?? meta.groupIcons?.[groupId] ?? 'sliders-horizontal',
      description: groupNode?.description,
      workspace: groupNode?.['x-workspace'] === true,
    });

    const serverOnly = !!groupNode?.['x-serverOnly'];

    // A top-level array (fish, zones, stores) is a section holding one list.
    if (groupNode?.type === 'array' || Array.isArray(groupNode?.default)) {
      entries.push(buildListEntry(groupId, groupId, groupNode, groupId, serverOnly, overrides, mapPaths, undefined, rowTabs));
      continue;
    }

    walkObject(groupNode, groupId, groupId, serverOnly, entries, overrides, mapPaths, undefined, rowTabs);
  }

  // ── constraints ─────────────────────────────────────────────────────────
  //
  // The schema IS the validator. `minimum`/`maximum`/`minItems` were already
  // here and only being used to clamp inputs, so nothing stopped a save with a
  // blank required field or an empty list. `required` is a JSON Schema keyword
  // on the PARENT, so it is read from there; `x-validate` carries the two rules
  // JSON Schema cannot say - a backwards [min,max], and "required only when".
  for (const entry of entries) {
    const node = nodeAt(schema, entry.path);
    if (!node) continue;

    const cut = entry.path.lastIndexOf('.');
    const parent = cut === -1 ? schema : nodeAt(schema, entry.path.slice(0, cut));
    const key = entry.path.slice(cut + 1);
    if (Array.isArray(parent?.required) && parent.required.includes(key)) entry.required = true;

    if (typeof node.minItems === 'number') entry.minItems = node.minItems;
    const rules = node['x-validate'] as ValidationRule[] | undefined;
    if (Array.isArray(rules)) entry.validate = rules;
  }

  // ── x-enabledWhen ───────────────────────────────────────────────────────
  //
  // "This only applies while that says X." Declared on a field, or on a whole
  // block to cover every field in it - which is what a master switch actually
  // means: `theme.useOverride` off disables the entire theme, not one row of
  // it. The field a rule POINTS AT is never disabled by it, or turning a
  // switch off would grey out the switch and leave no way back.
  for (const entry of entries) {
    // Every ancestor, nearest first - not just the top-level property.
    // `basic.bigFishDifficulty` is a master switch over the three numbers
    // beside it, and only the outermost block was ever consulted, so a rule
    // written one level in was read by nobody and quietly did nothing.
    const parts = entry.path.split('.');
    let rule = nodeAt(schema, entry.path)?.['x-enabledWhen'] as EnabledWhen | undefined;
    for (let i = parts.length - 1; i > 0 && !rule; i -= 1) {
      rule = nodeAt(schema, parts.slice(0, i).join('.'))?.['x-enabledWhen'] as EnabledWhen | undefined;
    }
    if (rule && rule.path !== entry.path) entry.enabledWhen = rule;
  }

  const matches = (path: string, patterns: string[]) =>
    patterns.some((p) => path === p || path.startsWith(`${p}.`));

  // The ten custom stops are edited through `theme.primaryColor` now - pick
  // "custom" there and the base picker appears beside it while Primary Shade
  // renders the stops. A standalone section repeated the same swatches a
  // scroll further down and made the theme look like three settings instead of
  // one decision. The VALUE stays in `entries`; only the row goes.
  for (const entry of entries) {
    if (!entry.path.endsWith('.primaryColor')) continue;
    const prefix = entry.path.slice(0, entry.path.lastIndexOf('.'));
    const custom = entries.find((other) => other.path === `${prefix}.customTheme`);
    if (custom) custom.group = MANAGED_ELSEWHERE;
  }

  // Parked in a group the rail never lists, which drops the section without
  // dropping the values.
  // Settings a dedicated PAGE owns. `bridging` has the Bridges page, which
  // shows what each choice actually resolved to on this server; `access` has
  // the Admins page. Leaving them in the rail as well meant the same values in
  // two places, and two places disagree.
  const managedElsewhere = meta.managedElsewhere
    ?? (schema?.['x-managedElsewhere'] as string[] | undefined);
  if (managedElsewhere?.length) {
    for (const entry of entries) {
      if (matches(entry.path, managedElsewhere)) entry.group = MANAGED_ELSEWHERE;
    }
  }

  // Re-home settings into declared sections, then order the rail so the
  // declared ones lead and anything unclaimed keeps its schema position.
  if (sections?.length) {

    /**
     * Where each setting sits INSIDE its section.
     *
     * A section lists its paths in the order it wants them read - a master
     * switch first, then what it governs - but entries are built by walking
     * the schema, so they came out in property order regardless. That is why
     * "Disable Permit System" sat at the bottom of the section it controls.
     *
     * Only settings a section actually names are reordered; anything matched
     * by a prefix keeps its schema order after them, because a prefix says
     * nothing about the order of what is under it.
     */
    const rank = new Map<string, number>();

    for (const entry of entries) {
      if (entry.group === MANAGED_ELSEWHERE) continue;
      const section = sections.find((s) => matches(entry.path, s.paths));
      if (!section) continue;
      entry.group = section.id;

      const named = section.paths.indexOf(entry.path);
      if (named >= 0) rank.set(entry.path, named);

      // a sub-block label only helps when it is not just restating the section
      if (entry.subgroup && entry.subgroup.label === section.label) entry.subgroup = undefined;
    }

    if (rank.size > 0) {
      /**
       * Reordered WITHIN each group, in place.
       *
       * Sorting the whole array with a comparator that returns 0 for entries
       * in different groups is not a total order - the result is whatever the
       * engine felt like, which is why the switch stayed at the bottom. This
       * rewrites each group's slots with that group's members in their
       * declared order, leaving every other position untouched.
       */
      const slots = new Map<string, number[]>();
      entries.forEach((entry, index) => {
        const list = slots.get(entry.group);
        if (list) list.push(index);
        else slots.set(entry.group, [index]);
      });

      for (const indices of slots.values()) {
        const members = indices.map((index) => entries[index]!);
        const ordered = members
          .map((entry, position) => ({ entry, position }))
          .sort((a, b) => {
            const ra = rank.get(a.entry.path);
            const rb = rank.get(b.entry.path);
            // Named settings lead, in the order the section named them;
            // everything else keeps the order the schema gave it.
            if (ra !== undefined && rb !== undefined) return ra - rb;
            if (ra !== undefined) return -1;
            if (rb !== undefined) return 1;
            return a.position - b.position;
          })
          .map((item) => item.entry);

        indices.forEach((slot, position) => { entries[slot] = ordered[position]!; });
      }
    }

    for (const section of sections) {
      // A section whose id happens to match a top-level property - `places`,
      // `fish`, `equipment` - already has an auto-built group under that id.
      // Skipping it here threw the DECLARED label, icon and description away
      // and left the generic ones, which is why every such section showed the
      // default sliders icon while `devices` (id ≠ property `phones`) kept its
      // phone. The declaration is the author's intent, so it wins.
      const existing = groups.find((g) => g.id === section.id);
      if (existing) {
        existing.label = section.label;
        existing.icon = section.icon;
        existing.description = section.description ?? existing.description;
        if (section.workspace) existing.workspace = true;
        continue;
      }
      groups.push({
        id: section.id,
        label: section.label,
        icon: section.icon,
        description: section.description,
        workspace: section.workspace === true,
      });
    }

    const order = new Map(sections.map((s, i) => [s.id, i]));
    groups.sort((a, b) => (order.get(a.id) ?? 500) - (order.get(b.id) ?? 500));
  }

  return {
    resource: meta.resource,
    label: meta.label,
    icon: meta.icon,
    version: meta.version,
    shared: meta.shared,
    pages: pages.length > 0 ? pages : undefined,
    groups: orderGroups(
      groups.filter((g) => g.id !== MANAGED_ELSEWHERE && entries.some((e) => e.group === g.id)),
      entries,
    ),
    entries,
  };
}

function walkObject(
  node: JsonSchema,
  path: string,
  group: string,
  serverOnly: boolean,
  out: SettingEntry[],
  overrides: Record<string, unknown>,
  mapPaths: MapMeta,
  subgroup: SettingEntry['subgroup'],
  rowTabs?: StudioMeta['rowTabs'],
) {
  const props: JsonSchema = node?.properties ?? {};
  const defaults: Record<string, unknown> = (node?.default ?? {}) as Record<string, unknown>;

  for (const [key, child] of Object.entries(props)) {
    const childPath = `${path}.${key}`;
    const childServerOnly = serverOnly || !!child?.['x-serverOnly'];
    const fallback = child?.default ?? defaults?.[key];

    if (child?.type === 'array' || Array.isArray(fallback)) {
      out.push(buildListEntry(childPath, key, child, group, childServerOnly, overrides, mapPaths, subgroup, rowTabs));
      continue;
    }

    // A nested object becomes a labelled sub-block inside the section rather
    // than a flat run of dotted paths. Objects with NO declared properties fall
    // through to the key/value editor instead - there is nothing to recurse.
    if (child?.type === 'object' && child?.properties && Object.keys(child.properties).length > 0
      && !looksLikeCoords(fallback, child)) {
      walkObject(child, childPath, group, childServerOnly, out, overrides, mapPaths, {
        id: childPath,
        label: labelFor(key, child),
        // `x-skill` says this block IS a levelling curve. The four numbers in
        // it mean nothing on their own - nobody can read "modifier 1.4" and
        // picture what it costs to reach level 10 - so the block draws the
        // curve it describes underneath itself.
        //
        // Named, not just flagged, because a script can have several: fishing
        // has one, a scrapyard's reputation is another, and they are edited on
        // different pages of the same panel.
        skill: typeof child?.['x-skill'] === 'string' ? child['x-skill'] : undefined,
      }, rowTabs);
      continue;
    }

    const control = inferControl(key, child, fallback);
    const value = childPath in overrides ? overrides[childPath] : fallback;

    out.push({
      path: childPath,
      label: labelFor(key, child),
      help: child?.description,
      type: control,
      group,
      subgroup,
      default: fallback,
      value,
      // Bounds on a PAIR live on the items, not on the array - `minimum`
      // beside `type: array` means "at least this many entries", not "no
      // lower than this". Without the fallback a two-point slider came
      // through with nothing to slide between.
      min: child?.minimum ?? child?.items?.minimum,
      max: child?.maximum ?? child?.items?.maximum,
      options: enumOptions(child),
      // What unit a `duration` value is stored in. Declared, because the
      // control has to convert from it and guessing from the field name is
      // how "86400 seconds" became a thing you had to work out.
      durationBase: child?.['x-durationBase'],
      // What the two sides of a `boolChoice` are called. The panel cannot
      // know that `useScenario: false` means a shovel.
      boolLabels: child?.['x-boolLabels'],
      // What a slider calls its own steps, low to high. Without it every
      // slider borrowed fishing's difficulty words, so a blip's SIZE read
      // "Weak" at its smallest.
      bandLabels: child?.['x-bandLabels'],
      // How many numbers a place has. A zone corner is flat; an owner faces a
      // way. Same control, different shape written back.
      vectorDims: control === 'coords' ? vectorDims(child, fallback) : undefined,
      propModel: typeof child['x-propModel'] === 'string' ? child['x-propModel'] : undefined,
      // "That is set over there." A setting can point at another script's
      // setting rather than describing where to find it in prose.
      goTo: child?.['x-goTo'],
      serverOnly: childServerOnly || undefined,
      // Declared, not inferred - the missing-items audit reads this.
      installItem: child?.['x-installItem'] ? true : undefined,
      // A NUI callback that says whether the typed value actually works.
      validateWith: child?.['x-validateWith'],
      // Which icon set the value belongs to, when it is an icon.
      iconSet: child?.['x-iconSet'],
      // Which band of the Bridges page this belongs in, when it is a bridge.
      bridgeGroup: child?.['x-bridgeGroup'],
      // A button beside the field, for something that has an effect.
      action: child?.['x-action']?.callback ? {
        label: String(child['x-action'].label ?? 'Run'),
        callback: String(child['x-action'].callback),
        icon: child['x-action'].icon ? String(child['x-action'].icon) : undefined,
        sendSection: child['x-action'].sendSection === true,
      } : undefined,
      component: child?.['x-component'],
      componentFull: child?.['x-componentFull'] === true,
    });
  }
}


/**
 * What to call a setting: its declared `title`, else the humanised key.
 *
 * Without this a schema could rename a row's columns but not the setting that
 * holds them, so a list titled "Redirects" still opened a modal called "New
 * route".
 */
function labelFor(key: string, node?: JsonSchema): string {
  const title = node?.title;
  return typeof title === 'string' && title ? title : humanise(key);
}

function buildListEntry(
  path: string,
  key: string,
  node: JsonSchema,
  group: string,
  serverOnly: boolean,
  overrides: Record<string, unknown>,
  mapPaths: MapMeta,
  subgroup?: SettingEntry['subgroup'],
  rowTabs?: StudioMeta['rowTabs'],
): SettingEntry {
  const fallback = Array.isArray(node?.default) ? node.default : [];
  const value = path in overrides ? overrides[path] : fallback;
  const rows = Array.isArray(value) ? value : [];

  // FIRST, before any shape rule. An array is where a custom editor is most
  // likely to be wanted, and this function never consults inferControl - it
  // decides its own type - so a declared component would otherwise be carried
  // on the entry and never actually rendered.
  //
  // It still carries everything a LIST carries. A custom control draws the
  // rows and hands one back to the panel to edit, and the panel builds that
  // form out of exactly this metadata - columns, the row template, the row
  // label, x-rowTabs. Without it the rows looked right and the editor opened
  // empty.
  if (typeof node?.['x-component'] === 'string') {
    const custom = columnsFor(node, rows);
    return {
      path,
      label: labelFor(key, node),
      help: node?.description,
      type: 'custom',
      group,
      subgroup,
      default: fallback,
      value,
      component: node['x-component'],
      componentFull: node['x-componentFull'] === true,
      rowLabelKey: rowLabelKey(custom.columns, node?.['x-arrayKey'], node?.['x-itemTitle']),
      rowOrdered: Array.isArray(node?.['x-rowOrder']),
      rowItemKey: rowItemKey(custom.columns),
      rowTabs: rowTabs?.[path],
      columns: custom.columns,
      rowTemplate: custom.template,
      serverOnly: serverOnly || undefined,
    };
  }

  /**
   * The rows that describe this list's SHAPE.
   *
   * The live value when there is one, the shipped default when there is not.
   * Emptying a `[min, max]` pair otherwise left nothing to judge by, and it
   * came back as a single nameless text box - the same way an emptied object
   * list lost its columns. What a list IS does not change because it happens
   * to be empty right now.
   */
  const shapeRows = rows.length > 0
    ? rows
    : (Array.isArray(node?.default) ? node.default : []);

  const numericRows = shapeRows.length > 0 && shapeRows.every((r) => typeof r === 'number');
  const namedControls = /(control|key)/i.test(key);

  // A pair of numbers is a min/max, whatever it is called. This has to be
  // tested BEFORE the control-id branch: that branch used to claim any array
  // of numbers, which turned baitDig.gridDensity ([5,10] dig tiles) and
  // basic.cellFishDensity into GTA control-id pickers.
  if (numericRows && shapeRows.length === 2 && !namedControls) {
    return {
      path,
      label: labelFor(key, node),
      help: node?.description,
      type: 'range',
      group,
      subgroup,
      default: fallback,
      value,
      // Bounds live on the ITEMS - `minimum` beside `type: array` means "at
      // least this many entries", not "no lower than this". Without this the
      // slider had nothing to slide between and came out unusable.
      min: node?.minimum ?? node?.items?.minimum,
      max: node?.maximum ?? node?.items?.maximum,
      // Whole numbers when the schema says so - `multipleOf`, or an integer
      // item type, which means the same thing and is the commoner spelling.
      step: node?.items?.multipleOf ?? node?.multipleOf
        ?? (node?.items?.type === 'integer' ? 1 : undefined),
      serverOnly: serverOnly || undefined,
    };
  }

  // Numeric control ids drive IsControlPressed / DisableControlAction, which is
  // a different thing from a keybind primary key - the library models them as
  // separate components, so the schema walk has to tell them apart too. The
  // KEY has to say so; being an array of numbers is not evidence.
  if (namedControls && (numericRows || rows.length === 0)) {
    return {
      path,
      label: labelFor(key, node),
      help: node?.description,
      type: 'controls',
      group,
      subgroup,
      default: fallback,
      value,
      serverOnly: serverOnly || undefined,
    };
  }

  // A Mantine colour tuple is a fixed 10 shades generated from one root colour,
  // not a list an admin adds to - so it gets the palette control.
  const isPalette = /theme$/i.test(key) || (
    rows.length === 10 && rows.every((r) => typeof r === 'string' && /^#?[0-9a-f]{3,8}$/i.test(String(r)))
  );
  if (isPalette) {
    return {
      path,
      label: labelFor(key, node),
      help: node?.description,
      type: 'palette',
      group,
      subgroup,
      default: fallback,
      value,
      serverOnly: serverOnly || undefined,
    };
  }

  // Arrays of plain strings/numbers get a single synthetic column so they can
  // still be added to and removed from.
  // These were only checked when building a COLUMN, so a top-level array of
  // strings - basic.permitAccounts is ["cash","bank"] - rendered as "entry 1,
  // entry 2" instead of the picker that knows what those words mean.
  if (/accounts$/i.test(key)) {
    return {
      path, label: humanise(key), help: node?.description, type: 'accounts',
      group, subgroup, default: fallback, value, serverOnly: serverOnly || undefined,
    };
  }
  if (/groups$/i.test(key)) {
    return {
      path, label: humanise(key), help: node?.description, type: 'groups',
      group, subgroup, default: fallback, value, serverOnly: serverOnly || undefined,
    };
  }

  // A list of world positions. The generic table renderer turns each one into
  // four number boxes, and nobody configures a store by typing coordinates -
  // the old panel gave these a goto/set pair and this keeps that.
  if (rows.length > 0 && rows.every((row) => row && typeof row === 'object' && !Array.isArray(row)
    && typeof (row as Record<string, unknown>).x === 'number'
    && typeof (row as Record<string, unknown>).y === 'number'
    && typeof (row as Record<string, unknown>).z === 'number')) {
    return {
      path, label: humanise(key), help: node?.description, type: 'positions',
      group, subgroup, default: fallback, value, serverOnly: serverOnly || undefined,
    };
  }

  // Rows that point at other settings rather than holding a value.
  if (node?.['x-arrayKey'] === 'ref' || (rows[0] && typeof rows[0] === 'object' && 'ref' in (rows[0] as object))) {
    return {
      path, label: humanise(key), help: node?.description, type: 'refs',
      group, subgroup, default: fallback, value, serverOnly: serverOnly || undefined,
    };
  }

  const isScalarList = rows.length > 0 && rows.every((r) => typeof r !== 'object' || r === null);

  /**
   * An EMPTY list is not evidence of anything.
   *
   * "No `items` schema and no rows" was being read as "a list of loose
   * values", which gave it one column called `value`. For a list whose shape
   * only ever came from its default rows - several of fishing's - that is
   * wrong the moment someone empties it: the columns vanish, the row editor
   * offers a single nameless field, and the list can never be filled back in
   * from the panel. The shipped rows still describe the shape, so they get a
   * say before that conclusion is drawn.
   */
  const shippedRows = Array.isArray(node?.default) ? node.default : [];
  const shippedAreObjects = shippedRows.some((r) => r && typeof r === 'object' && !Array.isArray(r));

  if (!shippedAreObjects && (isScalarList || (!node?.items?.properties && rows.length === 0))) {
    return {
      path,
      label: labelFor(key, node),
      help: node?.description,
      type: 'list',
      group,
      subgroup,
      rowLabelKey: 'value',
      columns: [{ key: 'value', label: humanise(key), type: inferControl(key, {}, rows[0]) }],
      rowTemplate: { value: '' },
      default: fallback,
      value,
      serverOnly: serverOnly || undefined,
    };
  }

  const { columns, template } = columnsFor(node, rows);

  return {
    path,
    label: labelFor(key, node),
    help: node?.description,
    type: mapPaths.has(path) ? 'zones' : 'list',
    // A row holding sibling numeric x and y IS a point - a store, an ATM, a
    // spawn - and is drawn as a pin. A row holding an array of those is an
    // outline. Detecting it means a place list needs no extra annotation, and
    // `x-mapPaths` can still override when the rows are empty on a fresh
    // install and there is nothing to judge.
    mapShape: mapPaths.has(path) ? (mapPaths.shapes.get(path) ?? detectMapShape(rows)) : undefined,
    mapColor: mapPaths.has(path) ? mapPaths.colors.get(path) : undefined,
    mapPoints: mapPaths.has(path) ? mapPaths.points.get(path) : undefined,
    // Can a pin on this layer be DRAGGED? `movable: false` on the x-mapPaths
    // entry says the position is not map data - it is somewhere you stood,
    // with a height and a heading a map cannot express - so the map shows it
    // and the row editor sets it.
    mapMovable: mapPaths.has(path) ? mapPaths.movable.get(path) : undefined,
    component: node?.['x-component'],
    componentFull: node?.['x-componentFull'] === true,
    group,
    subgroup,
    rowLabelKey: rowLabelKey(columns, node?.['x-arrayKey'], node?.['x-itemTitle']),
    rowOrdered: Array.isArray(node?.['x-rowOrder']),
    rowItemKey: rowItemKey(columns),
    rowTabs: rowTabs?.[path],
    columns,
    rowTemplate: template,
    default: fallback,
    value,
    serverOnly: serverOnly || undefined,
  };
}
