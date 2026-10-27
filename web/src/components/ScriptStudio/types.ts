import type * as React from 'react';
import type { Condition, ValidationRule } from './conditions';

// Shape the hub renders from. Deliberately mirrors what a schema.json walk
// would produce server-side (label / help / type / default / value per path),
// so swapping mock data for the real describe() payload is a data change only.

export type ControlType =
  | 'boolean'
  | 'number'
  | 'integer'
  | 'percent'
  | 'string'
  | 'secret'
  | 'weekdays'
  | 'text'
  | 'enum'
  | 'enumList'
  /** one of nine screen positions (plus "as drawn"), as a 3x3 grid of screens */
  | 'anchor'
  | 'pickList'
  | 'pickOne'
  | 'chance'
  | 'multiplier'
  | 'difficulty'
  | 'forgiveness'
  | 'rarity'
  | 'generosity'
  | 'balance'
  | 'progression'
  | 'color'
  | 'blipColor'
  | 'blipSprite'
  | 'blipDisplay'
  | 'ped'
  /** several ped models, shown as pictures rather than names */
  | 'peds'
  | 'vehicle'
  /** several vehicle models, the way `peds` is several peds */
  | 'vehicles'
  | 'coords'
  /**
   * A PROP, placed in the world.
   *
   * Deliberately not called `object`: a column whose value is a nested object
   * of sub-fields already carries that type, and the row editor renders those
   * by mapping their child columns. Giving the placer the same name made it
   * render as a label with nothing beside it, because a placer has no
   * children to map.
   */
  | 'prop'
  /**
   * An AREA, marked out in the world.
   *
   * What `prop` is to a point, this is to a footprint: a centre, a facing and
   * three sides. Fields about how much ROOM something has - a delivery pile, a
   * spawn patch - cannot be expressed by a position, and a map polygon is the
   * wrong scale for two metres against a shutter.
   */
  | 'box'
  /**
   * A CAMERA SHOT, framed in a free camera rather than typed:
   * `{ pos: {x,y,z}, rot: {x,y,z}, fov }`. Other keys on the object are kept.
   */
  | 'camera'
  /** several camera shots in order - a camera path */
  | 'cameras'
  | 'positions'
  | 'time'
  | 'keybind'
  | 'control'
  | 'controls'
  | 'item'
  /** one framework job or gang, picked from the server's real list */
  | 'group'
  /** the owning script supplies the editor; see `x-component` */
  | 'custom'
  /** a lucide icon, picked by looking at it rather than typed */
  | 'icon'
  | 'list'
  | 'zones'
  | 'palette'
  | 'slider'
  | 'range'
  | 'tags'
  | 'account'
  | 'accounts'
  | 'groups'
  | 'model'
  | 'keyvalue'
  | 'weightMap'
  /** a Discord channel the bot can post in, picked from the live list */
  | 'discordChannel'
  /** one / several Discord roles, picked from the bot's server */
  | 'discordRole'
  | 'discordRoles'
  /** webhook URL or Discord bot - which way a redirect reaches Discord */
  | 'redirectKind'
  /** a length of time, read in whatever unit divides cleanly */
  | 'duration'
  /** an hour of the day, 0-23, picked by name rather than typed */
  | 'hourOfDay'
  /** a boolean shown as the two things it picks between */
  | 'boolChoice'
  /** an open map whose values are objects - rows of key + its fields */
  | 'objectMap'
  | 'keybindMap'
  | 'groupGrades'
  | 'refs'
  | 'mantineColor'
  | 'shade'
  | 'rows'
  /** a nested object of sub-fields, rendered as a small stack of them */
  | 'object';

export type SettingOption = {
  /**
   * lucide icon name and hex colour for this value, from `x-enumIcons` /
   * `x-enumColors`.
   *
   * dirk_lib cannot know that a place category of "fuel" is a blue pump - that
   * is the owning script's knowledge, so it travels in the schema. Carried on
   * the option itself so one annotation serves both the picker (a grid of real
   * pins instead of a dropdown of words) and the map (markers in the script's
   * own colours).
   */
  icon?: string;
  color?: string; value: string; label: string };

