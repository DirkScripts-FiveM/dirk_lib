import { singular } from './ui';
import * as mantine from '@mantine/core';
import { alpha, Flex, Text, useMantineTheme } from '@mantine/core';
import * as cfxReact from 'dirk-cfx-react';
import { PANE_HEIGHT, PANE_MIN_HEIGHT } from './Controls';
import { RowModal } from './RowModal';
import { useStudio } from './store';
import { notify } from './Toasts';
import type { SettingEntry, SlottedSetting } from './types';
import { translate, useActiveLanguage, useBundles } from './studioLocale';
import { newRow } from './newRow';
import { studioKit } from './studioKit';
import './cc.css';
import { copyToClipboard, fetchNui, isEnvBrowser } from 'dirk-cfx-react';
import * as motion from 'framer-motion';
import { motion as m } from 'framer-motion';
import * as leaflet from 'leaflet';
import * as lucide from 'lucide-react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import * as React from 'react';
import * as reactDom from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as reactLeaflet from 'react-leaflet';
import * as reactQuery from '@tanstack/react-query';
import * as reactVirtual from '@tanstack/react-virtual';

/**
 * A control the OWNING SCRIPT supplies, rendered inline in its section.
 *
 * Built-in controls cover the shapes every script shares. Some things are only
 * meaningful to one script — dirk_phone's places want the phone's own map, with
 * its categories and its pins — and until now there was nowhere for those to
 * go. The alternative was per-script components inside dirk_lib, which is the
 * one thing this design refuses.
 *
 * The Studio is dirk_lib's bundle, so it cannot bundle another resource's
 * component. It can IMPORT one at runtime: `nui://<resource>/<path>` is the
 * same scheme the panel already uses for item images out of ox_inventory, so
 * this is an ordinary dynamic import rather than anything clever.
 *
 * The component builds with React, Mantine and the rest marked external and
 * mapped to `window.__dirkStudio.*`, so it ships as a small file that shares
 * the panel's own React - two copies of React in one page would break hooks.
 *
 * Declared as:
 *   "places": { "x-component": "web/build/studio/places-map.js" }
 *
 * The file default-exports a component taking `{ value, onChange, canEdit }` -
 * the same props ZoneMap already takes per layer.
 *
 * From v7 it can draw with the panel's own kit (`__dirkStudio.kit`, see
 * studioKit.tsx) and say so with `export const contract = 7`, which hands it
 * the whole frame to fill with its own plates.
 */

/**
 * What version of this contract the panel offers.
 *
 * Bump it when a shared dependency changes in a way that could break a
 * component built against the old one - a React or Mantine major. A component
 * can read `window.__dirkStudio.version` and refuse rather than fail halfway
 * through rendering, which is the difference between a clear message and a
 * white panel.
 */
const CONTRACT_VERSION = 7;

/**
 * Components that said they are built on the kit (`export const contract = 7`).
 *
 * Those draw their own plates, so the frame drops its border and background
 * and becomes the box they fill. A v6 component never says so and keeps the
 * bordered frame it was drawn for - both load, both look right.
 */
const KIT_BUILT = new WeakSet<object>();

/** What a remote component is handed instead of importing it itself. */
function sharedDeps() {
  return {
    version: CONTRACT_VERSION,
    React,
    react: React,
    jsxRuntime,
    'react/jsx-runtime': jsxRuntime,
    mantine,
    '@mantine/core': mantine,
    cfxReact,
    'dirk-cfx-react': cfxReact,
    lucide,
    'lucide-react': lucide,
    motion,
    'framer-motion': motion,
    // react-leaflet is shared for the same reason React is: its hooks read a
    // context that <Map> provides. A component bundling its own copy gets a
    // DIFFERENT context, so useMap() returns null and the panel white-screens
    // rather than failing cleanly. cfx-react re-exports Map/Marker/ZoomControls
    // but not the hooks, so this is the only way to reach them.
    reactLeaflet,
    'react-leaflet': reactLeaflet,
    leaflet,
    // createPortal, for putting a React node inside a leaflet marker.
    // Portalling from a SECOND ReactDOM into a tree this one owns is the same
    // breakage react-leaflet is shared to avoid.
    reactDom,
    'react-dom': reactDom,
    // Shared for the same reason React is: a query client lives in context,
    // so a component bundling its own copy of react-query would read a
    // DIFFERENT client - its own, with no provider above it - and every hook
    // would throw. The virtualiser is here to keep a long player list cheap
    // without every script shipping its own copy.
    reactQuery,
    '@tanstack/react-query': reactQuery,
    reactVirtual,
    '@tanstack/react-virtual': reactVirtual,
    // v7: the lib kit and the Studio's own shapes (search, filters, toolbar,
    // card wall, chip, button), so a script's screen is the panel's look by
    // default instead of a copy of it that drifts
    kit: studioKit,
    'dirk-studio-kit': studioKit,
  };
}

