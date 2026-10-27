import { fetchNui, isEnvBrowser } from 'dirk-cfx-react';
import { schemaToStudio } from './schemaToStudio';
import { MOCK_SCRIPTS } from './mockData';
import { markFresh, markStale, useStudio } from './store';
import { notify } from './Toasts';
import type { DraftValue } from './store';
import type { StudioScript } from './types';
import { forgetComponents } from './CustomControl';
import { forgetLocales } from './studioLocale';

/**
 * One script as the server hands it over: its schema read from disk by
 * dirk_lib, and its values from that resource's own client VM plus the
 * server-only sliver its own permission check let through.
 */
export type LivePayload = {
  resource: string;
  /** When dirk_lib last saw this resource start on this client - changes on every restart. */
  startedAt?: number;
  label: string;
  icon: string;
  version: string;
  shared?: boolean;
  /**
   * The schema as TEXT, straight off disk.
   *
   * Lua tables have no key order, so a schema decoded server-side and
   * re-encoded for the NUI came back with its sections and settings in
   * whatever order `pairs` produced — different on every restart. Parsing the
   * original text here keeps the order the schema was written in.
   */
  schemaJson?: string;
  /**
   * Content hash of the schema. When the panel already holds the text for
   * this hash, Lua leaves `schemaJson` out and it is filled from SCHEMAS.
   */
  hash?: number | string;
  /** `x-autoDefault` values the server resolved from its convars, by path. */
  autoDefaults?: Record<string, unknown>;
  /** Pre-1.2.81 servers, and the browser mock, still send a decoded object. */
  schema?: Record<string, unknown>;
  values?: Record<string, unknown>;
  clientVersion?: number;
};

/**
 * Turn the server's payload into what the panel renders.
 *
 * Layout, controls and validation all come out of the schema itself
 * (`x-sections`, `x-rowTabs`, `x-validate`...), so there is nothing per-script
 * to look up here - which is the whole reason a new resource needs no changes
 * in dirk_lib.
 */
export function toStudioScripts(payload: LivePayload[]): StudioScript[] {
  return payload.map((entry) => ({
    ...schemaToStudio(readSchema(entry), {
      resource: entry.resource,
      label: entry.label,
      icon: entry.icon,
      version: entry.version,
      shared: entry.shared,
      // The server's stored values ARE the overrides — everything else is the
      // schema's default, which the walk fills in.
      overrides: flatten(entry.values ?? {}),
    }),
    // Kept nested and untouched, because a save edits a copy of this rather
    // than rebuilding a section from flattened leaves.
    serverValues: entry.values ?? {},
    clientVersion: entry.clientVersion,
  }));
}

/**
 * The schema to render: the raw text where the server sent it, the decoded
 * object otherwise.
 *
 * Detected defaults arrive separately (a path -> value map) because they are
 * resolved from convars server-side and cannot be in the file. They are
 * written onto the parsed schema here so the rest of the panel sees one thing:
 * a schema whose defaults are the defaults actually in force.
 */
function readSchema(entry: LivePayload): Record<string, unknown> {
  let schema: Record<string, unknown>;
  if (entry.schemaJson) {
    try {
      schema = JSON.parse(entry.schemaJson) as Record<string, unknown>;
    } catch {
      schema = entry.schema ?? {};
    }
  } else {
    schema = entry.schema ?? {};
  }

  for (const [path, value] of Object.entries(entry.autoDefaults ?? {})) {
    const parts = path.split('.');
    let node: Record<string, unknown> | undefined = schema;
    for (const part of parts) {
      const properties = node?.properties as Record<string, unknown> | undefined;
      node = properties?.[part] as Record<string, unknown> | undefined;
      if (!node) break;
    }
    if (node) node.default = value;
  }

  return schema;
}

/** `{a:{b:1}}` -> `{'a.b': 1}`, the shape the converter's overrides expect. */
function flatten(value: Record<string, unknown>, prefix = '', out: Record<string, unknown> = {}) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    // Arrays and leaves are stored whole; only plain objects are walked, or a
    // list of rows would explode into one entry per field.
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child as Record<string, unknown>, path, out);
    } else {
      out[path] = child;
    }
  }
  return out;
}

/**
 * Schema text the panel holds, by resource.
 *
 * Every open used to carry every schema across from Lua again - fishing's alone
 * is a quarter of a megabyte - to describe what was already on screen. The
 * panel keeps them here instead and tells Lua which hashes it has
 * (SCRIPT_STUDIO_HELD), so a payload carries a script's schema only when it is
 * new or has changed.
 */
const SCHEMAS = new Map<string, { hash: number | string; text: string }>();

/**
 * Put the held text back into entries Lua sent without it. Returns the
 * resources it could not fill: a hash Lua believes is held but this page does
 * not have, which only happens if the page was reloaded under a running client.
 */