export type SettingColumn = {
  /**
   * Path to a component the OWNING resource ships, for a field inside a row.
   *
   * The row equivalent of `SettingEntry.component`. Declared through
   * `x-rowControls`, because that is where a row's fields are described.
   */
  component?: string;
  /** tags: the items are numbers - declared by the schema, never guessed */
  numeric?: boolean;
  /** see SettingEntry.validateWith */
  validateWith?: string;
  /**
   * This column holds an inventory item because the SCHEMA said so
   * (`x-installItem` / `x-installItemList`), not because the control was
   * inferred as an item picker.
   *
   * The missing-items audit uses this and nothing else. Auditing by rendered
   * control meant any row with a `name` field got scraped, so dirk_phone was
   * told the job names "realestate" and "ambulance" were missing items.
   */
  installItem?: boolean;
  key: string;
  /** schema constraints, checked before a save is allowed */
  required?: boolean;
  minItems?: number;
  validate?: ValidationRule[];
  label: string;
  type: ControlType;
  suffix?: string;
  /** the smallest change allowed - 1 for whole numbers. From `multipleOf`. */
  step?: number;
  /**
   * What unit a `duration` value is STORED in - declared, never guessed.
   *
   * The control shows whichever unit reads best, but it has to know what the
   * number already means to convert it. Inferring that from a field name
   * would put the whole thing back to guessing.
   */
  durationBase?: 'seconds' | 'minutes' | 'hours' | 'days';
  /** boolChoice: what the two sides are called */
  boolLabels?: { true?: string; false?: string };
  options?: SettingOption[];
  /** pickList: the setting whose rows supply the options, e.g. 'fish' */
  /** the schema's description, shown on hover inside a row editor */
  help?: string;
  /**
   * Grey this field out unless a sibling in the same row says otherwise.
   *
   * `{ path: 'self.permitRequired', equals: true }` - the permit price on a
   * fish means nothing until that fish needs a permit. Row editors ignored
   * `x-enabledWhen` entirely, so those fields stayed editable and looked as
   * though they applied.
   */
  enabledWhen?: { path: string; equals?: unknown };
  /**
   * This column's value is machine-generated on a new row, not typed.
   *
   * Set by `x-generateId` on a field that is the array's `x-arrayKey`. The key
   * is the row's identity for smartMerge, so it must exist and must not drift
   * once rows reference it - hence `readOnly` alongside it.
   */
  generated?: boolean;
  /** optional prefix for a generated id, e.g. `c` -> `c_m1x8k2_a4f9` */
  idPrefix?: string;
  /** shown, but not editable */
  readOnly?: boolean;
  /** what the blank option means for a `pickOne`, e.g. "Anywhere" */
  anyLabel?: string;
  optionsFrom?: { path: string; key: string ; labelKey?: string };
  min?: number;
  max?: number;
  /**
   * `x-bandLabels` - what a slider calls its own steps, low to high.
   *
   * Sliders were named with fishing's difficulty bands (Weak / Moderate /
   * Strong) whatever they measured, so a blip's SIZE read "Weak" at its
   * smallest. A field that says what its steps are called also gets a neutral
   * colour, because the traffic lights are a judgement that only a difficulty
   * has an opinion about.
   */
  bandLabels?: string[];
  /** How many numbers a `coords` column holds: 2, 3 or 4. */
  vectorDims?: 2 | 3 | 4;
  /** Prop model the `prop` control places. From `x-propModel`. */
  propModel?: string;
  /** Boolean keys on a `camera` object, drawn as switches under the shot. */
  cameraFlags?: { key: string; label: string; help?: string }[];
  /** `x-bodyHeight`: captured positions are lifted to body height. See bodyHeight.ts. */
  bodyHeight?: boolean;
  /**
   * Props to stand inside a `box` while it is being marked out, so the size is
   * judged against what will really be there. From `x-boxSample`.
   *
   * Only the schema knows this particular field is a parcel pile — the tool is
   * told, exactly as the prop placer is told its model.
   */
  boxSample?: { models?: string[]; count?: number };
  /** the schema's default for this field, shown when a row omits the key */
  default?: unknown;
  /** rows/object columns carry their own child columns */
  columns?: SettingColumn[];
  rowTemplate?: Record<string, unknown>;
  rowLabelKey?: string;
  /**
   * Limits taken from another field on the row - `x-boundsFrom`.
   *
   * A permit's weight limit is only meaningful inside the weights that fish
   * actually reaches, and that range is a different pair of numbers for every
   * species. Nothing static can say it, so the field points at the one that
   * can.
   */
  boundsFrom?: { path: string };
  /** which icon set an `icon` field's value belongs to - `x-iconSet` */
  iconSet?: 'lucide' | 'fontawesome' | 'both';
  /** a button beside this field that does something - see SettingEntry.action */
  action?: { label: string; callback: string; icon?: string; sendSection?: boolean };
  /** which modal tab this field belongs to */
  tab?: string;
};