type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; Component: React.ComponentType<CustomProps> }
  | { state: 'failed'; reason: string };

export type CustomProps = {
  value: unknown;
  onChange: (next: unknown) => void;
  canEdit: boolean;
  /**
   * The row this control lives in, when it lives in one.
   *
   * A field inside a row usually needs its SIBLINGS to say anything useful —
   * whether a seller's dialogue has been written is a question about its `id`,
   * not about this field's own value, which may not have one at all.
   */
  row?: Record<string, unknown>;
  /**
   * Open the PANEL's own editor for one row of a list.
   *
   * A script supplies a custom control because it knows how its data should
   * LOOK - a fish wants its image, its rarity and its weight range, not a
   * generic row. It does not want to reimplement editing: the panel already
   * builds a form from the schema, honours `x-rowTabs`, validates, and offers
   * item and coordinate pickers. Reimplementing that per script is how the
   * per-script panels got out of hand in the first place.
   *
   * So the split is presentation here, editing there. Absent when the setting
   * is not a list - there is no row to open.
   */
  openRow?: (index: number) => void;
  /**
   * Ask for the whole window, rail folded - only a `bare` control gets this,
   * because only a control that already fills the pane has anywhere to put it.
   */
  setFull?: (on: boolean) => void;
  /** whether it currently has the window, so it can draw the right control */
  full?: boolean;
  /**
   * Leave the page altogether - hands the window back AND moves the rail off
   * this section, because landing on a smaller copy of what you were just
   * looking at reads as nothing having happened.
   */
  onBack?: () => void;
  /**
   * The section's plain settings, when this control holds the window.
   *
   * Its rail neighbours are folded away with the rail, so they come here
   * instead. Each `node` is the PANEL's own row - same editor, same staging,
   * same save bar - so placing them is a layout decision, not a rewrite; a
   * control that ignores them simply does not show them. `path` is there so
   * a master switch can be pulled out and put beside what it switches off.
   */
  settings?: SlottedSetting[];
  /** Append a row, seeded from the schema the same way the built-in list does. */
  addRow?: () => void;
  /** Remove a row by index. */
  deleteRow?: (index: number) => void;
  /**
   * Translate a key out of the OWNING SCRIPT's locale files.
   *
   * A script's own control still has text on it - "Baits", "Permit", a search
   * placeholder - and hardcoding English there would put an untranslatable
   * corner inside an otherwise translated panel. Keys resolve against the
   * script's own `locales/*.json`, which is where its strings already live;
   * dirk_lib never holds another script's text.
   */
  t?: (key: string, fallback: string) => string;
  /**
   * Say something happened.
   *
   * A control that acts IMMEDIATELY - giving an item, spawning something -
   * does it somewhere the panel is covering, so without this the button looks
   * broken whether it worked or not.
   */
  notify?: (kind: 'success' | 'error' | 'info', message: string) => void;
};

// One cache per resource+path: a section re-renders constantly, and evaluating
// a bundle on every render would be absurd.
const CACHE = new Map<string, Promise<React.ComponentType<CustomProps>>>();

/**
 * How many times each resource has restarted under this page.
 *
 * Dropping our own cache is not enough on its own: the browser keeps every ES
 * module it has imported, keyed by URL, for the life of the page, so importing
 * the same nui:// path again hands back the module from before the restart.
 * Each restart therefore imports under a new `?v=`, which the browser treats as
 * a new module. (A component split into chunks would still get its chunks from
 * before - which is why a component is built as one file.)
 */