function fillSchemas(payload: LivePayload[]): string[] {
  const missing: string[] = [];
  for (const entry of payload) {
    if (entry.schemaJson) {
      if (entry.hash !== undefined) SCHEMAS.set(entry.resource, { hash: entry.hash, text: entry.schemaJson });
      continue;
    }
    if (entry.schema || entry.hash === undefined) continue;
    const held = SCHEMAS.get(entry.resource);
    if (held && held.hash === entry.hash) entry.schemaJson = held.text;
    else missing.push(entry.resource);
  }
  return missing;
}

/** Tell Lua which schemas it can leave out of the next payload. */
function reportHeld() {
  const schemas: Record<string, number | string> = {};
  for (const [resource, held] of SCHEMAS) schemas[resource] = held.hash;
  fetchNui('SCRIPT_STUDIO_HELD', { schemas }).catch(() => { /* the next payload just carries the text */ });
}

/**
 * Fill in held schemas; if any cannot be, ask once for every schema in full,
 * rather than render a script with no schema.
 */
async function settle(payload: LivePayload[]): Promise<LivePayload[]> {
  if (fillSchemas(payload).length === 0) return payload;
  const full = await fetchNui<LivePayload[]>('GET_SCRIPT_STUDIO', { full: true }, [])
    .catch(() => [] as LivePayload[]);
  if (Array.isArray(full) && full.length > 0) {
    fillSchemas(full);
    return full;
  }
  return payload;
}

/**
 * What each script looked like when it was last built, so a payload that says
 * nothing new rebuilds nothing.
 *
 * Re-running the schema walk for every script on every open re-rendered the
 * whole panel to show the same thing. The signature is everything the build
 * reads; a script whose signature matches keeps its existing object, and when
 * every script does, the store is not touched at all.
 *
 * Reused only while the store still holds the very object that was built. A
 * save replaces it (applyStagedLocally), so a script saved since its last
 * build is always rebuilt from what the server says now.
 */
const BUILT = new Map<string, { signature: string; script: StudioScript }>();

function signatureOf(entry: LivePayload): string {
  return JSON.stringify([
    entry.hash ?? null, entry.clientVersion ?? null, entry.startedAt ?? null,
    entry.label, entry.icon, entry.version, entry.shared ?? false,
    entry.autoDefaults ?? null, entry.values ?? null,
  ]);
}

/** Build only what changed, reusing the rest. `changed` is false when nothing did. */
function rebuild(payload: LivePayload[], previous: StudioScript[]) {
  const byResource = new Map(previous.map((script) => [script.resource, script]));
  let changed = payload.length !== previous.length;

  const scripts = payload.map((entry, index) => {
    const signature = signatureOf(entry);
    const before = byResource.get(entry.resource);
    const built = BUILT.get(entry.resource);
    if (before && built && built.script === before && built.signature === signature) {
      if (previous[index] !== before) changed = true;   // same script, new position
      return before;
    }
    changed = true;
    const script = toStudioScripts([entry])[0]!;
    BUILT.set(entry.resource, { signature, script });
    return script;
  });

  return { scripts, changed };
}

/**
 * Ask the game for the real config.
 *
 * In a browser there is no game to ask, so the mock stands in - which is what
 * keeps the dev server usable for design work without a running server.
 */
export async function loadLiveScripts(focus?: string) {
  if (isEnvBrowser()) {
    useStudio.setState({ scripts: MOCK_SCRIPTS, activeResource: focus ?? MOCK_SCRIPTS[0]?.resource ?? '' });
    return;
  }

  const payload = await fetchNui<LivePayload[]>('GET_SCRIPT_STUDIO', undefined, []);
  if (!Array.isArray(payload) || payload.length === 0) return;
  applyLivePayload(await settle(payload), focus);
}

/**
 * When each script last started, as of the last payload.
 *
 * A restart under an OPEN panel is announced (SCRIPT_STUDIO_RESOURCES_CHANGED)
 * and drops that script's pages and locales there and then. A restart while the
 * panel was SHUT was not: the next open rendered the page imported before it,
 * until a rejoin. Every payload says when each script started, so a changed
 * stamp is the restart, however long ago it happened.
 */
const STARTED = new Map<string, number>();

function noticeRestarts(payload: LivePayload[]) {
  for (const entry of payload) {
    if (typeof entry.startedAt !== 'number') continue;
    const seen = STARTED.get(entry.resource);
    if (seen !== undefined && seen !== entry.startedAt) {
      forgetComponents(entry.resource);
      forgetLocales(entry.resource);
    }
    STARTED.set(entry.resource, entry.startedAt);
  }
}

/** Real data from the game has been applied since this page loaded. */
let hydrated = false;

