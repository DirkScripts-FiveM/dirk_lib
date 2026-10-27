import { useDeferredValue, useMemo } from 'react';
import { create } from 'zustand';
import { isModified, useStudio } from './store';
import { problemsFor } from './validate';
import { outdatedScripts, usePublicInfo } from './publicInfo';

/*
 * What the rail, the script picker and the overview say about each script:
 * how many settings differ from how it shipped, how many values are wrong,
 * and whether a newer version is out. One pass over every script, redone
 * only when the scripts or the staged edits change.
 */

export type ScriptStat = { changed: number; problems: number; update?: string };

export function useScriptStats(): Map<string, ScriptStat> {
  const scripts = useStudio((s) => s.scripts);
  // deferred: a keystroke in a field must never wait on re-checking every script
  const draft = useDeferredValue(useStudio((s) => s.draft));
  const updates = useUpdates();
  return useMemo(() => {
    const out = new Map<string, ScriptStat>();
    for (const script of scripts) {
      let changed = 0;
      for (const entry of script.entries) if (!entry.hidden && isModified(script.resource, entry)) changed += 1;
      out.set(script.resource, { changed, problems: problemsFor(script.resource).length, update: updates.get(script.resource) });
    }
    return out;
  }, [scripts, draft, updates]);
}

/** resource -> the newer version dirk_publicInfo announces for it */
export function useUpdates(): Map<string, string> {
  const scripts = useStudio((s) => s.scripts);
  const latest = usePublicInfo().data?.versions;
  return useMemo(() => {
    const out = new Map<string, string>();
    if (!latest) return out;
    const installed: Record<string, string> = {};
    for (const s of scripts) installed[s.resource] = s.version;
    for (const o of outdatedScripts(latest, installed)) out.set(o.resource, o.available);
    return out;
  }, [scripts, latest]);
}

// ── pinned + recent scripts ─────────────────────────────────────────────────
//
// Per admin, per machine: the NUI's own localStorage. Nothing here is worth a
// round trip to the server, and a cleared cache only loses a convenience.

const PINS = 'dirk_studio_pins';
const RECENT = 'dirk_studio_recent';

const readList = (key: string): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
};
const writeList = (key: string, list: string[]) => {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage off */ }
};

export const usePins = create<{ pins: string[]; recent: string[] }>(() => ({ pins: readList(PINS), recent: readList(RECENT) }));

export function togglePin(resource: string) {
  const { pins } = usePins.getState();
  const next = pins.includes(resource) ? pins.filter((r) => r !== resource) : [...pins, resource];
  usePins.setState({ pins: next });
  writeList(PINS, next);
}

export function noteRecent(resource: string) {
  const { recent } = usePins.getState();
  if (recent[0] === resource) return;
  const next = [resource, ...recent.filter((r) => r !== resource)].slice(0, 6);
  usePins.setState({ recent: next });
  writeList(RECENT, next);
}
