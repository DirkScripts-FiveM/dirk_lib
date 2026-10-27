import { fetchNui, isEnvBrowser } from 'dirk-cfx-react';
import { useEffect, useMemo, useState } from 'react';
import { effectiveValue, useStudio } from './store';
import type { SettingEntry } from './types';

/**
 * What dirk_lib is bridged to, and whether it took.
 *
 * The page used to be entirely invented - a hand-written list of rows with a
 * hand-written registry of which resources were "running". It looked exactly
 * like the real thing, which is the worst way for a diagnostic page to be
 * wrong: the first place you look when something misbehaves was telling you
 * about a server that does not exist.
 *
 * Nothing here is a list. The rows ARE dirk_lib's own `bridging.*` settings,
 * so every option a bridge offers is the option the server actually accepts,
 * and adding a supported inventory means editing the schema and nothing else.
 * The only thing asked of the game is what no schema can know: which of those
 * resources are up, at what version, and what auto-detection picked.
 */

export type BridgeRow = {
  key: string;
  label: string;
  icon: string;
  /** current setting: "auto", or a forced resource name */
  value: string;
  options?: string[];
  /** what auto-detection found, when the setting is "auto" */
  detected?: string;
  /** dependencies are reported, not chosen */
  readOnly?: boolean;
  /** fixed verdict for things that are not resources (server build, OneSync) */
  fixed?: { ok: boolean; resolved: string; version?: string; note: string };
  /** `itemImgPath` is a folder, not a resource - it takes typed text */
  kind?: 'resource' | 'path';
  /** the setting this card edits, absent for reported-only rows */
  entry?: SettingEntry;
};

export type BridgeState = {
  detected: Record<string, string>;
  resources: Record<string, {
    running: boolean; state: string; version?: string;
    /** declared in dirk_lib's own fxmanifest - a requirement, not a bridge */
    required?: boolean;
  }>;
  server: { artifact?: number; minimum?: number; ok: boolean; gameBuild?: number };
  onesync: { mode: string; required?: boolean; ok: boolean };
};

/** Enough of a server to design against, with nothing pretending to be real. */
const BROWSER_PREVIEW: BridgeState = {
  detected: {
    framework: 'qbx_core', inventory: 'ox_inventory', target: 'ox_target',
    itemImgPath: 'nui://ox_inventory/web/images/',
  },
  resources: {
    qbx_core: { running: true, state: 'started', version: '1.24.0' },
    ox_inventory: { running: true, state: 'started', version: '2.45.2' },
    ox_target: { running: true, state: 'started', version: '1.16.0' },
    ox_lib: { running: true, state: 'started', version: '3.30.6' },
    oxmysql: { running: true, state: 'started', version: '2.14.1', required: true },
    dirk_lib: { running: true, state: 'started', version: '1.2.80' },
  },
  server: { artifact: 12913, minimum: 7290, ok: true, gameBuild: 3095 },
  onesync: { mode: 'infinity', required: true, ok: true },
};

/** The bridging settings, split into the bands the page draws. */
export function useBridgeRows() {
  const scripts = useStudio((s) => s.scripts);
  // subscribing to the draft keeps a staged change visible immediately
  const draft = useStudio((s) => s.draft.dirk_lib);

  return useMemo(() => {
    const lib = scripts.find((script) => script.shared);
    const all = (lib?.entries ?? []).filter((entry) => entry.path.startsWith('bridging.'));

    const value = (entry: SettingEntry) => String(effectiveValue(lib!.resource, entry) ?? '');

    return {
      resource: lib?.resource ?? 'dirk_lib',
      interface: all.filter((e) => e.bridgeGroup === 'interface'),
      bridges: all.filter((e) => e.bridgeGroup !== 'interface'),
      all,
      value,
      // Everything a bridge could resolve to, so the game is asked about those
      // resources and no others. `auto` is a mode, not a resource.
      //
      // The OPTIONS only. Including each setting's current value meant typing
      // in the image-path box changed this list on every keystroke, which
      // changed the query key, which refetched the whole page - the field
      // flickered and lost focus one letter at a time. A free-text path is not
      // a resource to ask about anyway.
      names: [...new Set(
        all.flatMap((entry) => (entry.options ?? []).map((option) => String(option.value))),
      )].filter((name) => name && name !== 'auto'),
      // eslint-disable-next-line react-hooks/exhaustive-deps
    };
  }, [scripts, draft]);
}

/** What the game says about those resources. */
export function useBridgeState(names: string[]) {
  const [state, setState] = useState<BridgeState | null>(null);
  const [loading, setLoading] = useState(true);
  // bumped by "Check again" - a resource started since the page opened
  const [asked, setAsked] = useState(0);
  // The page stays mounted while the panel is shut, and the game refuses this
  // with the panel shut - so an answer from then sat there as "Could not read
  // this server" after the next open. Every open asks again.
  const open = useStudio((s) => s.open);

  // The names are stable in practice but not by identity, so the effect keys
  // off their content rather than the array.
  const key = names.join(',');

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);

    const ask = async () => {
      if (isEnvBrowser()) return BROWSER_PREVIEW;
      const reply = await fetchNui<BridgeState & { success?: boolean }>(
        'GET_BRIDGE_STATE',
        { resources: names },
      );
      // A failure here must not look like "nothing is installed", which is
      // what an empty registry would read as on a page about what is installed.
      if (!reply?.success) throw new Error('NoAnswer');
      return reply;
    };

    ask()
      .then((reply) => { if (live) setState(reply); })
      .catch(() => { if (live) setState(null); })
      .finally(() => { if (live) setLoading(false); });

    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, asked, open]);

  return { state, loading, again: () => setAsked((n) => n + 1) };
}
