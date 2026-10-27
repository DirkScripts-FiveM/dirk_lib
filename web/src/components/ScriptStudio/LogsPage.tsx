import { QueryClientProvider } from '@tanstack/react-query';
import { facetTotal, formatBytes, useLogFacets, useLogHealth, useLogRows } from './logsData';
import { studioQueryClient } from './studioQuery';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Copy, Database, Inbox, Layers, Loader2, Send, User, XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { type LogLevel, type LogRow } from './mockLogs';
import { HistoryPanel } from './HistoryModal';
import { effectiveValue, setValue, useStudio } from './store';
import { useLoggerSettings } from './loggerSettings';
import { ListRows } from './ListRows';
import { SettingControl } from './Controls';
import type { SettingEntry } from './types';
import { Btn, Chip, Search } from './studioKit';
import { Segs } from '../Kit';
import { resolveIcon } from './Icon';
import { useChrome } from './studioLocale';
import { copyToClipboard, formatNumber } from 'dirk-cfx-react';
import { notify } from './Toasts';
import { KitSelect } from './KitSelect';
import { toneOf } from './tone';
import './kitpages.css';

/**
 * Everything that happened, in one place, drawn in the lib kit (Liam's 25/10
 * mock): five totals on top, the tabs as keys, the scripts on the left with
 * their share, one slanted row per event.
 *
 * Three sources, three tabs, because they answer different questions and have
 * completely different volumes:
 *
 *   Events  - game events emitted through `lib.logger`. Millions of rows, so
 *             this tab never holds more than one page: filters run server-side
 *             against indexed columns and paging is keyset, not offset.
 *   Changes - who edited which setting. Small, and previously a modal; folded
 *             in here so there is one place to look rather than two.
 *   Delivery- where log lines are actually going, and whether they arrived.
 *
 * The panel owns none of the filtering. That is deliberate: a log table is the
 * one thing on a server guaranteed to outgrow anything a client can hold. The
 * totals on top come from the facets and the health the page already asks for
 * - no extra query.
 */

type Tab = 'events' | 'changes' | 'delivery';

const RANGES: { value: string; label: string; key: string; seconds: number | null }[] = [
  { value: '1h', label: 'Last hour', key: 'last_hour', seconds: 3600 },
  { value: '24h', label: 'Last 24 hours', key: 'last_24h', seconds: 86400 },
  { value: '7d', label: 'Last 7 days', key: 'last_7d', seconds: 604800 },
  { value: 'all', label: 'Everything kept', key: 'everything_kept', seconds: null },
];

/** The script's own label and icon when it is one of ours; its resource name otherwise. */
function useScriptLook() {
  const scripts = useStudio((s) => s.scripts);
  return useMemo(() => {
    const byResource = new Map(scripts.map((s) => [s.resource, s]));
    return (resource: string) => {
      const script = byResource.get(resource);
      return {
        label: script?.label ?? resource.replace(/^dirk[_-]/, ''),
        Icon: resolveIcon(script?.icon || 'scroll-text'),
        tone: toneOf(resource),
      };
    };
  }, [scripts]);
}

/**
 * Hold a value still until typing stops.
 *
 * `useDeferredValue` was here, and it is the wrong tool: it keeps the UI
 * responsive while a render is expensive, but it does not reduce how many
 * distinct values come out the other side. Every one of those became a new
 * React Query key, so every keystroke fetched - typing "rainbow" was seven
 * GET_LOGS round trips, each running a LIKE over the whole table.
 */
function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

export function LogsPage({ canEdit }: { canEdit: boolean }) {
  return (
    <QueryClientProvider client={studioQueryClient}>
      <LogsPageInner canEdit={canEdit} />
    </QueryClientProvider>
  );
}