export type RowTab = { id: string; label: string; icon: string; keys: string[] };

/**
 * "This setting only applies while that one says X."
 *
 * Declared with `x-enabledWhen` on a field, or on a whole block to cover every
 * field in it. The controlling field is never disabled by its own rule.
 */
export type EnabledWhen = Condition & { path: string; equals?: unknown };

export type SettingEntry = {
  /**
   * Another setting holding where the thing being placed ALREADY sits, for an
   * `anchor` control to show as a ghost while it is on "as drawn" - `x-anchorHintFrom`.
   *
   * Without it the grid is nine identical empty cells until you change
   * something, which tells you nothing about where your chat is right now.
   */
  anchorHintFrom?: string;
  /**
   * A value the script PUBLISHES - `x-hidden` on the field.
   *
   * Carried like any other setting so a control can read it, and drawn by
   * nothing: a row nobody may change, sitting between rows they may, reads as
   * broken rather than as information.
   */
  hidden?: boolean;
  /** declared with `x-installItem`; see SettingColumn.installItem */
  installItem?: boolean;
  /**
   * NUI callback that says whether a typed value is actually valid, from
   * `x-validateWith`.
   *
   * Range checks catch a number out of bounds; only the service behind an API
   * key can say the key works. Without this a revoked token looks exactly like
   * a good one until something silently fails much later.
   */
  validateWith?: string;
  /**
   * How this array draws on the map: an outline per row, or a pin per row.
   * Only set for a path listed in `x-mapPaths`.
   */
  mapShape?: 'polygon' | 'marker';
  /**
   * Where a marker row keeps its positions, when it keeps more than one.
   *
   * A row with a single place puts `x`/`y` on itself and needs none of this.
   * A row that IS two places — a barn find's owner and the car he is selling —
   * holds a `{x,y,z,w}` under each named key, and each one gets its own pin.
   */
  mapPoints?: { key: string; label?: string; color?: string }[];
  /** `movable: false` on the map path — pins are shown but never dragged. */
  mapMovable?: boolean;
  /**
   * `toggle` on the map path: a boolean column drawn as a switch on each row in the map's list; a row switched off draws
   * greyed on the map. For areas decided on/off rather than drawn (dirk_containers' collision map).
   */
  mapToggle?: string;
  /** `readOnly` on the map path: no add, draw, edit, delete or modal - the rows are shown (and switched, with `toggle`). */
  mapReadOnly?: boolean;
  /** the map colour this layer was given in `x-mapPaths` */
  mapColor?: string;
  /**
   * Path to a component the OWNING resource ships, from `x-component`.
   *
   * Read out of that resource by Lua and evaluated in the panel, so a script
   * can render something only it understands without a line of its code
   * living in dirk_lib.
   */
  component?: string;
  /**
   * Let the script's own control fill the whole workspace.
   *
   * A control sits in a setting ROW by default - label and description on the
   * left, the control framed beside them - which is right for something that
   * belongs among other settings. A map is not that: it wants the pane, and
   * framing one inside a row inside a padded pane boxes it in twice. Opt in
   * with `x-componentFull` and the row chrome and the frame both step aside.
   */
  componentFull?: boolean;
  path: string;
  /** schema constraints, checked before a save is allowed */
  required?: boolean;
  minItems?: number;
  validate?: ValidationRule[];
  /** greyed out, with the reason, while this condition is unmet */
  enabledWhen?: EnabledWhen;
  label: string;
  help?: string;
  type: ControlType;
  group: string;
  /** nested object inside a section - rendered as a labelled sub-block */
  subgroup?: { id: string; label: string; skill?: string };
  default: unknown;
  value: unknown;

  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** what unit a `duration` value is stored in - declared, never guessed */
  durationBase?: 'seconds' | 'minutes' | 'hours' | 'days';
  /** boolChoice: what the two sides are called */
  boolLabels?: { true?: string; false?: string };
  /**
   * A link to the setting that governs this one when it is switched off.
   *
   * `when` names the value it applies to, so "the global theme is over here"
   * only appears while this resource is actually following the global theme.
   */
  goTo?: {
    resource: string;
    /** a settings section to scroll to */
    group?: string;
    /** a whole page (Logs, Admins, Bridges) - takes precedence over `group` */
    page?: string;
    label?: string;
    when?: unknown;
  };
  options?: SettingOption[];
  /** `x-bandLabels` - what a slider calls its own steps, low to high. */
  bandLabels?: string[];
  /** How many numbers a `coords` setting holds: 2, 3 or 4. */
  vectorDims?: 2 | 3 | 4;
  /** Prop model the `prop` control places. From `x-propModel`. */
  propModel?: string;
  /** Boolean keys on a `camera` object, drawn as switches under the shot. */
  cameraFlags?: { key: string; label: string; help?: string }[];
  /** `x-bodyHeight`: captured positions are lifted to body height. See bodyHeight.ts. */
  bodyHeight?: boolean;
  /**
   * Props to stand inside a `box` while it is being marked out, so the size is
   * judged against what will really be there. From `x-boxSample`.
   *
   * Only the schema knows this particular field is a parcel pile — the tool is
   * told, exactly as the prop placer is told its model.
   */
  boxSample?: { models?: string[]; count?: number };
  /** pickList: the setting whose rows supply the options, e.g. 'fish' */
  optionsFrom?: { path: string; key: string };

  /** list-only: typed columns for each row, plus the template for a new row */
  columns?: SettingColumn[];
  rowTemplate?: Record<string, unknown>;
  /** which column titles the row in the summary list */
  rowLabelKey?: string;
  /** which column carries an inventory item name (drives the image slot) */
  rowItemKey?: string;
  /** the schema declared `x-rowOrder`, so nothing should re-sort the fields */
  rowOrdered?: boolean;
  /** which band of the Bridges page this setting belongs in - `x-bridgeGroup` */
  bridgeGroup?: 'interface' | 'bridge';
  /** which icon set an `icon` setting's value belongs to - `x-iconSet` */
  iconSet?: 'lucide' | 'fontawesome' | 'both';
  /**
   * A button beside this setting that DOES something - `x-action`.
   *
   * Distinct from `x-validateWith`, which asks passively whether a value looks
   * usable while you type. An action has an effect: "Test webhook" posts a real
   * message to Discord, and doing that on every debounced keystroke would spam
   * the channel. So it happens when asked, and only then.
   */
  action?: {
    label: string;
    /** server callback on the owning script, without its `<resource>:` prefix */
    callback: string;
    icon?: string;
    /** send the whole SECTION rather than just this field's value */
    sendSection?: boolean;
  };
  /** explicit modal tabs; falls back to General + one tab per nested field */
  rowTabs?: RowTab[];

  /** renders the RESTART REQUIRED chip — schema x-restartRequired */
  restartRequired?: boolean;
  /** never leaves the server; the panel gets it through the gated callback */
  serverOnly?: boolean;
};

