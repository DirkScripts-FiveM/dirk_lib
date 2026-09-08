import { fetchNui, isEnvBrowser } from 'dirk-cfx-react';
import { create } from 'zustand';
import { MOCK_LOCALES } from './mockLocales';
import { MOCK_SCRIPTS } from './mockData';
import type { LocaleBundles } from './studioLocale';
import type { SettingEntry, StudioScript } from './types';
import { studioQueryClient } from './studioQuery';
import type { DispatchEntry } from './Dispatch';

// A staged edit. `reset` means "put this back to the shipped default on save",
// which is a delete server-side rather than a write - the same distinction the
// override-row storage makes.
export type DraftValue = { kind: 'set'; value: unknown } | { kind: 'reset' };

type StudioState = {
  open: boolean;
  canEdit: boolean;
  scripts: StudioScript[];
  activeResource: string;
  /** built-in pages that are not schema-driven: admins, logs, bridges */
  activePage: string | null;
  /** windowed; only the design studio needs edge-to-edge */
  fullScreen: boolean;
  /** resource -> language -> key -> text, supplied by each script */
  locales: LocaleBundles;
  /**
   * Search text, per surface (a page id, or `script:<resource>`).
   *
   * A single panel-wide box meant a search for "sanchez" in Vehicles was still
   * applied when you clicked Items, which just looks like an empty list. Each
   * surface keeps its own text and finds it again when you come back.
   */
  searches: Record<string, string>;
  /** resource -> path -> staged change */
  draft: Record<string, Record<string, DraftValue>>;
  /**
   * Undo/redo over the staged draft, per script — the same pair the old config
   * panel had. Snapshots of the WHOLE draft rather than a change log: a draft
   * is a small flat map, and storing states instead of inverse operations means
   * undo cannot drift out of step with what is on screen.
   */
  undoStack: Record<string, Record<string, DraftValue>[]>;
  redoStack: Record<string, Record<string, DraftValue>[]>;
  saving: boolean;
  /** why the last save was refused, or null */
  saveError: SaveError | null;
  /** path of the list currently opened in the drill-in pane */
  drillPath: string | null;
  /**
   * Which tabbed list the rail asked for, by path.
   *
   * A section holding several lists shows one at a time behind a tab strip.
   * The rail can now name one directly - Equipment > Hooks rather than
   * Equipment, then find the strip, then find the tab - so the request has to
   * reach the section body, which owns that selection.
   */
  activeList: string | null;
  /**
   * Which tabbed list the section body is CURRENTLY showing.
   *
   * `activeList` is a request and is cleared once taken; this is the answer,
   * and it is what lets the rail highlight the child you are actually looking
   * at rather than the last one you clicked.
   */
  shownList: string | null;
  /**
   * "Open row 27 of `fish`" - asked for from somewhere that is not the list.
   *
   * A validation problem names a row (`fish[27].waterTypes`), and the only
   * useful thing to do with that is put you in front of it. The list owns its
   * own row editor, so this is how anything else asks it to open one. Cleared
   * once taken.
   */
  openRowRequest: { path: string; index: number } | null;
  /**
   * "Take me to that setting, in that script."
   *
   * Raised from anywhere - a field that points at another script's setting -
   * and performed by the shell, which is the only thing that knows how to
   * change script, close a page and scroll a group into view. Search already
   * did exactly this; it just had the jump wired straight to it as a prop.
   */
  goToRequest: { resource: string; group?: string; page?: string } | null;
  /**
   * Announcements for the Overview page.
   *
   * Empty until dirk_lib fetches them, and the page falls back to its mock
   * spread so it can be designed against something. Already filtered when it
   * arrives: which script is running, who is behind a version, whether a promo
   * has started - all resolved server-side, so a client only ever holds the
   * entries it was meant to see.
   */
  dispatch: DispatchEntry[];
  /**
   * Resources with a CHANGELOG.md worth reading.
   *
   * Asked once, for every script at once, so the rail can offer the tab only
   * where there is something behind it rather than opening an empty page.
   */
  changelogs: string[];
  /** resources with a lib.test suite loaded, so the rail only offers the tab there */
  tests: string[];
  /**
   * Id of the design currently open in the editor, or null while browsing.
   *
   * Browsing designs is an ordinary page and keeps the rail. EDITING is a mode:
   * the canvas needs the width, and nobody browses settings mid-design, so the
   * rail drops and the breadcrumb becomes the way back.
   */
  editingDesign: string | null;
};

