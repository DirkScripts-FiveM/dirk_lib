import { Tooltip } from '@mantine/core';
import {
  AlertTriangle, Braces, Check, ChevronRight, History, Home, Layers, Loader2, Lock, Redo2, RefreshCw, RotateCcw, Search, SlidersHorizontal, Star, Undo2, X,
} from 'lucide-react';
import { Fragment, startTransition, useEffect, useMemo, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useStudio } from './store';
import { sectionKey, translate, useActiveLanguage, useBundles, useChrome } from './studioLocale';
import { togglePin, usePins, useScriptStats } from './stats';
import { chipVars } from './Dialog';
import { useAnnouncedResources } from './Dispatch';
import { Btn } from './studioKit';
import type { SettingEntry, SettingGroup, StudioScript } from './types';

/*
 * The Studio's frame in the lib kit (Liam's 24/10 mock): the top bar, the rail,
 * the save bar and the CTRL K script picker. Each is its own plate; main.tsx
 * lays them on the `.ss-win` grid.
 *
 * The rail no longer lists every script. With twenty of them it ran off the
 * bottom, so it holds what you use (pinned, then recent) and the picker holds
 * the rest. Inside a script it is that script's sections.
 */

const tip = { zIndex: 10000, withArrow: true, openDelay: 250 } as const;

// ── top bar ─────────────────────────────────────────────────────────────────