export type SettingGroup = {
  /**
   * This section owns the pane rather than sitting in the scrolling stack.
   *
   * Inferred for a section that is mostly a map or a script's own control -
   * those need the room. Declared with `x-workspace` when a section simply
   * reads better as its own place: Bait Dig is a handful of numbers and two
   * lists, and behind tabs in its own pane it stops feeling like a dropdown
   * hanging off the section above it.
   */
  workspace?: boolean;
  id: string;
  label: string;
  icon: string;
  description?: string;
};

/**
 * A whole page a script supplies, rather than a control inside a section.
 *
 * Some of what a per-script panel did was never configuration. Fishing's
 * Players screen reads live server data, pages through it, and acts on it -
 * there is no setting behind it to hang an `x-component` off, and pretending
 * there is would put a fake entry in the config just to have somewhere to
 * mount a screen.
 *
 * So a schema can declare pages the same way it declares sections, and the
 * rail lists them under that script. dirk_lib supplies the frame, the theme
 * and the loader; what goes inside stays in the script that owns it.
 */
/**
 * One of a section's plain settings, handed to a control that took the window.
 *
 * The NODE is the panel's own row - same editor, same staging, same save bar -
 * so a control placing these is not reimplementing settings, only deciding
 * where they sit. `path` is there so it can pull one out and treat it
 * differently: a master switch belongs beside the thing it switches off, not
 * filed in with the rest.
 */
