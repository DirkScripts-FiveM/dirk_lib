import { fetchNui, isEnvBrowser } from 'dirk-cfx-react';
import { schemaToStudio } from './schemaToStudio';
import { MOCK_SCRIPTS } from './mockData';
import { useStudio } from './store';
import { notify } from './Toasts';
import type { DraftValue } from './store';
import type { StudioScript } from './types';
import { forgetComponents } from './CustomControl';
import { forgetLocales } from './studioLocale';

/**
 * One script as the server hands it over: its schema read from disk by
 * dirk_lib, and its values pulled from that resource's own permission-gated
 * `getFullScriptConfig`.
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
  applyLivePayload(payload, focus);
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

export function applyLivePayload(payload: LivePayload[], focus?: string) {
  if (!Array.isArray(payload) || payload.length === 0) return;
  noticeRestarts(payload);

  const scripts = toStudioScripts(payload);
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

  const state = useStudio.getState();
  const scripts = toStudioScripts(payload);
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