const GENERATION = new Map<string, number>();

/**
 * Forget every component loaded from one resource.
 *
 * A restarted resource may be serving a NEW build of its component, but the
 * cache is keyed by resource and path - both unchanged - so without this the
 * panel would keep the module it imported before the restart and quietly
 * render yesterday's code.
 */
export function forgetComponents(resource: string) {
  GENERATION.set(resource, (GENERATION.get(resource) ?? 0) + 1);
  for (const key of [...CACHE.keys()]) {
    if (key.startsWith(`${resource}:`)) CACHE.delete(key);
  }
}

export function load(resource: string, path: string): Promise<React.ComponentType<CustomProps>> {
  const key = `${resource}:${path}`;
  const cached = CACHE.get(key);
  if (cached) return cached;

  const pending = (async () => {
    // A bundler that leaves `process.env.NODE_ENV` in its output produces a
    // file that dies on the first line in a browser - "process is not
    // defined" - and every React-adjacent toolchain does it unless told not
    // to. The author should define it away at build time, but one stray
    // reference should not be the difference between an editor and a red box,
    // so a minimal shim stands in. Only ever ADDED, never replacing a real one.
    const w = window as unknown as Record<string, unknown>;
    if (!w.process) w.process = { env: { NODE_ENV: 'production' } };

    // The deps are handed over as one global rather than left to the remote
    // file to import. It cannot import React itself - there is no module
    // resolver in a browser - so it builds with React, Mantine and the rest
    // marked external and mapped to `window.__dirkStudio.*`. That is why the
    // file is ~10KB and not a second copy of React.
    (window as unknown as Record<string, unknown>).__dirkStudio = sharedDeps();

    // A real ES module import, not an eval. dirk_lib's panel already loads
    // assets out of other resources this way (item images come from
    // nui://ox_inventory/web/images/), and a probe component served from
    // dirk_fishing loads through exactly this path.
    // In game this is a real nui:// fetch out of the owning resource. A
    // browser has no such scheme, so dev serves the same file from the
    // resource folder next door (see the middleware in vite.config.ts) -
    // otherwise a script's own pages cannot be opened in dev at all.
    const generation = GENERATION.get(resource) ?? 0;
    const url = (isEnvBrowser()
      ? `/__nui/${resource}/${path}`
      : `nui://${resource}/${path}`) + (generation > 0 ? `?v=${generation}` : '');

    let module_: { default?: React.ComponentType<CustomProps>; contract?: unknown };
    try {
      // Raced against a deadline: an nui:// fetch from a resource that is
      // mid-restart can neither resolve nor reject - the handler is simply
      // gone - and an import that never settles froze the whole tab until the
      // panel was closed and reopened. Ten seconds is enough for any real
      // bundle; after that the error box renders and (because failures are
      // not cached) the next visit simply tries again.
      module_ = await Promise.race([
        import(/* @vite-ignore */ url),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('ImportTimeout')), 10_000);
        }),
      ]);
    } catch (error) {
      // The browser's message for a failed module fetch is "Failed to fetch
      // dynamically imported module" and nothing else - true, and useless. Lua
      // can actually look: whether the resource is running, whether the path is
      // inside its web build, whether it declares scriptConfig, and whether the
      // file is in its fxmanifest files{}. Ask it, and report THAT.
      throw new Error(await diagnose(resource, path, error));
    }

    const Component = module_?.default;
    if (typeof Component !== 'function') throw new Error('NoDefaultExport');
    if (typeof module_.contract === 'number' && module_.contract >= 7) KIT_BUILT.add(Component);
    return Component;
  })();

  CACHE.set(key, pending);
  // A failure must not be cached forever - a restarted resource should be
  // retried rather than staying broken for the life of the page.
  pending.catch(() => CACHE.delete(key));
  return pending;
}

/**
 * Why did the import fail?
 *
 * Only the Lua side can tell the difference between "that resource is not
 * running" and "you forgot to list the file in fxmanifest files{}", both of
 * which look identical from the browser.
 */