export type SlottedSetting = {
  path: string;
  label: string;
  node: React.ReactNode;
};

export type ScriptPage = {
  id: string;
  label: string;
  icon: string;
  /** path inside the owning resource, e.g. `web/build/studio/players.js` */
  component: string;
  description?: string;
  /**
   * The page wants the whole window - schema `x-pages[].full`.
   *
   * A settings pane is a column beside a rail; a canvas is not. A page that
   * declares this opens with the panel grown to the screen and the rail folded
   * away, and the page is handed an `onBack` to come out of it again. That is
   * how a design editor gets its width without being a second UI floating over
   * the panel it was opened from.
   */
  full?: boolean;
  /**
   * The schema path this page EDITS, when it edits one - `x-pages[].path`.
   *
   * Without it a page is a screen that fetches its own data, like fishing's
   * Players. With it the page is a list: dirk_lib hands the component the same
   * value, onChange and row editor a custom control gets, so a wall of cards
   * keeps the schema-built form, the staging and the save bar rather than
   * reimplementing all three to be a page.
   */
  path?: string;
  /**
   * Paths whose plain settings belong to this page - `x-pages[].settings`.
   *
   * A page is not a section, so its settings have no rail entry of their own.
   * They come with it instead, and the page decides where they go: behind a
   * gear, in a strip, not at all.
   */
  settings?: string[];
};

export type StudioScript = {
  resource: string;
  label: string;
  icon: string;
  version: string;
  /** dirk_lib's own shared layer — pinned to the bottom of the rail */
  shared?: boolean;
  /** whole pages this script supplies - schema `x-pages` */
  pages?: ScriptPage[];
  groups: SettingGroup[];
  entries: SettingEntry[];
  /**
   * The config exactly as the server holds it, nested.
   *
   * Kept alongside the flat `entries` because a save sends whole SECTIONS, and
   * rebuilding a section out of flat leaves would silently drop anything the
   * schema does not describe. Saving edits a copy of this instead.
   */
  serverValues?: Record<string, unknown>;
  /**
   * Config version this panel was opened against. Sent back on save so a stale
   * panel is rejected rather than quietly overwriting someone else's change.
   */
  clientVersion?: number;
};

/**
 * Does this setting belong in a section's tab strip?
 *
 * A section holding several LISTS shows one at a time behind tabs - fishing's
 * Equipment is seven of them. A script's own control standing in for one of
 * those lists is still one of those lists: it holds the same array and wants
 * the same tab. Without this, adding `x-component` to a tabbed list silently
 * dropped it out of the strip and stacked all seven down the page.
 */
export function tabsAsList(entry: SettingEntry): boolean {
  if (entry.type === 'list') return true;

  // A script's own control standing in for a LIST wants a page of its own; one
  // standing in for a SETTING belongs in the settings stack beside the others.
  // `componentFull` already means exactly that difference - "fills the whole
  // workspace" - so it is what decides, rather than the value being an array.
  // A category picker stores an array and is still just a setting.
  if (entry.type === 'custom') return !!entry.componentFull;

  // A list of references to other settings - fishing's Misc tab is exactly
  // that - is still one of the section's lists and still wants a tab.
  return entry.type === 'refs' && Array.isArray(entry.value);
}

/**
 * The id of a workspace section's own settings, as a rail child.
 *
 * A section with lists gets one child per list; the settings that are not in
 * any list need a name of their own to be selectable, and "Basic" is what they
 * are. Not a real path, so it can never collide with one.
 */
export const BASIC_CHILD = '__basic__';

/**
 * The id of a workspace's MAP, as a rail child.
 *
 * A workspace holding polygon layers AND settings of its own is two places: the
 * map, and the settings that govern it. Stacking them put a jobs dropdown under
 * a full-height map, where it reads as part of the map rather than as a
 * separate thing. Not a real path, so it can never collide with one.
 *
 * Every layer stays on ONE canvas under this child — the whole point of the map
 * section is that the polygons are drawn together.
 */
export const MAP_CHILD = '__map__';

/**
 * The child a workspace section's `x-skill` block occupies.
 *
 * A levelling curve is a page, not a paragraph: four or five settings and a
 * chart beside them. Left among the section's loose settings it sat under
 * "Basic" with everything else and the chart had a third of the width. Like
 * the map, it has one identity rather than one per setting — there is only
 * ever one curve in a section.
 */
export const SKILL_CHILD = '__skill__';