/**
 * Replace everything with this payload - the first one, when there is nothing
 * on screen worth keeping. Every later payload MERGES (mergeLivePayload).
 */
export function applyLivePayload(payload: LivePayload[], focus?: string) {
  if (!Array.isArray(payload) || payload.length === 0) return;
  fillSchemas(payload);
  noticeRestarts(payload);

  const scripts = toStudioScripts(payload);
  payload.forEach((entry, index) => {
    BUILT.set(entry.resource, { signature: signatureOf(entry), script: scripts[index]! });
  });
  const wanted = focus && scripts.some((s) => s.resource === focus) ? focus : null;

  useStudio.setState({
    scripts,
    // `/dirk_fishing` names a script, so open it. `/dirk_config` names none, so
    // open NOTHING - landing in whichever script sorted first made the panel
    // look like it was about that script.
    activeResource: wanted ?? scripts[0]?.resource ?? '',
    activePage: wanted ? null : 'home',
    draft: {},
    undoStack: {},
    redoStack: {},
  });
  hydrated = true;
  afterPayload(payload);
}

/**
 * What survives a re-read, of what was staged but not saved.
 *
 * A rebuild is not a reset, so staged edits are kept - but only the ones the
 * rebuilt schema still describes. The rebuild fires when a script RESTARTS,
 * which during development is usually a restart because the schema itself just
 * changed: a setting renamed, moved into a different section, or turned from a
 * number into a list. A staged edit against the old shape would then be
 * carried forward onto a setting that no longer exists, and the panel would
 * hold a pending change nothing on screen accounts for - or worse, save it.
 *
 * So a path is kept only if it is still there AND is still the same kind of
 * control. Everything else is dropped, and the admin is told rather than left
 * to notice the change count went down on its own.
 *
 * The undo stack goes with it: its snapshots are whole drafts, so replaying
 * one would put the pruned paths straight back.
 */
function pruneDrafts(scripts: StudioScript[]) {
  const state = useStudio.getState();
  const draft = { ...state.draft };
  const undoStack = { ...state.undoStack };
  const redoStack = { ...state.redoStack };
  let dropped = 0;

  for (const [resource, staged] of Object.entries(state.draft)) {
    const paths = Object.keys(staged ?? {});
    if (paths.length === 0) continue;

    const rebuilt = scripts.find((s) => s.resource === resource);
    // The script is gone outright - stopped, or no longer one this admin may
    // see. There is nothing left to stage against.
    if (!rebuilt) {
      dropped += paths.length;
      delete draft[resource];
      delete undoStack[resource];
      delete redoStack[resource];
      continue;
    }

    const now = new Map(rebuilt.entries.map((entry) => [entry.path, entry.type]));
    const before = new Map(
      (state.scripts.find((s) => s.resource === resource)?.entries ?? [])
        .map((entry) => [entry.path, entry.type]),
    );

    const kept: Record<string, DraftValue> = {};
    for (const path of paths) {
      const type = now.get(path);
      const was = before.get(path);
      if (type !== undefined && (was === undefined || was === type)) {
        kept[path] = staged[path]!;
      } else {
        dropped += 1;
      }
    }

    draft[resource] = kept;
    if (Object.keys(kept).length !== paths.length) {
      undoStack[resource] = [];
      redoStack[resource] = [];
    }
  }

  return { draft, undoStack, redoStack, dropped };
}

/**
 * Merge fresh values in behind what is on screen, keeping what is still valid.
 *
 * Staged edits survive (pruned to what the schema still describes) and so does
 * wherever you were - which is what lets an open show the panel's memory at
 * once and correct it a moment later, with nothing moving but the values that
 * actually changed.
 */
export function mergeLivePayload(payload: LivePayload[]) {
  if (!Array.isArray(payload) || payload.length === 0) return;
  fillSchemas(payload);
  noticeRestarts(payload);

  const state = useStudio.getState();
  const { scripts, changed } = rebuild(payload, state.scripts);

  if (changed) {
    const { draft, undoStack, redoStack, dropped } = pruneDrafts(scripts);
    useStudio.setState({
      scripts,
      draft,
      undoStack,
      redoStack,
      // Whatever you were looking at survives, unless that script is no longer
      // one of the ones on offer.
      activeResource: scripts.some((s) => s.resource === state.activeResource)
        ? state.activeResource
        : scripts[0]?.resource ?? '',
      saveError: null,
    });

    if (dropped > 0) {
      notify('info', dropped === 1
        ? '1 unsaved change was dropped - that setting has changed'
        : `${dropped} unsaved changes were dropped - those settings have changed`);
    }
  }

  hydrated = true;
  afterPayload(payload);
}