export const useStudio = create<StudioState>(() => ({
  open: false,
  canEdit: true,
  scripts: MOCK_SCRIPTS,
  activeResource: MOCK_SCRIPTS[0]?.resource ?? '',
  activePage: null,
  fullScreen: false,
  // Empty in game, mock in a browser. Seeding the mock unconditionally meant
  // `loadLocales` saw English already present for every script and skipped the
  // fetch entirely - so the real bundles never arrived and the panel stayed in
  // English whatever the language setting said.
  locales: isEnvBrowser() ? MOCK_LOCALES : {},
  searches: {},
  draft: {},
  undoStack: {},
  redoStack: {},
  saving: false,
  saveError: null,
  drillPath: null,
  activeList: null,
  shownList: null,
  openRowRequest: null,
  goToRequest: null,
  dispatch: [],
  changelogs: [],
  tests: [],
  editingDesign: null,
}));

/** Stable stringify so array/object comparisons don't depend on key order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  // Fast paths first. A full stableStringify of fishing's values is ~82KB per
  // pass and this runs for every entry on every script switch and every
  // keystroke, so the cheap checks matter more than the thorough one.
  if (a === b) return true;                       // same reference, or equal primitives
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  const aArray = Array.isArray(a);
  if (aArray !== Array.isArray(b)) return false;
  if (aArray && (a as unknown[]).length !== (b as unknown[]).length) return false;
  if (!aArray) {
    const aKeys = Object.keys(a as object);
    if (aKeys.length !== Object.keys(b as object).length) return false;
  }

  return stableStringify(a) === stableStringify(b);
}

/** What the field should render right now: staged edit if there is one, else stored. */
export function effectiveValue(resource: string, entry: SettingEntry): unknown {
  const staged = useStudio.getState().draft[resource]?.[entry.path];
  if (!staged) return entry.value;
  return staged.kind === 'reset' ? entry.default : staged.value;
}

/**
 * Every setting in the same top-level section, with staged edits applied.
 *
 * For an action that needs its neighbours. Testing a webhook posts a preview
 * of the events that are switched ON, so the URL alone does not say what to
 * send - and it has to be the value in the box, not the one saved an hour ago,
 * or pressing Test would check something other than what you just typed.
 */
export function sectionValues(resource: string, path: string): Record<string, unknown> {
  const section = path.split('.')[0];
  if (!section) return {};

  const entries = useStudio.getState().scripts
    .find((script) => script.resource === resource)?.entries ?? [];

  const out: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.path !== section && !entry.path.startsWith(`${section}.`)) continue;
    // Keyed by the name the SCRIPT knows it as - `logging.webhookUrl` reaches
    // the script as `webhookUrl`, which is what its own callback reads.
    const key = entry.path === section ? section : entry.path.slice(section.length + 1);
    out[key] = effectiveValue(resource, entry);
  }
  return out;
}

/** Differs from the shipped default - drives the MODIFIED chip. */
/**
 * Is this setting live right now, given whatever its master switch says?
 *
 * Reads the CONTROLLING setting's effective value, so a switch flipped but not
 * yet saved greys its dependants immediately - waiting for a save would mean
 * editing fields that the panel already knows will do nothing.
 */
export function isEnabled(resource: string, entry: SettingEntry): boolean {
  const rule = entry.enabledWhen;
  if (!rule) return true;
  const controller = useStudio.getState().scripts
    .find((script) => script.resource === resource)?.entries
    .find((other) => other.path === rule.path);
  if (!controller) return true;
  return valuesEqual(effectiveValue(resource, controller), rule.equals);
}

export function isModified(resource: string, entry: SettingEntry): boolean {
  return !valuesEqual(effectiveValue(resource, entry), entry.default);
}

/** Has an unsaved edit in this session - drives the staged dot. */
export function isStaged(resource: string, path: string): boolean {
  return useStudio.getState().draft[resource]?.[path] !== undefined;
}

/** How many steps back you can go. Deep enough to undo a bad afternoon. */
const UNDO_LIMIT = 100;

/**
 * Apply a change to the draft and record the state it replaced.
 *
 * Every staging path goes through here so nothing can quietly change the draft
 * without becoming undoable - that is exactly how an undo stack ends up one
 * step out of sync with the screen.
 */