async function diagnose(resource: string, path: string, original: unknown): Promise<string> {
  const reply = await fetchNui<{ ok?: boolean; _error?: string }>(
    'GET_STUDIO_COMPONENT',
    { resource, path },
    { ok: false, _error: 'BrowserPreview' },
  ).catch(() => ({ ok: false, _error: 'NoDiagnosis' }));

  // The file IS readable, so the failure is the import itself - CSP, a syntax
  // error in the bundle, or an import it makes that nothing provides.
  if (reply?.ok) {
    const detail = original instanceof Error ? original.message : String(original);
    return `the file was found but the browser refused it — ${detail}`;
  }
  return reply?._error ?? 'NoDiagnosis';
}

export const REASONS: Record<string, string> = {
  NotStarted: 'that resource is not running',
  BadPath: 'the component path is not inside its web build',
  NotAConsumer: 'that resource does not use scriptConfig',
  NotFound: 'the file is not in the resource, or not listed in its fxmanifest files{}',
  NoDefaultExport: 'the file has no default export, or it is not a component',
  BrowserPreview: 'there is no game to load it from',
  NoDiagnosis: 'the server could not say why',
};

export function CustomControl({
  resource, component, value, onChange, canEdit, entry, bare, row, settings, onBack, full, setFull,
}: {
  resource: string;
  component: string;
  /**
   * The row this control sits in, when it sits in one.
   *
   * A field inside a row usually needs its SIBLINGS to say anything useful —
   * a seller's dialogue coverage is a question about its `id`, not about the
   * field's own value, which may not have one at all.
   */
  row?: Record<string, unknown>;
  /** fill the pane: no frame, no border, no rounding (see x-componentFull) */
  bare?: boolean;
  value: unknown;
  onChange: (next: unknown) => void;
  canEdit: boolean;
  /** the setting itself, so list rows can be opened in the panel's own editor */
  entry?: SettingEntry;
  /**
   * The section's plain settings, for a control holding the window.
   *
   * These are the panel's OWN rows - they stage and save through the same bar
   * as everything else - so a control placing them is choosing where they go,
   * not reimplementing them.
   */
  settings?: SlottedSetting[];
  /** the page shell's own controls, handed straight to the component */
  onBack?: () => void;
  full?: boolean;
  setFull?: (on: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  /**
   * Which row the panel's editor is open on.
   *
   * The remote component decides WHICH row - it drew the thing that was
   * clicked - and the panel decides what editing one looks like. That keeps
   * `x-rowTabs`, validation and the item picker working for a script that
   * supplied nothing but a prettier row.
   */
  const [editingRow, setEditingRow] = useState<number | null>(null);
  /** a row being composed, not yet in the list */
  const [creatingRow, setCreatingRow] = useState<Record<string, unknown> | null>(null);

  const bundles = useBundles();
  const language = useActiveLanguage();
  const t = useCallback(
    (key: string, fallback: string) => translate(bundles, language, resource, key, fallback),
    [bundles, language, resource],
  );

  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : null;

  // Somewhere else asked for one of these rows to be opened - a validation
  // problem, most likely. Cleared once taken so asking twice still works.
  const rowRequest = useStudio((state) => state.openRowRequest);
  useEffect(() => {
    if (!rowRequest || !entry || rowRequest.path !== entry.path) return;
    if (!rows || !rows[rowRequest.index]) return;
    setEditingRow(rowRequest.index);
    useStudio.setState({ openRowRequest: null });
  }, [rowRequest, entry?.path, rows?.length]);

  // Only meaningful for a list; a component for a plain object gets undefined
  // and can tell the difference.
  const rowApi = rows
    ? {
      openRow: (index: number) => setEditingRow(index),
      // Composed first, appended on save - the same rule the built-in list
      // follows. Backing out of a new entry should leave nothing behind.
      addRow: () => {
        setCreatingRow(newRow(entry?.rowTemplate, entry?.columns));
      },
      deleteRow: (index: number) => onChange(rows.filter((_, i) => i !== index)),
    }
    : {};

  useEffect(() => {
    let live = true;
    setLoaded({ state: 'loading' });
    load(resource, component)
      .then((Component) => { if (live) setLoaded({ state: 'ready', Component }); })
      .catch((error: Error) => {
        if (live) setLoaded({ state: 'failed', reason: error.message });
      });
    return () => { live = false; };
  }, [resource, component]);

  if (loaded.state === 'ready') {
    // The component runs INSIDE the panel's React tree - that is what buys it
    // the theme, the fonts and the save bar for free, and it is also why a
    // throw would otherwise take the whole panel down with it. An iframe would
    // isolate it, at the cost of it looking like a foreign window bolted in.
    // This gets the isolation that actually matters without the cost.
    const openRow = rows && entry && editingRow !== null && rows[editingRow] ? editingRow : null;

    return (
      <>
        <StudioFrame bare={bare} kit={KIT_BUILT.has(loaded.Component)}>
          <ComponentBoundary resource={resource} component={component}>
            <loaded.Component
              value={value}
              onChange={onChange}
              canEdit={canEdit}
              row={row}
              t={t}
              notify={notify}
              setFull={setFull}
              full={full}
              settings={settings}
              onBack={onBack}
              {...rowApi}
            />
          </ComponentBoundary>
        </StudioFrame>

        {creatingRow && rows && entry && (
          <RowModal
            entry={entry}
            resource={resource}
            row={creatingRow}
            title={`New ${singular(entry.label).toLowerCase()}`}
            disabled={!canEdit}
            onSave={(next) => {
              onChange([...rows, next]);
              setCreatingRow(null);
            }}
            onDelete={() => setCreatingRow(null)}
            onClose={() => setCreatingRow(null)}
          />
        )}

        {openRow !== null && rows && entry && (
          <RowModal
            entry={entry}
            resource={resource}
            row={rows[openRow]}
            title={String(rows[openRow][entry.rowLabelKey ?? entry.columns?.[0]?.key ?? ''] ?? `Entry ${openRow + 1}`)}
            disabled={!canEdit}
            onSave={(next) => {
              onChange(rows.map((row, i) => (i === openRow ? next : row)));
              setEditingRow(null);
            }}
            onDelete={() => {
              onChange(rows.filter((_, i) => i !== openRow));
              setEditingRow(null);
            }}
            onClose={() => setEditingRow(null)}
          />
        )}
      </>
    );
  }

  if (loaded.state === 'loading') {
    return (
      <Flex align="center" justify="center" py="lg">
        <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.3)">
          Loading {resource}&apos;s editor&hellip;
        </Text>
      </Flex>
    );
  }

  // Say which resource, which file and what went wrong - a silent blank space
  // where an editor should be is the worst possible failure here.
  return (
    <Failure
      resource={resource}
      component={component}
      detail={REASONS[loaded.reason] ?? loaded.reason}
      verb="could not be loaded"
    />
  );
}

/**
 * The container a script's own control sits in.
 *
 * The PANEL owns the frame - border, radius, background - and the component
 * renders inside it. Left to themselves, authors draw their own, and the first
 * one drew it in the theme accent, which in this panel already means "staged,
 * unsaved". A section that looks edited when it is not is worse than an ugly
 * one, and consistency across every script is not something each author can be
 * asked to reproduce.
 *
 * Deliberately no padding: a map or a canvas should reach the edges. Anything
 * needing inner spacing can add its own.
 */
function StudioFrame({ children, bare, kit }: { children: React.ReactNode; bare?: boolean; kit?: boolean }) {
  const theme = useMantineTheme();
  const ref = useRef<HTMLDivElement | null>(null);

  /**
   * Tell the content its box changed.
   *
   * Leaflet measures its container ONCE when the map initialises and never
   * looks again. Mount it in a box that is momentarily zero-height - which is
   * exactly what happens while the pane is still laying out - and it draws
   * nothing, for ever, with no error: the tiles are simply positioned inside a
   * viewport it believes has no size.
   *
   * A window resize is what leaflet listens for, so one is fired whenever this
   * frame's size actually changes. It costs nothing for content that does not
   * care, and it means a component author never has to know about this.
   */
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let last = 0;
    const observer = new ResizeObserver(() => {
      const height = node.clientHeight;
      if (height === last) return;
      last = height;
      // after paint, so the content measures the box it ended up with
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Flex
      ref={ref as never}
      direction="column"
      style={{
        // The same resting border every setting row uses. The accent is
        // reserved for a staged change, and red for a value that blocks saving.
        border: bare || kit ? 'none' : `0.1vh solid ${alpha(theme.colors.dark[5], 0.35)}`,
        background: bare || kit ? 'transparent' : alpha(theme.colors.dark[8], 0.45),
        borderRadius: bare || kit ? 0 : theme.radius.xs,
        overflow: 'hidden',
        width: '100%',
        // BOUNDED, so a component written as `h="100%"` has something to be
        // 100% OF. Without a height here that collapses to the content's own
        // size and a map grows past the bottom of the window, leaving you to
        // scroll the page to see the rest of it.
        //
        // The same pane height the panel's own map uses, so a script's editor
        // and a built-in one are the same size without either knowing about
        // the other.
        height: PANE_HEIGHT,
        flex: 1,
        minHeight: PANE_MIN_HEIGHT,
        // never taller than the pane, whatever the content asks for
        maxHeight: '100%',
        // the fill layer below is measured against this
        position: 'relative',
      }}
    >
      {/*
        * The content sits in a layer pinned to all four edges.
        *
        * A component written as `h="100%"` - which is the obvious way to write
        * a map - resolves that percentage against its parent's HEIGHT, and a
        * parent stretched by `min-height` still computes `height: auto`. So the
        * frame was the right size while everything inside it was zero tall:
        * no error, no red box, just nothing, which is the worst way for this to
        * fail. Pinning to the edges gives the content a definite box whichever
        * way it sizes itself.
        */}
      <div
        className={kit ? 'ss-cc' : undefined}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        {children}
      </div>
    </Flex>
  );
}

/** Keeps a broken script component from taking the panel with it. */
class ComponentBoundary extends React.Component<
  { resource: string; component: string; children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { resource: string; component: string; children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Failure
        resource={this.props.resource}
        component={this.props.component}
        detail={this.state.error.message}
        verb="crashed"
      />
    );
  }
}

/** One shape for both "could not load it" and "it broke while rendering". */
function Failure({
  resource, component, detail, verb,
}: { resource: string; component: string; detail: string; verb: string }) {
  const theme = useMantineTheme();
  const [copied, setCopied] = useState(false);

  // The person who can fix this is usually not the person looking at it - it is
  // whoever wrote the component. Retyping an error out of a game window is how
  // details get lost, so hand over the whole thing in one go.
  const report = [
    `resource: ${resource}`,
    `component: ${component}`,
    `${verb}: ${detail}`,
  ].join('\n');

  const copy = () => {
    copyToClipboard(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Flex
      align="flex-start" gap="xs" px="sm" py="xs"
      style={{
        background: alpha('#ef4444', 0.08),
        border: `0.1vh solid ${alpha('#ef4444', 0.35)}`,
        borderRadius: theme.radius.xs,
      }}
    >
      <AlertTriangle size="1.6vh" color="#ef4444" style={{ marginTop: '0.2vh', flexShrink: 0 }} />
      <Flex direction="column" style={{ lineHeight: 1.3, minWidth: 0, flex: 1 }}>
        <Text ff="Akrobat Bold" size="xs" c="#ef4444">
          {resource}&apos;s editor {verb}
        </Text>
        <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.45)">
          {detail} — {component}
        </Text>
      </Flex>

      <m.button
        type="button"
        onClick={copy}
        whileTap={{ scale: 0.94 }}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.4vh',
          padding: '0.4vh 0.7vh',
          background: 'transparent',
          border: `0.1vh solid ${alpha('#ef4444', 0.4)}`,
          borderRadius: theme.radius.xs,
          cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-start',
        }}
        aria-label="Copy the error"
      >
        {copied ? <Check size="1.2vh" color="#5BC98C" /> : <Copy size="1.2vh" color="#ef4444" />}
        <Text ff="Akrobat Bold" size="xxs" c={copied ? '#5BC98C' : '#ef4444'}>
          {copied ? 'Copied' : 'Copy'}
        </Text>
      </m.button>
    </Flex>
  );
}