/**
 * Re-read every script from the server, keeping what is still valid.
 *
 * Two things call this: the Refresh button, and a script restarting underneath
 * an open panel. Refresh matters when someone else has saved while this panel
 * was open - the values on screen are then a snapshot of a config that has
 * moved on, and the stored version would reject the next save as a conflict.
 */
export async function reloadFromServer() {
  if (isEnvBrowser()) return;
  const payload = await fetchNui<LivePayload[]>('GET_SCRIPT_STUDIO', undefined, []);
  if (!Array.isArray(payload) || payload.length === 0) return;
  mergeLivePayload(await settle(payload));
}

/**
 * The rail's changelog and test tabs: which scripts have one.
 *
 * Asked once per SET of scripts, not once per open. Neither answer can change
 * without a script starting or stopping, and every payload carries when each
 * script last started - so the key below changes exactly when an answer might,
 * and every other open skips both round trips (the changelog one used to read
 * every CHANGELOG.md on the server to say yes or no).
 */
let indexKey = '';

function refreshIndexes(payload: LivePayload[]) {
  const resources = payload
    .map((entry) => entry.resource)
    .filter((name): name is string => typeof name === 'string');
  if (resources.length === 0) return;

  const key = payload
    .map((entry) => `${entry.resource}@${entry.startedAt ?? ''}`)
    .sort()
    .join(',');
  if (key === indexKey) return;
  indexKey = key;

  // Which scripts ship a changelog - one question covering all of them,
  // rather than a call per script or a tab that opens onto nothing. A failed
  // ask clears the key, so the next payload asks again rather than the panel
  // remembering "no tabs" for the rest of the session.
  fetchNui<{ resources?: string[] }>('GET_CHANGELOG_INDEX', { resources }, { resources })
    .then((reply) => useStudio.setState({ changelogs: reply?.resources ?? [] }))
    .catch(() => { indexKey = ''; });

  fetchNui<{ resources?: string[] }>('GET_TEST_INDEX', { resources }, { resources })
    .then((reply) => useStudio.setState({ tests: reply?.resources ?? [] }))
    .catch(() => { indexKey = ''; });
}

/** Everything a payload sets off once it is in the store. */
function afterPayload(payload: LivePayload[]) {
  reportHeld();
  refreshIndexes(payload);
}

export type StudioDataMessage = { scripts?: LivePayload[]; focus?: string; reason?: 'open' | 'prewarm' };
export type StudioOpenMessage = { focus?: string; askLanguage?: boolean; canEdit?: boolean; stale?: boolean };

/**
 * A gather from Lua: the warm-up after joining, or the fresh values for an
 * open. Shut or open, it lands in memory - which is what the next open shows.
 */
export async function onStudioData(data: StudioDataMessage | undefined) {
  const payload = data?.scripts;
  if (!Array.isArray(payload) || payload.length === 0) {
    // Nothing for us (Lua closes the panel itself); just stop holding saves.
    markFresh();
    return;
  }

  const settled = await settle(payload);
  if (hydrated) mergeLivePayload(settled);
  else applyLivePayload(settled, data?.focus);
  if (data?.reason === 'open') markFresh();
}

/**
 * The panel is opening.
 *
 * `stale` means it is opening from MEMORY: what it held last time is shown at
 * once, and the fresh gather follows as SCRIPT_STUDIO_DATA - saves wait for
 * it. A named script (`/dirk_fishing`) is jumped to now rather than when the
 * values land; with none named you are put back where you were, staged edits
 * and all.
 */
export function onStudioOpen(data: StudioOpenMessage | undefined) {
  if (data?.stale) markStale();

  const state = useStudio.getState();
  const focus = data?.focus;
  const jump = focus && state.scripts.some((s) => s.resource === focus) ? focus : null;

  useStudio.setState({
    open: true,
    canEdit: data?.canEdit !== false,
    askLanguage: data?.askLanguage === true,
    ...(jump ? { activeResource: jump, activePage: null } : {}),
  });
}

/**
 * Listened for at module level, not in a component.
 *
 * The warm-up arrives while the panel is SHUT, and whether the panel's
 * component is mounted then is the panel's business, not this file's. A
 * listener here hears it either way. Guarded so a hot reload in dev does not
 * stack a second one.
 */
if (typeof window !== 'undefined' && !isEnvBrowser()) {
  const flag = window as unknown as { __studioLiveListener?: boolean };
  if (!flag.__studioLiveListener) {
    flag.__studioLiveListener = true;
    window.addEventListener('message', (event: MessageEvent) => {
      const message = event.data as { action?: string; data?: unknown } | undefined;
      if (message?.action === 'SCRIPT_STUDIO_DATA') {
        void onStudioData(message.data as StudioDataMessage);
      } else if (message?.action === 'OPEN_SCRIPT_STUDIO') {
        onStudioOpen(message.data as StudioOpenMessage);
      }
    });
  }
}