function stage(resource: string, mutate: (draft: Record<string, DraftValue>) => void) {
  useStudio.setState((state) => {
    const before = state.draft[resource] ?? {};
    const after = { ...before };
    mutate(after);

    // A no-op edit (typing a value back to what it already was) should not eat
    // an undo step.
    if (stableStringify(before) === stableStringify(after)) return {};

    const past = [...(state.undoStack[resource] ?? []), before].slice(-UNDO_LIMIT);
    return {
      draft: { ...state.draft, [resource]: after },
      undoStack: { ...state.undoStack, [resource]: past },
      // a fresh edit is a new branch; anything redone from here is unreachable
      redoStack: { ...state.redoStack, [resource]: [] },
    };
  });
}

export function setValue(resource: string, entry: SettingEntry, value: unknown) {
  stage(resource, (draft) => {
    // Typing a value back to what the server already holds un-stages it, so the
    // dirty count only ever reflects real pending change.
    if (valuesEqual(value, entry.value)) delete draft[entry.path];
    else draft[entry.path] = { kind: 'set', value };
  });
}

export function revertToDefault(resource: string, entry: SettingEntry) {
  stage(resource, (draft) => {
    if (valuesEqual(entry.default, entry.value)) delete draft[entry.path];
    else draft[entry.path] = { kind: 'reset' };
  });
}

export function discardDraft(resource: string) {
  // Undoable too: discarding a long session of edits by accident is the worst
  // thing this panel could do to someone.
  stage(resource, (draft) => {
    for (const path of Object.keys(draft)) delete draft[path];
  });
}

export function undo(resource: string) {
  useStudio.setState((state) => {
    const past = state.undoStack[resource] ?? [];
    if (past.length === 0) return {};
    const previous = past[past.length - 1]!;
    return {
      draft: { ...state.draft, [resource]: previous },
      undoStack: { ...state.undoStack, [resource]: past.slice(0, -1) },
      redoStack: { ...state.redoStack, [resource]: [...(state.redoStack[resource] ?? []), state.draft[resource] ?? {}] },
    };
  });
}

export function redo(resource: string) {
  useStudio.setState((state) => {
    const future = state.redoStack[resource] ?? [];
    if (future.length === 0) return {};
    const next = future[future.length - 1]!;
    return {
      draft: { ...state.draft, [resource]: next },
      redoStack: { ...state.redoStack, [resource]: future.slice(0, -1) },
      undoStack: { ...state.undoStack, [resource]: [...(state.undoStack[resource] ?? []), state.draft[resource] ?? {}] },
    };
  });
}

export function dirtyCount(resource: string): number {
  return Object.keys(useStudio.getState().draft[resource] ?? {}).length;
}

/**
 * Writes a value into a nested object at a dot-path, creating what it needs.
 * `null` for the value deletes the key, which is how "back to default" reaches
 * the server: an absent key means "no override", not "override with nothing".
 */
function writePath(root: Record<string, unknown>, path: string, value: unknown, remove: boolean) {
  const parts = path.split('.');
  let node = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const next = node[key];
    // A leaf where a branch should be (or nothing at all) gets replaced, not
    // merged into - the schema says this path has children.
    node[key] = (next && typeof next === 'object' && !Array.isArray(next))
      ? { ...(next as Record<string, unknown>) }
      : {};
    node = node[key] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (remove) delete node[last];
  else node[last] = value;
}

/** Deep copy that is enough for config data (plain objects, arrays, scalars). */
function clone<T>(value: T): T {
  return (value === undefined ? value : JSON.parse(JSON.stringify(value))) as T;
}

/**
 * Everything this save has to send: the top-level sections the admin touched,
 * each as its COMPLETE current value.
 *
 * A section delta rather than the whole config, so one changed toggle does not
 * rewrite every setting the script has - and complete sections rather than
 * changed leaves, because the server replaces a supplied section wholesale and
 * that is what makes a deletion inside one actually propagate.
 */
function buildSavePayload(script: StudioScript, staged: Record<string, DraftValue>) {
  const sections = new Set(Object.keys(staged).map((path) => path.split('.')[0]));
  const payload: Record<string, unknown> = {};

  for (const section of sections) {
    // Start from what the server already holds so anything the schema does not
    // describe survives the round trip.
    payload[section] = clone(
      (script.serverValues?.[section] as Record<string, unknown> | undefined) ?? {},
    );
  }

  for (const [path, change] of Object.entries(staged)) {
    const section = path.split('.')[0];
    const root = payload as Record<string, unknown>;
    if (change.kind === 'reset') {
      // Dropping the key returns the path to the shipped default - which is
      // also what stops a default being written as an override row.
      writePath(root, path, undefined, true);
    } else {
      writePath(root, path, change.value, false);
    }
  }

  return payload;
}