function LogsPageInner({ canEdit }: { canEdit: boolean }) {
  const t = useChrome();
  const [tab, setTab] = useState<Tab>('events');
  const [range, setRange] = useState('24h');
  const { data: health } = useLogHealth();

  const since = useMemo(() => {
    const found = RANGES.find((r) => r.value === range);
    return found?.seconds == null ? null : Math.floor(Date.now() / 1000) - found.seconds;
  }, [range]);
  // the unscoped facets: the totals on top are for every script in the window
  const all = useLogFacets(null, since);

  const total = facetTotal(all.data) ?? 0;
  const level = (name: string) => all.data?.levels.find((l) => l.name === name)?.count ?? 0;
  const routes = health?.routes ?? [];
  const sent = routes.reduce((n, r) => n + (r.sent || 0), 0);
  const dropped = routes.reduce((n, r) => n + (r.dropped || 0), 0);
  const failing = routes.filter((r) => r.enabled && r.dropped > 0).length;
  const rangeLabel = (() => { const r = RANGES.find((x) => x.value === range)!; return t(`logsPage.${r.key}`, r.label); })();

  const stats: { icon: React.ElementType; label: string; value: string; detail: string; tone: string }[] = [
    {
      icon: Layers, label: t('logsPage.events', 'Events'), value: compact(total), tone: 'var(--a)',
      detail: t('logsPage.scripts_logging', '{0} scripts · {1}').replace('{0}', String(all.data?.resources.length ?? 0)).replace('{1}', rangeLabel.toLowerCase()),
    },
    {
      icon: AlertTriangle, label: t('logsPage.warnings', 'Warnings'), value: compact(level('warn')), tone: '#e0a13f',
      detail: t('logsPage.in_window', 'in this window'),
    },
    {
      icon: XCircle, label: t('logsPage.alerts', 'Alerts'), value: compact(level('alert')), tone: '#e5484d',
      detail: t('logsPage.in_window', 'in this window'),
    },
    {
      icon: Database, label: t('logsPage.kept_here', 'Kept here'), tone: '#339af0',
      value: health?.enabled ? compact(health.rows ?? 0) : t('logsPage.off', 'Off'),
      detail: health?.enabled
        ? `${formatBytes(health.bytes ?? 0)} · ${t('logsPage.days', '{0} days').replace('{0}', String(health.retentionDays))}`
        : t('logsPage.not_keeping', 'Not keeping logs on this server'),
    },
    {
      icon: Send, label: t('logsPage.delivery', 'Delivery'), tone: '#a855f7',
      value: routes.length ? `${sent + dropped ? Math.round((sent / (sent + dropped)) * 1000) / 10 : 100}%` : '—',
      detail: routes.length
        ? (failing ? t('logsPage.webhooks_failing', '{0} webhooks · {1} failing').replace('{0}', String(routes.length)).replace('{1}', String(failing))
          : t('logsPage.webhooks', '{0} webhooks').replace('{0}', String(routes.length)))
        : t('logsPage.no_webhooks', 'No webhooks'),
    },
  ];

  return (
    <div className="ss-logs">
      <div className="ss-pstats">
        {stats.map((s, k) => (
          <div key={s.label} className="pl ss-ps edge in" style={{ '--i': k, '--e': s.tone } as CSSProperties}>
            <div className="sk">
              <div className="L" style={{ color: s.tone }}><s.icon className="ico" />{s.label}</div>
              <div className="V">{s.value}</div>
              <div className="D">{s.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="ss-ltabs in" style={{ '--i': 5 } as CSSProperties}>
        <div className="kstrip">
          {([
            ['events', t('logsPage.events', 'Events'), compact(total), false],
            ['changes', t('logsPage.config_changes', 'Config changes'), null, false],
            ['delivery', t('logsPage.delivery', 'Delivery'), failing ? String(failing) : null, failing > 0],
          ] as [Tab, string, string | null, boolean][]).map(([id, label, count, bad]) => (
            <span key={id} className={'pl kp sm' + (tab === id ? ' on' : '')} onClick={() => setTab(id)}>
              <span className="sk">
                <span className="act">{label}</span>
                {count != null && <span className={'cap' + (bad ? ' red' : tab === id ? '' : ' dark')}><b>{count}</b></span>}
              </span>
            </span>
          ))}
        </div>
        <span className="L ss-lnote">
          {tab === 'events' && t('logsPage.paged_on_server', 'Filtered and paged on the server')}
          {tab === 'changes' && t('logsPage.every_edit', 'Every saved edit, and who made it')}
          {tab === 'delivery' && (health?.enabled
            ? t('logsPage.kept_for', 'Kept for {0} days').replace('{0}', String(health.retentionDays))
            : t('logsPage.not_keeping', 'Not keeping logs on this server'))}
        </span>
      </div>

      {tab === 'events' && <EventsTab range={range} setRange={setRange} since={since} total={total} />}
      {tab === 'changes' && <ChangesTab canEdit={canEdit} />}
      {tab === 'delivery' && <DeliveryTab canEdit={canEdit} />}
    </div>
  );
}

// ── Events ──────────────────────────────────────────────────────────────────

function EventsTab({ range, setRange, since, total }: { range: string; setRange: (v: string) => void; since: number | null; total: number }) {
  const t = useChrome();
  const look = useScriptLook();
  // Whether lines are being kept at all - the chip below says so, because an
  // empty Events tab with the sink off looks identical to a quiet server.
  const { data: health } = useLogHealth();
  const sinkOn = !!health?.enabled;

  const [resource, setResource] = useState<string | null>(null);
  const [event, setEvent] = useState<string | null>(null);
  const [level, setLevel] = useState<LogLevel | null>(null);
  const [player, setPlayer] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  // Typing must not fire a request per keystroke; the settled value is what
  // the query key reads, so a burst becomes one fetch.
  const deferredSearch = useDebounced(search);
  const deferredPlayer = useDebounced(player);

  // The real table, not the mock. Both hooks cache hard and neither polls: a
  // log line does not change once written, and a page that refetches on a
  // timer costs something while nobody is looking at it.
  const all = useLogFacets(null, since);
  const facets = useLogFacets(resource, since);

  const logs = useLogRows({
    since, resource, event, level,
    player: deferredPlayer,
    search: deferredSearch,
  });

  const rows = useMemo(() => logs.data?.pages.flatMap((p) => p.rows) ?? [], [logs.data]);
  const typing = search !== deferredSearch || player !== deferredPlayer;

  // Reset the event filter when it cannot apply to the chosen resource.
  useEffect(() => { setEvent(null); }, [resource]);

  // Events come back already scoped to the chosen resource - every script
  // names its own, so an unscoped list is a thousand names nobody can read.
  const eventOptions = useMemo(() => facets.data?.events ?? [], [facets.data]);

  // Infinite scroll: fetch the next page when the sentinel comes into view.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && logs.hasNextPage && !logs.isFetchingNextPage) {
        logs.fetchNextPage();
      }
    }, { rootMargin: '400px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [logs.hasNextPage, logs.isFetchingNextPage, logs.fetchNextPage]);

  const filtered = !!(resource || event || level || player || search);

  return (
    <>
      <div className="ss-ltool in" style={{ '--i': 6 } as CSSProperties}>
        <Search value={search} onChange={setSearch} placeholder={t('logsPage.search_the_message', 'Search the message')} />
        <label className="ss-lf ss-lpl">
          <User />
          <input value={player} onChange={(e) => setPlayer(e.currentTarget.value)} placeholder={t('logsPage.player_name_or_licence', 'Player name or licence')} />
        </label>
        <KitSelect
          value={event} onChange={setEvent} width="22vh" placeholder={t('logsPage.any_event', 'Any event')}
          data={eventOptions.map((e) => ({ value: e.name, label: `${e.name} (${e.count})` }))}
        />
        <KitSelect
          value={level} onChange={(v) => setLevel(v as LogLevel | null)} width="15vh" placeholder={t('logsPage.any_level', 'Any level')}
          data={[
            { value: 'info', label: t('logsPage.info', 'Info') },
            { value: 'warn', label: t('logsPage.warning', 'Warning') },
            { value: 'alert', label: t('logsPage.alert', 'Alert') },
          ]}
        />
        <KitSelect
          value={range} onChange={(v) => setRange(v ?? '24h')} width="18vh" clearable={false}
          data={RANGES.map((r) => ({ value: r.value, label: t(`logsPage.${r.key}`, r.label) }))}
        />
      </div>

      <div className="ss-lbody">
        {/* the scripts that logged in this window - the filter people actually reach for */}
        <div className="ss-lres studio-scroll">
          <div className="L">{t('logsPage.scripts', 'Scripts')}</div>
          <div
            className={'pl ss-lrs in' + (resource === null ? ' on' : '')}
            style={{ '--i': 7, '--s': 'var(--a)' } as CSSProperties}
            onClick={() => setResource(null)}
          >
            <div className="sk">
              <Layers className="ico" />
              <span className="t">{t('logsPage.all_scripts', 'All scripts')}</span>
              <span className="n">{compact(total)}</span>
              <Segs n={12} frac={1} />
            </div>
          </div>
          {(all.data?.resources ?? []).map((entry, k) => {
            const s = look(entry.name);
            return (
              <div
                key={entry.name}
                className={'pl ss-lrs in' + (resource === entry.name ? ' on' : '')}
                style={{ '--i': k + 8, '--s': s.tone } as CSSProperties}
                onClick={() => setResource(entry.name)}
                title={entry.name}
              >
                <div className="sk">
                  <s.Icon className="ico" />
                  <span className="t">{s.label}</span>
                  <span className="n">{compact(entry.count)}</span>
                  <Segs n={12} frac={total ? entry.count / total : 0} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="ss-lfeed studio-scroll" style={{ opacity: typing ? 0.55 : 1 }}>
          {logs.isPending && <Waiting label={t('logsPage.fetching', 'Fetching')} />}

          {!logs.isPending && rows.length === 0 && (
            <div className="ss-empty">
              <Inbox />
              <div className="T">{t('logsPage.nothing_matches_those_filters', 'Nothing matches those filters')}</div>
              <div className="D">{sinkOn
                ? t('logsPage.widen_the_time_range_or_clear_the_resour', 'Widen the time range, or clear the resource filter.')
                : t('logsPage.sink_off_detail', 'The Events tab has nothing to read while this is off.')}</div>
            </div>
          )}

          {rows.map((row) => (
            <LogRowCard
              key={row.id}
              row={row}
              open={expanded === row.id}
              onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
              onPlayer={() => setPlayer(row.player?.identifier ?? '')}
              onResource={() => setResource(row.resource)}
              onEvent={() => { setResource(row.resource); setTimeout(() => setEvent(row.event), 0); }}
            />
          ))}

          <div ref={sentinel} />
          {logs.isFetchingNextPage && <Waiting label={t('logsPage.loading_older', 'Loading older')} />}
          {!logs.hasNextPage && rows.length > 0 && (
            <div className="L ss-lend">{t('logsPage.that_is_everything_in_this_range', 'That is everything in this range.')}</div>
          )}
        </div>
      </div>

      <div className="ss-lfoot">
        <span className="L">
          {t('logsPage.loaded', '{0} loaded').replace('{0}', String(rows.length))}
          {logs.hasNextPage ? ` · ${t('logsPage.scroll_older', 'scroll for older')}` : ''}
          {` · ${t('logsPage.paged_on_server', 'Filtered and paged on the server')}`}
        </span>
        {filtered && (
          <Btn sm label={t('logsPage.clear_filters', 'Clear filters')} onClick={() => { setResource(null); setEvent(null); setLevel(null); setPlayer(''); setSearch(''); }} />
        )}
        {sinkOn
          ? <Chip tone="g">{t('logsPage.kept_for', 'Kept for {0} days').replace('{0}', String(health?.retentionDays ?? ''))}</Chip>
          : <Chip>{t('logsPage.not_keeping_short', 'Not keeping logs')}</Chip>}
      </div>
    </>
  );
}

function LogRowCard({
  row, open, onToggle, onPlayer, onResource, onEvent,
}: {
  row: LogRow;
  open: boolean;
  onToggle: () => void;
  onPlayer: () => void;
  onResource: () => void;
  onEvent: () => void;
}) {
  const t = useChrome();
  const look = useScriptLook()(row.resource);
  const lv = row.level === 'warn' ? ' warn' : row.level === 'alert' ? ' err' : '';

  // Guarded: identifiers are decoded from a TEXT column written by whatever
  // wrote the row. A shape that is not an array of "type:value" strings must
  // degrade, not take the expander down with it.
  const ids = (Array.isArray(row.player?.identifiers) ? row.player!.identifiers! : [])
    .filter((id): id is string => typeof id === 'string');
  const tags = row.tags && typeof row.tags === 'object' && !Array.isArray(row.tags) ? Object.entries(row.tags) : [];

  const copy = () => {
    copyToClipboard(JSON.stringify(row, null, 2));
    notify('success', t('logsPage.copied', 'Copied'));
  };

  return (
    <>
      <div className={'pl ss-lgr' + lv + (open ? ' open' : '')} style={{ '--s': look.tone } as CSSProperties} onClick={onToggle}>
        <div className="sk">
          <span className="tm">{clock(row.at)}</span>
          <span className="rs"><look.Icon className="ico" /><span>{look.label}</span></span>
          <div className="ev">
            <div className="t">
              <span>{row.event}</span>
              {row.level === 'warn' && <Chip tone="w">{t('logsPage.warn', 'Warn')}</Chip>}
              {row.level === 'alert' && <Chip tone="r">{t('logsPage.alert', 'Alert')}</Chip>}
            </div>
            <div className="D">{row.message}</div>
          </div>
          <div className="who">
            {row.player ? row.player.name : t('logsPage.server', 'server')}
            {row.player?.source != null && <small>{`id ${row.player.source}`}</small>}
          </div>
          <ChevronRight className="ico" />
        </div>
      </div>
      {open && (
        <div className="pl ss-lgx">
          <div className="sk">
            <div className="ss-lgk">
              <Kv label={t('logsPage.message', 'Message')} value={row.message} wide />
              {tags.map(([k, v]) => <Kv key={k} label={k} value={String(v)} />)}
              {row.player && <Kv label={t('logsPage.player', 'Player')} value={row.player.name} />}
              {row.player && <Kv label={t('logsPage.identifier', 'Identifier')} value={row.player.identifier} copyable />}
              {row.player?.source != null && <Kv label={t('logsPage.server_id', 'Server id')} value={String(row.player.source)} />}
              {ids.map((id) => {
                const [type, ...rest] = id.split(':');
                return <Kv key={id} label={type} value={rest.join(':')} copyable />;
              })}
              <Kv label={t('logsPage.when', 'When')} value={stamp(row.at)} />
              <Kv label="Id" value={String(row.id)} />
            </div>
            <div className="acts">
              {row.player && <Btn sm icon={<User />} label={t('logsPage.this_player', 'This player')} onClick={onPlayer} />}
              <Btn sm label={t('logsPage.this_resource', 'This resource')} onClick={onResource} />
              <Btn sm label={t('logsPage.this_event', 'This event')} onClick={onEvent} />
              <Btn sm icon={<Copy />} label={t('logsPage.copy', 'Copy')} onClick={copy} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Kv({ label, value, copyable, wide }: { label: string; value: string; copyable?: boolean; wide?: boolean }) {
  return (
    <div
      className={'k' + (wide ? ' wide' : '') + (copyable ? ' cp' : '')}
      title={copyable ? 'Copy' : value}
      onClick={copyable ? (e) => { e.stopPropagation(); copyToClipboard(value); notify('success', 'Copied'); } : undefined}
    >
      <div className="L">{label}</div>
      <div className="v">{value}{copyable && <Copy />}</div>
    </div>
  );
}

// ── Config changes ──────────────────────────────────────────────────────────

function ChangesTab({ canEdit }: { canEdit: boolean }) {
  const scripts = useStudio((s) => s.scripts);
  const activeResource = useStudio((s) => s.activeResource);
  const [resource, setResource] = useState(activeResource);

  const script = scripts.find((s) => s.resource === resource);

  /**
   * Reverting from here stages the change exactly as the modal does, then
   * leaves the Logs page for that script's settings - the edit is staged, not
   * saved, so it has to be somewhere the Save bar is visible or it would look
   * like nothing happened.
   */
  const revert = (changes: { path: string; value: unknown }[]) => {
    if (!script) return;
    for (const change of changes) {
      const entry = script.entries.find((e) => e.path === change.path);
      if (entry) setValue(script.resource, entry, change.value);
    }
    useStudio.setState({ activeResource: script.resource, activePage: null });
  };

  return (
    <div className="ss-lchg">
      <div className="ss-ltool">
        <KitSelect
          value={resource}
          onChange={(v) => setResource(v ?? activeResource)}
          width="34vh"
          clearable={false}
          data={scripts.map((s) => ({ value: s.resource, label: s.label }))}
        />
      </div>
      <HistoryPanel resource={resource} canEdit={canEdit} onRevert={revert} />
    </div>
  );
}

// ── Delivery ────────────────────────────────────────────────────────────────

function DeliveryTab({ canEdit }: { canEdit: boolean }) {
  const t = useChrome();
  const { data: health, isLoading } = useLogHealth();
  const settings = useLoggerSettings();

  const routes = health?.routes ?? [];
  const routeRows = (settings.value(settings.routes) as Record<string, unknown>[]) ?? [];

  // Health is reported per URL by the server and never carries the URL, so it
  // is matched back to its row by position - the same array, same order.
  const healthFor = (i: number) => routes[i];

  return (
    <div className="ss-ldel studio-scroll">
      <DeliveryBlock
        title={t('logsPage.this_server', 'This server')}
        description={t('logsPage.this_server_hint', 'Kept here, and read by the Events tab')}
      >
        <DeliveryRow
          ok={!!health?.enabled}
          title={health?.enabled
            ? t('logsPage.local_sink_on', 'Keeping logs on this server')
            : t('logsPage.local_sink_off', 'Not keeping logs')}
          detail={health?.enabled
            ? `${formatNumber(health.rows ?? 0)} lines · ${formatBytes(health.bytes ?? 0)} · ${t('logsPage.kept_for', 'Kept for {0} days').replace('{0}', String(health.retentionDays))}`
            : t('logsPage.sink_off_detail', 'The Events tab has nothing to read while this is off.')}
          right={isLoading ? '…' : undefined}
        />

        {/* The settings themselves, not a link to them. This is the page
            about where log lines go. */}
        <div className="ss-lset">
          {settings.enabled && (
            <SettingLine entry={settings.enabled} resource={settings.resource} canEdit={canEdit} />
          )}
          {settings.retentionDays && (
            <SettingLine entry={settings.retentionDays} resource={settings.resource} canEdit={canEdit} />
          )}
        </div>
      </DeliveryBlock>

      <DeliveryBlock
        title={t('logsPage.redirects', 'Redirects')}
        description={t('logsPage.redirects_hint', 'Where these lines are sent on to, as well as kept here')}
      >
        {routeRows.map((row, i) => {
          const rh = healthFor(i);
          const filters = [
            Array.isArray(row.resources) && row.resources.length
              ? `${row.resources.length} script${row.resources.length === 1 ? '' : 's'}` : null,
            Array.isArray(row.events) && row.events.length
              ? `${row.events.length} event${row.events.length === 1 ? '' : 's'}` : null,
            Array.isArray(row.levels) && row.levels.length ? row.levels.join(', ') : null,
          ].filter(Boolean).join(' · ');

          return (
            <DeliveryRow
              key={String(row.id ?? i)}
              ok={row.enabled !== false && !(rh && rh.dropped > 0)}
              title={String(row.label || t('logsPage.unnamed_route', 'Unnamed route'))}
              detail={[
                filters || t('logsPage.everything', 'everything'),
                rh ? `${formatNumber(rh.sent)} sent` : null,
                rh?.dropped ? `${formatNumber(rh.dropped)} dropped` : null,
                rh?.queued ? `${rh.queued} waiting` : null,
              ].filter(Boolean).join(' · ')}
              right={row.enabled === false
                ? t('logsPage.off', 'Off')
                : (rh?.lastAt ? ago(rh.lastAt) : t('logsPage.nothing_yet', 'nothing yet'))}
            />
          );
        })}

        {/* The editor itself - adding a webhook happens here, not in a
            settings page two clicks away. */}
        {settings.routes && (
          <ListRows
            entry={settings.routes}
            resource={settings.resource}
            rows={routeRows}
            disabled={!canEdit}
            onChange={(next) => setValue(settings.resource, settings.routes!, next)}
          />
        )}
      </DeliveryBlock>

      <div className="pl ss-lnotice edge">
        <div className="sk">
          <AlertTriangle className="ico" />
          <span className="D">
            {t(
              'logsPage.delivery_note',
              'A webhook is as well as keeping lines here, never instead. Messages are batched, so a busy minute is a few posts rather than hundreds.',
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * One logger setting, drawn where it is relevant rather than in the rail.
 *
 * The SAME entry the settings page would have drawn, through the SAME control
 * - so it is sized, styled and behaves identically, and writes through the
 * store into the save bar, the change count and the history. Hand-rolling a
 * Switch here is what produced two controls that looked nothing like the rest
 * of the panel.
 */
function SettingLine({
  entry, resource, canEdit,
}: { entry: SettingEntry; resource: string; canEdit: boolean }) {
  const value = effectiveValue(resource, entry);

  return (
    <div className="pl ss-lsl">
      <div className="sk">
        <div className="tx">
          <div className="t">{entry.label}</div>
          {entry.help && <div className="D">{entry.help}</div>}
        </div>
        <SettingControl
          type={entry.type}
          entry={entry}
          resource={resource}
          value={value}
          disabled={!canEdit}
          onChange={(next) => setValue(resource, entry, next)}
        />
      </div>
    </div>
  );
}

function DeliveryBlock({
  title, description, children,
}: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="ss-lblk">
      <div className="bh"><span className="L">{title}</span><span className="D">{description}</span></div>
      {children}
    </div>
  );
}

function DeliveryRow({
  ok, title, detail, right,
}: { ok: boolean; title: string; detail: string; right?: string }) {
  return (
    <div className={'pl ss-ldr edge' + (ok ? '' : ' bad')}>
      <div className="sk">
        {ok ? <CheckCircle2 className="ico" /> : <XCircle className="ico" />}
        <div className="tx">
          <div className="t">{title}</div>
          <div className="D">{detail}</div>
        </div>
        {right && <span className="L">{right}</span>}
      </div>
    </div>
  );
}

// ── bits ────────────────────────────────────────────────────────────────────

function Waiting({ label }: { label: string }) {
  return (
    <div className="ss-lwait">
      <Loader2 className="spin" />
      <span className="L">{label}</span>
    </div>
  );
}

function clock(at: number) {
  return new Date(at * 1000).toISOString().slice(11, 19);
}

function stamp(at: number) {
  return new Date(at * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function ago(at: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - at);
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function compact(value: number) {
  return value >= 10000 ? `${Math.round(value / 1000)}k` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}