export function TopBar({
  query, onQuery, searchable, placeholder, onClose, canEdit, missingItems, account, switcher,
}: {
  query: string;
  onQuery: (v: string) => void;
  /** pages that filter for themselves get no search box */
  searchable: boolean;
  placeholder: string;
  onClose: () => void;
  canEdit: boolean;
  missingItems?: ReactNode;
  /** the linked account chip (AccountChip) */
  account?: ReactNode;
  /** the script switcher (ScriptSwitch), which is also the title plate */
  switcher?: ReactNode;
}) {
  const t = useChrome();
  // Local text so a keystroke never waits on the panel-wide filter.
  const [local, setLocal] = useState(query);
  const [focus, setFocus] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setLocal(query); }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'f' || e.key === 'F') && ref.current) { e.preventDefault(); ref.current.focus(); ref.current.select(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const set = (v: string) => { setLocal(v); startTransition(() => onQuery(v)); };

  return (
    <div className="ss-top">
      {switcher ?? (
        <div className="pl ss-brand in">
          <div className="sk">
            <SlidersHorizontal className="ico" />
            <div>
              <div className="T">{t('header.title', 'Script Studio')}</div>
              <div className="L">{t('header.description', 'Every dirk script, in one place')}</div>
            </div>
          </div>
        </div>
      )}

      {searchable ? (
        <label className={'ss-srch' + (focus ? ' focus' : '')}>
          <Search className="ico" />
          <input
            ref={ref}
            value={local}
            onChange={(e) => set(e.currentTarget.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            onKeyDown={(e) => { if (e.key === 'Escape' && local) { e.stopPropagation(); set(''); } }}
            placeholder={placeholder}
          />
          {local
            ? <span className="cap dark sm x" onClick={() => set('')} aria-label={t('main.clear_search', 'Clear search')}><b><X size="1.3vh" /></b></span>
            : <span className="cap sm"><b>CTRL F</b></span>}
        </label>
      ) : <span className="ss-gap" />}

      <div className="ss-topR">
        {!canEdit && <span className="ss-chip ctl" style={chipVars('#e0a13f')}><b><Lock />{t('main.view_only', 'View only')}</b></span>}
        {missingItems}
        {account}
        <Tooltip label={t('main.close', 'Close')} {...tip}>
          <span className="cap dark" onClick={onClose}><b><X size="1.8vh" /></b></span>
        </Tooltip>
      </div>
    </div>
  );
}

// ── script switcher ─────────────────────────────────────────────────────────

/**
 * The title plate, and the way to another script (Liam 25/10).
 *
 * It sat under the title as the rail's first row, so the panel's name and the
 * thing you are in were two plates saying one thing - and the rail lost a
 * plate's height to it. Up here it is the title: which script, which version,
 * and CTRL K to change it. It sits over the rail's column, so the rail below
 * reads as its contents.
 */
export function ScriptSwitch({ scripts, script, activePage, open, onOpen }: {
  scripts: StudioScript[];
  script: StudioScript;
  activePage: string | null;
  open: boolean;
  onOpen: () => void;
}) {
  const t = useChrome();
  const inScript = ownedByScript(activePage) && activePage !== 'home';
  const count = scripts.filter((s) => !s.shared).length;
  return (
    <div className={'pl ss-sw top in' + (open ? ' open' : '')} onClick={onOpen}>
      <div className="sk">
        <span className="ic">{inScript ? <Icon name={script.icon} size="2.3vh" color="currentColor" /> : <Layers />}</span>
        <div className="tx">
          <div className="L k">{t('header.title', 'Script Studio')}</div>
          <div className="t">{inScript ? script.label : t('rail.all', 'All scripts')}</div>
          <div className="L">
            {inScript
              ? `v${script.version} · ${t('rail.switch', 'switch script')}`
              : t('rail.on_server', '{n} on this server').replace('{n}', String(count))}
          </div>
        </div>
        <span className="cap sm"><b>CTRL K</b></span>
      </div>
    </div>
  );
}

// ── rail ────────────────────────────────────────────────────────────────────

export const PAGES: { id: string; label: string; icon: string; band: 'server' | 'library' }[] = [
  { id: 'admins', label: 'Admins', icon: 'users', band: 'server' },
  { id: 'logs', label: 'Logs', icon: 'scroll-text', band: 'server' },
  { id: 'bridges', label: 'Bridges', icon: 'plug', band: 'server' },
  { id: 'items', label: 'Items', icon: 'package', band: 'library' },
  { id: 'vehicles', label: 'Vehicles', icon: 'car', band: 'library' },
  // Minigames is off the rail until scripts use it (Liam 25/10); MinigamesPage stays for when it returns.
];

/** A page that belongs to the open script rather than to the server. */
export const ownedByScript = (page: string | null) =>
  !page || page === 'design' || page === 'changelog' || page === 'tests' || page.startsWith('page:');

export function Rail({
  scripts, script, groupLabels, visibleGroups, byGroup, modifiedByGroup, activeGroup, activePage,
  onPickScript, onPickPage, onPickGroup, onPickSubgroup,
  subgroupsByGroup, openGroups, setOpenGroups, activeSubgroup, shownList,
  onHoverGroup, onLeaveGroup, onOpenPicker,
}: {
  scripts: StudioScript[];
  script: StudioScript;
  groupLabels: Map<string, string>;
  visibleGroups: SettingGroup[];
  byGroup: Map<string, SettingEntry[]>;
  modifiedByGroup: Map<string, number>;
  activeGroup: string;
  activePage: string | null;
  onPickScript: (resource: string) => void;
  onPickPage: (id: string) => void;
  onPickGroup: (groupId: string) => void;
  onPickSubgroup: (groupId: string, subgroupId: string, listPath?: string) => void;
  subgroupsByGroup: Map<string, { id: string; label: string; count: number; list?: string }[]>;
  openGroups: Set<string>;
  activeSubgroup: string | null;
  shownList: string | null;
  setOpenGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  onHoverGroup: (index: number) => void;
  onLeaveGroup: () => void;
  onOpenPicker: () => void;
}) {
  const t = useChrome();
  const changelogs = useStudio((s) => s.changelogs);
  const tests = useStudio((s) => s.tests);
  const announced = useAnnouncedResources();
  const language = useActiveLanguage();
  const bundles = useBundles();
  const { pins, recent } = usePins();
  const stats = useScriptStats();

  const inScript = ownedByScript(activePage) && activePage !== 'home';
  const lib = scripts.find((s) => s.shared);
  const userScripts = useMemo(() => scripts.filter((s) => !s.shared), [scripts]);
  // what the footer names: the script you are in, else the library the page belongs to
  const footer = inScript ? script : (lib ?? script);

  // Overview: pinned first, then recent, and the picker holds everything else.
  // A first visit has neither, so it shows the first few scripts instead of an
  // empty rail.
  const byRes = useMemo(() => new Map(userScripts.map((s) => [s.resource, s])), [userScripts]);
  const pinned = pins.map((r) => byRes.get(r)).filter(Boolean) as StudioScript[];
  const recents = recent.filter((r) => !pins.includes(r)).map((r) => byRes.get(r)).filter(Boolean).slice(0, 4) as StudioScript[];
  const starter = pinned.length + recents.length === 0 ? userScripts.slice(0, 6) : [];
  const shown = pinned.length + recents.length + starter.length;

  const scriptRow = (s: StudioScript) => {
    const st = stats.get(s.resource);
    return (
      <div key={s.resource} className="pl ss-ri" onClick={() => onPickScript(s.resource)}>
        <div className="sk">
          <Icon name={s.icon} size="1.8vh" color="var(--a)" />
          <span className="t">{s.label}</span>
          {st?.problems ? <span className="dot w" /> : st?.update || announced.has(s.resource) ? <span className="dot" /> : null}
        </div>
      </div>
    );
  };

  const tool = (id: string, label: string, icon: string, onClick: () => void, on: boolean, badge?: boolean) => (
    <Tooltip key={id} label={label} {...tip}>
      <div className={'pl ss-tool' + (on ? ' on' : '')} onClick={onClick}>
        <Icon name={icon} size="1.9vh" color="currentColor" />
        {badge && <span className="bd" />}
      </div>
    </Tooltip>
  );

  const subRow = (key: string, label: string, icon: string, on: boolean, onClick: () => void, extra?: ReactNode, page?: boolean) => (
    <div key={key} className={'pl ss-ri sub' + (on ? ' on' : '') + (page ? ' page' : '')} onClick={onClick}>
      <div className="sk">
        <Icon name={icon} size="1.5vh" color="currentColor" />
        <span className="t">{label}</span>
        {extra}
      </div>
    </div>
  );

  return (
    <aside className="ss-rail in" style={{ '--i': 1 } as CSSProperties}>
      <div className="ss-rbody studio-scroll">
        {!inScript ? (
          <>
            <div className={'pl ss-ri' + (activePage === 'home' ? ' on' : '')} onClick={() => onPickPage('home')}>
              <div className="sk"><Icon name="home" size="1.8vh" color="var(--a)" /><span className="t">{t('page.home', 'Overview')}</span></div>
            </div>
            {pinned.length > 0 && <div className="L ss-rl"><Star />{t('rail.pinned', 'Pinned')}</div>}
            {pinned.map(scriptRow)}
            {recents.length > 0 && <div className="L ss-rl"><History />{t('rail.recent', 'Recent')}</div>}
            {recents.map(scriptRow)}
            {starter.length > 0 && <div className="L ss-rl">{t('main.scripts', 'Scripts')}</div>}
            {starter.map(scriptRow)}
            {userScripts.length > shown && (
              <div className="pl ss-ri dim" onClick={onOpenPicker}>
                <div className="sk">
                  <Layers className="ico" />
                  <span className="t">{t('rail.more', '{n} more scripts').replace('{n}', String(userScripts.length - shown))}</span>
                  <ChevronRight className="chev" />
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* no "back to Overview" row: the switcher above is the way out, and
                its picker has Overview on it (Liam 25/10) */}
            <div className="L ss-rl">{t('rail.sections', 'Sections')}<span className="n">{visibleGroups.length}</span></div>

            {changelogs.includes(script.resource) && subRow('changelog', t('main.changelog', "What's new"), 'scroll-text', activePage === 'changelog', () => onPickPage('changelog'),
              <>{announced.has(script.resource) && <span className="dot" />}<span className="n">v{script.version}</span></>, true)}
            {tests.includes(script.resource) && subRow('tests', t('main.tests', 'Tests'), 'flask-conical', activePage === 'tests', () => onPickPage('tests'), undefined, true)}
            {script.pages?.map((p) => subRow(`page:${p.id}`, translate(bundles, language, script.resource, `studio.pages.${p.id}.label`, p.label), p.icon,
              activePage === `page:${p.id}`, () => onPickPage(`page:${p.id}`), undefined, true))}

            {visibleGroups.map((group, i) => {
              const on = !activePage && group.id === activeGroup;
              const subs = subgroupsByGroup.get(group.id) ?? [];
              const open = openGroups.has(group.id);
              const mod = modifiedByGroup.get(group.id) ?? 0;
              const label = script.shared
                ? translate(bundles, language, script.resource, sectionKey(group.id, 'label'), group.label)
                : groupLabels.get(group.id) ?? group.label;
              return (
                <Fragment key={group.id}>
                  <div
                    className={'pl ss-ri sub' + (on ? ' on' : '')}
                    onClick={() => onPickGroup(group.id)}
                    // start building the section while the pointer is still on its way
                    onPointerEnter={() => onHoverGroup(i)}
                    onPointerLeave={onLeaveGroup}
                  >
                    <div className="sk">
                      <Icon name={group.icon} size="1.5vh" color="currentColor" />
                      <span className="t">{label}</span>
                      {mod > 0 && <span className="dot" />}
                      <span className="n">{byGroup.get(group.id)?.length ?? 0}</span>
                      {subs.length > 1 && (
                        <ChevronRight
                          className={'chev' + (open ? ' open' : '')}
                          onClick={(e) => {
                            // opening the tree is not picking the section
                            e.stopPropagation();
                            setOpenGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                              return next;
                            });
                          }}
                        />
                      )}
                    </div>
                  </div>
                  {open && subs.length > 1 && subs.map((sub) => {
                    const subOn = on && (sub.list ? shownList === sub.list : activeSubgroup === sub.id);
                    return (
                      <div key={sub.id} className={'pl ss-ri sub leaf' + (subOn ? ' on' : '')} onClick={() => onPickSubgroup(group.id, sub.id, sub.list)}>
                        <div className="sk"><span className="t">{sub.label}</span><span className="n">{sub.count}</span></div>
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </>
        )}
      </div>

      <div className="L ss-rl">{t('rail.tools', 'Server + library')}</div>
      <div className="ss-tools">
        {lib && tool('shared', lib.label, lib.icon || 'library', () => onPickScript(lib.resource), inScript && script.resource === lib.resource, !!stats.get(lib.resource)?.update)}
        {PAGES.map((p) => tool(p.id, t(`page.${p.id}`, p.label), p.icon, () => onPickPage(p.id), activePage === p.id))}
      </div>

      <div className="ss-foot"><span>{footer.resource}</span><span>v{footer.version}</span></div>
    </aside>
  );
}

// ── script picker (CTRL K) ──────────────────────────────────────────────────

type Filter = 'all' | 'pinned' | 'changed' | 'look' | 'update';

export function ScriptPicker({ scripts, current, onPick, onClose, onHome }: {
  scripts: StudioScript[];
  current?: string;
  onPick: (resource: string) => void;
  onClose: () => void;
  /** back to the Overview - the rail no longer has a row for it inside a script */
  onHome: () => void;
}) {
  const t = useChrome();
  const stats = useScriptStats();
  const { pins } = usePins();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [cur, setCur] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scripts
      .filter((s) => !needle || s.label.toLowerCase().includes(needle) || s.resource.toLowerCase().includes(needle))
      .filter((s) => {
        const st = stats.get(s.resource);
        if (filter === 'pinned') return pins.includes(s.resource);
        if (filter === 'changed') return (st?.changed ?? 0) > 0;
        if (filter === 'look') return (st?.problems ?? 0) > 0;
        if (filter === 'update') return !!st?.update;
        return true;
      })
      // pinned first, then by name; dirk_lib (the shared layer) last
      .sort((a, b) => Number(!!a.shared) - Number(!!b.shared)
        || Number(pins.includes(b.resource)) - Number(pins.includes(a.resource))
        || a.label.localeCompare(b.label));
  }, [scripts, q, filter, stats, pins]);

  useEffect(() => { setCur(0); }, [q, filter]);

  // three to a row: the arrows walk the grid as you see it
  const COLS = 3;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); return; }
      if (e.key === 'Enter') { const s = list[cur]; if (s) { e.preventDefault(); onPick(s.resource); } return; }
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? COLS : e.key === 'ArrowUp' ? -COLS : 0;
      if (!step || !list.length) return;
      e.preventDefault();
      setCur((c) => Math.max(0, Math.min(list.length - 1, c + step)));
    };
    // capture: the panel's own Escape (close everything) must not see this one
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [list, cur, onClose, onPick]);

  useEffect(() => {
    (gridRef.current?.children[cur] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [cur]);

  const count = (f: Filter) => scripts.filter((s) => {
    const st = stats.get(s.resource);
    return f === 'pinned' ? pins.includes(s.resource) : f === 'changed' ? (st?.changed ?? 0) > 0 : f === 'look' ? (st?.problems ?? 0) > 0 : f === 'update' ? !!st?.update : true;
  }).length;

  const FILTERS: [Filter, string][] = [
    ['all', t('picker.all', 'All')],
    ['pinned', t('picker.pinned', 'Pinned')],
    ['changed', t('picker.changed', 'Changed')],
    ['look', t('picker.look', 'Needs a look')],
    ['update', t('picker.update', 'Update ready')],
  ];

  return (
    <>
      <div className="ss-scrim" onClick={onClose} />
      <div className="ss-pick">
        <div className="pl ss-pkh edge">
          <div className="sk" style={{ display: 'flex', alignItems: 'center', gap: '1.6vh' }}>
            <div style={{ flex: 'none' }}>
              <div className="T" style={{ fontSize: '2.2vh' }}>{t('picker.title', 'Switch script')}</div>
              <div className="L" style={{ marginTop: '.3vh' }}>{t('picker.hint', 'Arrows to move · Enter to open · Esc to close')}</div>
            </div>
            <label className="ss-srch focus" style={{ flex: 1 }}>
              <Search className="ico" />
              <input autoFocus value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder={t('picker.search', 'Find a script...')} />
            </label>
            <Btn icon={<Home />} label={t('page.home', 'Overview')} onClick={onHome} />
          </div>
        </div>

        <div className="kstrip ss-pk-f">
          {FILTERS.map(([f, label], i) => (
            <span key={f} className={'pl kp in' + (filter === f ? ' on' : '')} style={{ '--i': i } as CSSProperties} onClick={() => setFilter(f)}>
              <span className="sk"><span className="cap sm dark"><b>{count(f)}</b></span><span className="act">{label}</span></span>
            </span>
          ))}
        </div>

        {list.length === 0 ? (
          <div className="ss-empty"><Search /><div className="D">{t('picker.none', 'No script matches.')}</div></div>
        ) : (
          <div className="ss-pgrid studio-scroll" ref={gridRef}>
            {list.map((s, i) => {
              const st = stats.get(s.resource);
              const pin = pins.includes(s.resource);
              return (
                <div
                  key={s.resource}
                  className={'pl ss-pr in' + (i === cur ? ' cur' : '')}
                  style={{ '--i': Math.min(i, 14) } as CSSProperties}
                  onClick={() => onPick(s.resource)}
                  onPointerEnter={() => setCur(i)}
                >
                  <div className="sk">
                    <span className="ic"><Icon name={s.icon} size="1.9vh" color="currentColor" /></span>
                    <div className="tx">
                      <div className="t">{s.label}</div>
                      <div className="D">
                        v{s.version}
                        {st?.changed ? <> · <b>{st.changed}</b> {t('picker.changed_n', 'changed')}</> : null}
                        {s.resource === current ? <> · {t('picker.open', 'open')}</> : null}
                      </div>
                    </div>
                    {st?.problems ? <span className="ss-chip" style={chipVars('#e0a13f')}><b><AlertTriangle />{st.problems}</b></span> : null}
                    {st?.update ? <span className="ss-chip" style={chipVars('#3fbf6a')}><b>v{st.update}</b></span> : null}
                    {!s.shared && (
                      <span className={'pin' + (pin ? ' y' : '')} onClick={(e) => { e.stopPropagation(); togglePin(s.resource); }} title={pin ? t('picker.unpin', 'Unpin') : t('picker.pin', 'Pin to the rail')}>
                        <Star />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ── save bar ────────────────────────────────────────────────────────────────

export function SaveBar({
  dirty, saving, saveError, saved, canEdit, onDiscard, onSave, onUndo, onRedo, canUndo, canRedo,
  onJson, onHistory, onReset, onRefresh, problems, onShowProblem,
}: {
  dirty: number;
  saving: boolean;
  /** why the last save was refused, or null */
  saveError: string | null;
  /** a save of THIS script has succeeded since the panel opened */
  saved: boolean;
  canEdit: boolean;
  problems: { path: string; label: string; group: string; message: string }[];
  onShowProblem: (problem: { group: string; path: string }) => void;
  onDiscard: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onJson?: () => void;
  onHistory: () => void;
  onReset: () => void;
  onRefresh: () => void;
}) {
  const t = useChrome();
  const n = (one: string, other: string, count: number) => (count === 1 ? one : other).replace('{n}', String(count));

  // one plate says where things stand; problems outrank staged edits, which outrank "saved"
  const state = saving ? 'wait' : problems.length ? 'bad' : dirty ? 'staged' : saved ? 'saved' : 'clean';
  const label = state === 'wait' ? t('main.saving', 'Saving...')
    : state === 'bad' ? n(t('main.problem_count_one', '1 problem'), t('main.problem_count_other', '{n} problems'), problems.length)
      : state === 'staged' ? n(t('main.unsaved_count_one', '1 unsaved change'), t('main.unsaved_count_other', '{n} unsaved changes'), dirty)
        : state === 'saved' ? t('main.all_changes_saved', 'Saved.')
          : t('main.nothing_to_save', 'No unsaved changes.');
  const StateIcon = state === 'wait' ? Loader2 : state === 'bad' ? AlertTriangle : state === 'saved' ? Check : null;

  const ib = (Cmp: ElementType, tipText: string, onClick: (() => void) | undefined, off?: boolean, red?: boolean) => (
    <Tooltip label={tipText} {...tip} position="top">
      <span className={'cap dark' + (red ? ' red' : '') + (off ? ' off' : '')} onClick={off ? undefined : onClick}><b><Cmp size="1.6vh" /></b></span>
    </Tooltip>
  );

  return (
    <div className="ss-save in" style={{ '--i': 2 } as CSSProperties}>
      {state === 'clean'
        ? <span className="D" style={{ color: 'rgba(255,255,255,.4)' }}>{label}</span>
        : (
          <span className={'pl st1 ' + state}>
            <span className="sk">{StateIcon && <StateIcon className={'ico' + (state === 'wait' ? ' spin' : '')} />}<span className="act">{label}</span></span>
          </span>
        )}
      {state === 'bad' && (
        // name the first one and go there - a count alone leaves you hunting
        <span className="D go" onClick={() => onShowProblem(problems[0]!)}>{problems[0]!.label}: {problems[0]!.message} →</span>
      )}
      {state === 'staged' && <span className="D">{t('main.changes_are_staged_until_you_save', 'Changes are staged until you save.')}</span>}
      {saveError && <span className="D r"><AlertTriangle size="1.4vh" style={{ verticalAlign: '-.2vh' }} /> {saveError}</span>}
      <span className="sp" />

      <span className="ib">
        {onJson && ib(Braces, t('main.view_or_import_json', 'View or import JSON'), onJson)}
        {ib(History, t('main.change_history', 'Change history'), onHistory)}
        {ib(RefreshCw, t('main.refresh_from_server', 'Refresh from server'), onRefresh)}
        {ib(RotateCcw, t('main.reset_everything_to_defaults', 'Reset everything to defaults'), onReset, !canEdit, true)}
      </span>
      <span className="ss-sep" />
      <span className="ib">
        {ib(Undo2, t('main.undo', 'Undo'), onUndo, !canUndo || saving || !canEdit)}
        {ib(Redo2, t('main.redo', 'Redo'), onRedo, !canRedo || saving || !canEdit)}
      </span>
      <span className="ss-sep" />
      <div className={'pl ss-btn' + (dirty === 0 || saving ? ' off' : '')} onClick={onDiscard}>
        <div className="sk"><span className="act">{t('main.discard', 'Discard')}</span></div>
      </div>
      <div className={'pl ss-btn go' + (dirty === 0 || saving || !canEdit || problems.length > 0 ? ' off' : '')} onClick={onSave}>
        <div className="sk"><Check /><span className="act">{saving ? t('main.saving', 'Saving...') : t('main.save_changes', 'Save changes')}</span></div>
      </div>
    </div>
  );
}

/** A slanted section heading: icon, title, description. */
export function SectionHeading({ icon, label, description, extra, style }: { icon: string; label: string; description?: string; extra?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="pl ss-sh edge" style={style}>
      <div className="sk">
        <Icon name={icon} size="2.6vh" color="var(--a)" />
        <div className="tx">
          <div className="T">{label}</div>
          {description && <div className="D">{description}</div>}
        </div>
        {extra}
      </div>
    </div>
  );
}