/**
 * Applies the draft to the local model. Used after a successful save, and on
 * its own in the browser where there is no server to save to.
 */
function applyStagedLocally(resource: string) {
  useStudio.setState((state) => {
    const staged = state.draft[resource] ?? {};
    const scripts = state.scripts.map((script) => {
      if (script.resource !== resource) return script;
      const serverValues = clone(script.serverValues ?? {});
      for (const [path, change] of Object.entries(staged)) {
        writePath(serverValues, path, change.kind === 'reset' ? undefined : change.value, change.kind === 'reset');
      }
      return {
        ...script,
        serverValues,
        entries: script.entries.map((entry) => {
          const change = staged[entry.path];
          if (!change) return entry;
          return { ...entry, value: change.kind === 'reset' ? entry.default : change.value };
        }),
      };
    });
    return { scripts, draft: { ...state.draft, [resource]: {} }, saving: false };
  });
}

/** What went wrong, in words, when a save is refused. */
const SAVE_FAILURES: Record<string, string> = {
  NoPermission: 'You do not have permission to save this script',
  VersionConflict: 'Someone else changed this script - reopen the panel to see it',
  NotReady: 'That script is still starting up',
  InvalidPayload: 'The server rejected the payload',
  NoResource: 'The server did not recognise that script',
  CallbackFailed: 'No response from that script',
};

/** Set when a save fails, cleared when the next one starts. */
export type SaveError = { resource: string; message: string };

/**
 * Saves the staged draft for one script.
 *
 * In a browser there is no server, so the draft is applied locally and the
 * panel behaves the same - which is what keeps design work possible without a
 * running server.
 */
export async function commitDraft(resource: string): Promise<boolean> {
  const state = useStudio.getState();
  const script = state.scripts.find((s) => s.resource === resource);
  const staged = state.draft[resource] ?? {};
  if (!script || Object.keys(staged).length === 0) return true;

  useStudio.setState({ saving: true, saveError: null });
  // Once written, the pre-save drafts describe a server state that is gone.
  useStudio.setState((s) => ({
    undoStack: { ...s.undoStack, [resource]: [] },
    redoStack: { ...s.redoStack, [resource]: [] },
  }));

  if (isEnvBrowser()) {
    await new Promise((r) => setTimeout(r, 450));
    applyStagedLocally(resource);
    return true;
  }

  type SaveReply = { success?: boolean; _error?: string; meta?: { client_version?: number } };
  const failed: SaveReply = { success: false, _error: 'CallbackFailed' };
  const reply = await fetchNui<SaveReply>(
    'SAVE_SCRIPT_STUDIO',
    {
      resource,
      data: buildSavePayload(script, staged),
      expectedVersion: script.clientVersion,
    },
    failed,
  ).catch(() => failed);

  if (!reply?.success) {
    const code = reply?._error ?? 'CallbackFailed';
    useStudio.setState({
      saving: false,
      saveError: { resource, message: SAVE_FAILURES[code] ?? `Save failed (${code})` },
    });
    return false;
  }

  applyStagedLocally(resource);

  // A save is exactly the thing that adds a change-log entry, so the cached
  // history for this script is now wrong. Nothing dropped it, and history is
  // cached for a minute on the grounds that a written log line never changes -
  // true of each line, false of the list. So saving looked like it had not
  // been recorded at all: the entry was in the database and the panel was
  // still showing the page it fetched before the save.
  studioQueryClient.invalidateQueries({ queryKey: ['scriptConfigHistory', resource] });

  // The version moves on with every write; keeping the old one would make the
  // NEXT save look stale.
  const nextVersion = reply.meta?.client_version;
  if (nextVersion !== undefined) {
    useStudio.setState((s) => ({
      scripts: s.scripts.map((entry) => (entry.resource === resource
        ? { ...entry, clientVersion: nextVersion }
        : entry)),
    }));
  }
  return true;
}

