import {
  Ambulance, Bell, Box, Check, Clock, FolderOpen, Fuel, Gauge, Hand, House,
  KeyRound, Layers, Loader2, Lock, MessageSquare, Package, Phone, Plug, Radio, RefreshCw,
  Server, Shirt, Siren, SquarePen, Target, TrendingUp, TriangleAlert, Warehouse, X,
} from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { useBridgeRows, useBridgeState, type BridgeRow, type BridgeState } from './bridgeState';
import { setValue } from './store';
import type { SettingEntry } from './types';
import { useChrome } from './studioLocale';
import { Segs } from '../Kit';
import { KitSelect } from './KitSelect';
import { Btn } from './studioKit';
import './kitpages.css';

/**
 * What dirk_lib connected to, and whether it took.
 *
 * Its own page rather than a block inside Shared Settings: bridging is about
 * this server's environment, not a script's configuration, and it is the first
 * place to look when something misbehaves. So the answer comes first (how many
 * work, how many to look at), then one kit card per bridge - and a card that
 * found nothing is red and glows, the first thing you see (Liam's 25/10 mock).
 */
export function BridgesPage() {
  const t = useChrome();
  const rows = useBridgeRows();
  const { state, loading, again } = useBridgeState(rows.names);

  const dependencies = useMemo((): BridgeRow[] => {
    if (!state) return [];

    // Whatever dirk_lib's own manifest requires, reported back. Naming
    // oxmysql here would be a second copy of the dependency block, and this
    // page existed for a week saying "not running" about it purely because it
    // was not one of the resources the dropdowns ask about.
    const required: BridgeRow[] = Object.entries(state.resources)
      .filter(([, info]) => info.required)
      .map(([name, info]) => ({
        key: name, label: t('bridge.required', 'Required'), icon: 'box',
        value: name, readOnly: true,
        fixed: {
          ok: info.running,
          resolved: name,
          version: info.version,
          note: info.running
            ? t('bridge.running', 'Running')
            : t('bridge.notRunning', 'Not running — dirk_lib cannot start without it'),
        },
      }));

    if (state.server.minimum) {
      required.push({
        key: 'server', label: t('bridge.serverBuild', 'Server build'), icon: 'box',
        value: `/server:${state.server.minimum}`, readOnly: true,
        fixed: {
          ok: state.server.ok,
          resolved: state.server.artifact ? `build ${state.server.artifact}` : t('bridge.unknownBuild', 'unknown'),
          note: state.server.ok
            ? `${t('bridge.meetsMinimum', 'Meets the minimum')} (${state.server.minimum})`
            : `${t('bridge.belowMinimum', 'Below the minimum')} (${state.server.minimum})`,
        },
      });
    }

    if (state.onesync.required) {
      required.push({
        key: 'onesync', label: 'OneSync', icon: 'box', value: '/onesync', readOnly: true,
        fixed: {
          ok: state.onesync.ok,
          resolved: state.onesync.mode || 'off',
          note: state.onesync.ok ? t('bridge.enabled', 'Enabled') : t('bridge.disabled', 'Disabled'),
        },
      });
    }

    return required;
  }, [state, t]);

  /** One card's worth of row, built from the setting it edits. */
  const toRow = (entry: SettingEntry): BridgeRow => {
    const key = entry.path.slice('bridging.'.length);
    return {
      key,
      label: entry.label,
      icon: key.toLowerCase(),
      value: rows.value(entry),
      options: entry.options?.map((option) => String(option.value)),
      detected: state?.detected?.[key],
      // itemImgPath is a FOLDER, not a resource - it takes typed text
      kind: entry.type === 'string' && !entry.options?.length ? 'path' : 'resource',
      entry,
    };
  };


  if (loading && !state) {
    return (
      <div className="ss-br"><div className="ss-lwait" style={{ flex: 1 }}><Loader2 className="spin" /></div></div>
    );
  }

  // Reporting "nothing installed" because the question failed would be a lie
  // about the server, on the one page people open to find out about it.
  if (!state) {
    return (
      <div className="ss-br">
        <div className="ss-empty">
          <TriangleAlert style={{ color: '#e5484d' }} />
          <div className="T">{t('bridgesPage.failed', 'Could not read this server')}</div>
          <div className="D">{t('bridgesPage.failedHint', 'dirk_lib did not answer — nothing here would be true')}</div>
          <Btn sm icon={<RefreshCw />} label={t('bridgesPage.try_again', 'Try again')} onClick={again} />
        </div>
      </div>
    );
  }

  const groups = [
    { id: 'deps', icon: Box, title: t('bridgesPage.dependencies', 'Dependencies'), description: t('bridgesPage.dependenciesHint', 'dirk_lib will not start without these'), rows: dependencies },
    { id: 'ui', icon: Layers, title: t('bridgesPage.interface', 'Interface'), description: t('bridgesPage.interfaceHint', 'Who draws notifications, progress bars and prompts'), rows: rows.interface.map(toRow) },
    { id: 'br', icon: Plug, title: t('bridgesPage.bridges', 'Bridges'), description: t('bridgesPage.bridgesHint', 'What dirk_lib detected, and whether it took'), rows: rows.bridges.map(toRow) },
  ];

  // the answer first: every card's verdict, counted
  const verdicts = groups.flatMap((g) => g.rows.map((row) => ({ row, v: verdictFor(row, row.value, state, t) })));
  const bad = verdicts.filter((x) => x.v.tone === 'bad');
  const working = verdicts.length - bad.length;
  const framework = state.detected.framework;
  const frameworkVersion = framework ? state.resources[framework]?.version : undefined;

  let k = 0;
  return (
    <div className="ss-br">
      <div className="ss-pstats">
        <div className="pl ss-ps edge in" style={{ '--i': k++ } as CSSProperties}>
          <div className="sk">
            <div className="L" style={{ color: 'var(--a)' }}><Check className="ico" />{t('bridgesPage.working', 'Working')}</div>
            <div className="V">{working}<small>{` / ${verdicts.length}`}</small></div>
            <Segs n={Math.max(verdicts.length, 1)} frac={verdicts.length ? working / verdicts.length : 1} />
          </div>
        </div>
        <div className={'pl ss-ps edge in' + (bad.length ? ' bad' : '')} style={{ '--i': k++, '--e': bad.length ? 'var(--red)' : 'var(--a)' } as CSSProperties}>
          <div className="sk">
            <div className="L"><TriangleAlert className="ico" />{t('bridgesPage.to_look_at', 'To look at')}</div>
            <div className="V">{bad.length}</div>
            <div className="D">{bad.length ? bad.map((x) => x.row.label).join(', ') : t('bridgesPage.all_good', 'Everything found what it needs')}</div>
          </div>
        </div>
        <div className="pl ss-ps edge in" style={{ '--i': k++, '--e': '#339af0' } as CSSProperties}>
          <div className="sk">
            <div className="L" style={{ color: '#339af0' }}><Plug className="ico" />{t('bridgesPage.framework', 'Framework')}</div>
            <div className="V">{framework ?? '—'}</div>
            <div className="D">{frameworkVersion ? `v${frameworkVersion}` : t('bridge.autoDetected', 'Auto detected')}</div>
          </div>
        </div>
        <div className="pl ss-ps edge in" style={{ '--i': k++, '--e': state.server.ok ? '#a855f7' : 'var(--red)' } as CSSProperties}>
          <div className="sk">
            <div className="L" style={{ color: '#a855f7' }}><Server className="ico" />{t('bridge.serverBuild', 'Server build')}</div>
            <div className="V">{state.server.artifact ?? '—'}</div>
            <div className="D">
              {[
                state.server.gameBuild ? `${t('bridgesPage.game_build', 'Game build')} ${state.server.gameBuild}` : null,
                `OneSync ${state.onesync.mode || 'off'}`,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
      </div>

      <div className="ss-bscroll studio-scroll">
        {groups.map((g) => (
          <div key={g.id} className="ss-bsec">
            <div className="bh">
              <g.icon className="ico" />
              <span className="L">{g.title}</span>
              <span className="D">{g.description}</span>
              {g.id === 'br' && (
                <span className="more" onClick={again}>
                  <RefreshCw className={loading ? 'spin' : undefined} />{t('bridgesPage.check_again', 'Check again')}
                </span>
              )}
            </div>
            <div className={'ss-bgrid ' + g.id}>
              {g.rows.map((row) => (
                <BridgeCard key={row.key} row={row} resource={rows.resource} state={state} i={k++} sm={g.id === 'ui'} />
              ))}
            </div>
          </div>
        ))}

        <div className="L ss-bfoot">
          {t('bridgesPage.footer', 'Every bridge dirk_lib knows about is on this page — the rows are its own settings, so it cannot fall behind the schema. Changes save with the bar below.')}
        </div>
      </div>
    </div>
  );
}

const ICONS: Record<string, React.ElementType> = {
  box: Box, bell: Bell, gauge: Gauge, message: MessageSquare, layers: Layers,
  plug: Plug, package: Package, target: Target, siren: Siren, key: KeyRound,
  fuel: Fuel, shirt: Shirt, radio: Radio,
  image: FolderOpen, hand: Hand, clock: Clock, phone: Phone, garage: Warehouse,
  ambulance: Ambulance, prison: Lock, lock: Lock, skills: TrendingUp,
  housing: House, alert: TriangleAlert, input: SquarePen,
};

type Translate = (key: string, fallback: string) => string;

type Verdict = {
  tone: 'ok' | 'bad';
  resolved: string;
  version?: string;
  note: string;
};

/**
 * What a given selection actually resolves to on this server.
 *
 * Takes the translator rather than calling one: this is a plain function, not a
 * component, so there is no hook to call here.
 */
function verdictFor(row: BridgeRow, value: string, state: BridgeState, t: Translate): Verdict {
  // server build / OneSync are not resources, so they carry their own verdict
  if (row.fixed) {
    return {
      tone: row.fixed.ok ? 'ok' : 'bad',
      resolved: row.fixed.resolved,
      version: row.fixed.version,
      note: row.fixed.note,
    };
  }

  // A FOLDER, not a resource. `auto` follows whatever inventory was detected,
  // and asking "is that path running" has no meaning - the old check reported
  // a red cross on a perfectly good image path.
  if (row.kind === 'path') {
    const resolved = value && value !== 'auto' ? value : state.detected.itemImgPath;
    if (!resolved) {
      return {
        tone: 'bad',
        resolved: t('bridge.noPath', 'no path'),
        note: t('bridge.noPathHint', 'No inventory detected, so there is nothing to follow'),
      };
    }
    return {
      tone: 'ok',
      resolved,
      note: value === 'auto'
        ? t('bridge.followsInventory', 'Follows the detected inventory')
        : t('bridge.pathSet', 'Set by hand'),
    };
  }

  if (value === 'auto') {
    const found = row.detected;
    if (!found) {
      return {
        tone: 'bad',
        resolved: t('bridge.nothingFound', 'nothing found'),
        note: t('bridge.autoFoundNothing', 'Auto detect found no supported resource'),
      };
    }
    return {
      tone: 'ok',
      resolved: found,
      version: state.resources[found]?.version,
      note: t('bridge.autoDetected', 'Auto detected'),
    };
  }

  const found = state.resources[value];
  if (!found?.running) {
    return { tone: 'bad', resolved: value, note: t('bridge.forcedNotRunning', 'Forced, but not running on this server') };
  }
  return { tone: 'ok', resolved: value, version: found.version, note: t('bridge.forcedRunning', 'Forced, and running') };
}

function BridgeCard({
  row, resource, state, i, sm,
}: { row: BridgeRow; resource: string; state: BridgeState; i: number; sm?: boolean }) {
  const t = useChrome();
  const RowIcon = ICONS[row.icon] ?? Plug;

  const [checking, setChecking] = useState(false);
  // The staged value, not a local copy of it. This card kept its own useState
  // and never wrote anywhere: picking a different inventory moved the dropdown
  // and changed precisely nothing, which on a page about what is connected is
  // worse than not offering the choice.
  const value = row.value;
  const verdict = verdictFor(row, value, state, t);
  const bad = verdict.tone === 'bad';

  // Switching re-checks the resource, so picking something that is not
  // installed tells you straight away instead of at the next restart.
  const change = (next: string | null) => {
    if (!next || !row.entry) return;
    setValue(resource, row.entry, next);
    setChecking(true);
    setTimeout(() => setChecking(false), 320);
  };

  return (
    <div className={'pl ss-bc edge in' + (bad ? ' bad' : '') + (sm ? ' sm' : '')} style={{ '--i': i } as CSSProperties}>
      <div className="sk">
        <div className="hd">
          <RowIcon className="ico" />
          <span className="L">{row.label}</span>
          <span className="ok">{checking ? <Loader2 className="spin" /> : bad ? <X /> : <Check />}</span>
        </div>
        <div className="nm">
          <span className="t">{verdict.resolved}</span>
          {verdict.version && <span className="vv">v{verdict.version}</span>}
        </div>
        {row.kind === 'path' ? (
          // a folder, not a resource: 'auto' follows the detected inventory,
          // anything else is a literal path the UIs load images from
          <label className="ss-lf ss-bin">
            <FolderOpen />
            <input
              value={value}
              onChange={(e) => row.entry && setValue(resource, row.entry, e.currentTarget.value)}
              placeholder={t('bridgesPage.auto', 'auto')}
            />
          </label>
        ) : row.readOnly ? (
          <div className="ss-bro">{value}</div>
        ) : (
          <KitSelect
            data={(row.options ?? [value]).map((o) => ({ value: o, label: o }))}
            value={value}
            onChange={change}
            clearable={false}
            mono
            invalid={bad}
          />
        )}
        <div className="D">{checking ? t('bridgesPage.checking', 'Checking...') : verdict.note}</div>
      </div>
    </div>
  );
}