/** Factory reset - every path in the script back to shipped defaults. */
export function factoryReset(resource: string) {
  useStudio.setState((state) => {
    const script = state.scripts.find((s) => s.resource === resource);
    if (!script) return {};
    const forResource: Record<string, DraftValue> = {};
    for (const entry of script.entries) {
      if (!valuesEqual(entry.default, entry.value)) forResource[entry.path] = { kind: 'reset' };
    }
    return { draft: { ...state.draft, [resource]: forResource } };
  });
}

/** Matches his search surface: label, path, help, group name and enum options. */
export function matchesSearch(entry: SettingEntry, groupLabel: string, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  const hay = [entry.label, entry.path, entry.help ?? '', groupLabel];
  for (const option of entry.options ?? []) hay.push(option.label, option.value);
  for (const column of entry.columns ?? []) hay.push(column.label);
  if (hay.some((h) => h.toLowerCase().includes(needle))) return true;

  // The CONTENTS, not just the shape.
  //
  // This matched the name of a setting and never what was stored in it, so a
  // scrapyard called "Cypress Flats", a store, a fish - the things an admin
  // actually goes looking for - could not be found by their own names. You had
  // to already know which section held them, which is the one thing search
  // exists to answer.
  return rowMatches(entry, query).length > 0;
}

/** What a row is CALLED, for a result you can recognise. */
export function rowTitle(entry: SettingEntry, row: Record<string, unknown>, index: number): string {
  // A HUMAN name first. `rowLabelKey` is often the array key — `id` — so
  // asking it first titled a result "palaminoBay" when the row says
  // "Palamino Bay" two fields along, and you cannot search for what you were
  // shown.
  for (const candidate of ['label', 'name', 'title']) {
    const value = row[candidate];
    if (typeof value === 'string' && value.trim()) return value;
  }

  const key = entry.rowLabelKey ?? entry.rowItemKey;
  const named = key ? row[key] : undefined;
  if (typeof named === 'string' && named.trim()) return named;

  for (const candidate of ['id']) {
    const value = row[candidate];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return `${entry.label} ${index + 1}`;
}

/**
 * Which ROWS of a list match, and where they live.
 *
 * Nested tables are searched too — a store's stock, a fish's rewards — but the
 * result is always attributed to the row you can actually OPEN. "Somewhere
 * inside this" is not a destination, so a hit on a stock line reports the
 * store, on the tab that holds the stock, with the thing that matched named
 * beside it. You land somewhere real and the last step is in front of you.
 *
 * One level of nesting, deliberately. Deeper than that and the trail back to
 * something clickable is longer than the search saved.
 */
export function rowMatches(
  entry: SettingEntry,
  query: string,
): { index: number; title: string; tab?: string; within?: string }[] {
  const needle = query.trim().toLowerCase();
  if (!needle || !Array.isArray(entry.value)) return [];

  const hits = (row: Record<string, unknown>): string | undefined => {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      if (String(value).toLowerCase().includes(needle)) return key;
    }
    return undefined;
  };

  const out: { index: number; title: string; tab?: string; within?: string }[] = [];

  (entry.value as Record<string, unknown>[]).forEach((row, index) => {
    if (!row || typeof row !== 'object') return;

    // Which TAB of the row editor holds the cell that matched, so a result
    // opens on it rather than on whichever tab happens to be first.
    const tabFor = (key: string) => entry.rowTabs?.find((t) => t.keys.includes(key))?.label;

    const direct = hits(row);
    if (direct) {
      out.push({ index, title: rowTitle(entry, row, index), tab: tabFor(direct) });
      return;
    }

    // Nothing on the row itself — look one level in.
    for (const [key, value] of Object.entries(row)) {
      if (!Array.isArray(value)) continue;

      const child = entry.columns?.find((c) => c.key === key);
      for (const nested of value) {
        if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
        const inner = hits(nested as Record<string, unknown>);
        if (!inner) continue;

        out.push({
          index,
          title: rowTitle(entry, row, index),
          tab: tabFor(key),
          // What was actually found in there, so the card is not just the
          // parent's name with no clue why it is a result.
          within: `${child?.label ?? key}: ${rowTitle(
            { ...entry, rowLabelKey: undefined, rowItemKey: undefined } as SettingEntry,
            nested as Record<string, unknown>,
            0,
          )}`,
        });
        return;
      }
    }
  });

  return out;
}

// Dev-only handle so the converted schema can be inspected from the console (or
// a browser probe) without digging through React internals. Stripped from the
// production bundle by the `import.meta.env.DEV` guard.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__studio = useStudio;
}
