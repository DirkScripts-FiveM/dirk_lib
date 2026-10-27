import { copyToClipboard, fetchNui, formatMoney, formatWeight, getItemImageUrl, useItems, type Vehicle } from 'dirk-cfx-react';
import { Box, Car, Check, ChevronLeft, ChevronRight, Copy, Loader2, Package, PackagePlus } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useStudio } from './store';
import { useChrome } from './studioLocale';
import { Btn, hexA } from './studioKit';
import { notify } from './Toasts';
import { toneOf } from './tone';
import './kitpages.css';

/**
 * A browsable reference of what this server actually has: every item the
 * inventory knows, and every vehicle the framework's shared table lists - as
 * kit cards with their picture (Liam's 25/10 mock).
 *
 * Read-only on purpose - it answers "what is this called / does this exist"
 * while you are configuring something else, which is otherwise a trip to a
 * different resource's files. The search is the top bar's.
 *
 * Item art comes from the inventory path dirk_lib already resolves. Vehicle art
 * is not something a framework ships, so it comes from a CDN.
 */
const VEHICLE_IMAGE = 'https://cdn.sky-systems.net/vehicles/%s.png';

// the browser preview has a few vehicles, so the page can be designed
const PREVIEW_VEHICLES: Vehicle[] = [
  ['adder', 'Adder', 'Truffade', 'super', 1000000], ['zentorno', 'Zentorno', 'Pegassi', 'super', 725000],
  ['t20', 'T20', 'Progen', 'super', 2200000], ['elegy', 'Elegy Retro Custom', 'Annis', 'sports', 904000],
  ['comet2', 'Comet', 'Pfister', 'sports', 100000], ['sultan', 'Sultan', 'Karin', 'sports', 12000],
  ['buffalo', 'Buffalo', 'Bravado', 'sports', 35000], ['kuruma', 'Kuruma', 'Karin', 'sports', 95000],
  ['dominator', 'Dominator', 'Vapid', 'muscle', 35000], ['gauntlet', 'Gauntlet', 'Bravado', 'muscle', 32000],
  ['baller', 'Baller', 'Gallivanter', 'suvs', 90000], ['granger', 'Granger', 'Declasse', 'suvs', 35000],
  ['sanchez', 'Sanchez', 'Maibatsu', 'motorcycles', 8000], ['bati', 'Bati 801', 'Pegassi', 'motorcycles', 15000],
  ['police', 'Police Cruiser', 'Vapid', 'emergency', 0], ['mule', 'Mule', 'Maibatsu', 'commercial', 22000],
].map(([model, name, brand, category, price]) => ({ model, name, brand, category, price } as Vehicle));
const PER_PAGE = 24;

type Kind = 'items' | 'vehicles';

/** Server refusal codes, in words. */
const FAILURES: Record<string, string> = {
  NoPermission: 'You do not have permission',
  BadModel: 'That spawn name is not valid',
  SpawnFailed: 'The server could not create it',
  NoPed: 'You need to be in the world',
  NoReply: 'No response from the server',
};

type Card = {
  id: string;
  label: string;
  image?: string;
  /** the class for a vehicle; colours the card */
  group?: string;
  /** price or weight, top right */
  figure?: string;
  /** brand, or the item's description */
  sub?: string;
  /** for sorting by the figure as a number */
  amount: number;
};

type Sort = 'name' | 'figure';

export function CataloguePage({ kind, query }: { kind: Kind; query: string }) {
  const t = useChrome();
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('name');
  const [page, setPage] = useState(0);

  const items = useItems();

  // Fetched here rather than through cfx-react's `ensureVehicles`, which guards
  // itself with a module-level "already requested" flag: one early call that
  // came back empty is cached for the life of the page, and nothing retries.
  // The Lua returns 901 vehicles on this server either way, so a page that
  // showed none was reading that stale cache.
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);

  useEffect(() => {
    if (kind !== 'vehicles') return;
    let live = true;
    setLoadingVehicles(true);
    fetchNui<Vehicle[]>('GET_VEHICLES', undefined, PREVIEW_VEHICLES)
      .then((data) => { if (live) setVehicles(Array.isArray(data) ? data : []); })
      .catch(() => { if (live) setVehicles([]); })
      .finally(() => { if (live) setLoadingVehicles(false); });
    return () => { live = false; };
  }, [kind]);

  const needle = query.trim().toLowerCase();

  // the class keys count what the search leaves, so a key never promises cars it will not show
  const searched = useMemo(() => vehicles.filter((vehicle) => !needle
    || vehicle.model.toLowerCase().includes(needle)
    || (vehicle.name ?? '').toLowerCase().includes(needle)
    || (vehicle.brand ?? '').toLowerCase().includes(needle)), [vehicles, needle]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const vehicle of searched) if (vehicle.category) counts.set(vehicle.category, (counts.get(vehicle.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [searched]);

  const cards: Card[] = useMemo(() => {
    if (kind === 'items') {
      return Object.values(items)
        .filter((item) => !needle
          || item.name.toLowerCase().includes(needle)
          || (item.label ?? '').toLowerCase().includes(needle))
        .map((item) => ({
          id: item.name,
          label: item.label || item.name,
          image: getItemImageUrl(item.name),
          figure: item.weight > 0 ? formatWeight(item.weight) : undefined,
          sub: item.description,
          amount: item.weight || 0,
        }));
    }
    return searched
      .filter((vehicle) => !category || vehicle.category === category)
      .map((vehicle) => ({
        id: vehicle.model,
        label: vehicle.name || vehicle.model,
        image: VEHICLE_IMAGE.replace('%s', vehicle.model),
        group: vehicle.category,
        figure: vehicle.price !== undefined ? formatMoney(vehicle.price, { decimals: 3 }) : undefined,
        sub: vehicle.brand,
        amount: vehicle.price ?? 0,
      }));
  }, [kind, items, searched, needle, category]);

  const sorted = useMemo(() => [...cards].sort((a, b) => (sort === 'figure'
    ? b.amount - a.amount || a.label.localeCompare(b.label)
    : a.label.localeCompare(b.label))), [cards, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const shown = sorted.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  useEffect(() => { setPage(0); }, [kind, needle, category, sort]);

  const loading = kind === 'vehicles' && loadingVehicles;
  const Icon = kind === 'items' ? Package : Car;

  return (
    <div className="ss-cat">
      <div className="ss-ctop in">
        <Icon className="ico" />
        <span className="T">{kind === 'items' ? t('cataloguePage.items', 'Items') : t('cataloguePage.vehicles', 'Vehicles')}</span>
        <span className="D">
          {kind === 'items'
            ? t('cataloguePage.items_hint', 'Everything your inventory knows about')
            : t('cataloguePage.vehicles_hint', "Every vehicle in your framework's shared table")}
        </span>
        <div className="kstrip">
          {(['name', 'figure'] as Sort[]).map((id) => (
            <span key={id} className={'pl kp sm' + (sort === id ? ' on' : '')} onClick={() => setSort(id)}>
              <span className="sk"><span className="act">
                {id === 'name' ? t('cataloguePage.a_z', 'A–Z')
                  : kind === 'items' ? t('cataloguePage.heaviest', 'Heaviest') : t('cataloguePage.priciest', 'Priciest')}
              </span></span>
            </span>
          ))}
        </div>
      </div>

      {kind === 'vehicles' && categories.length > 0 && (
        <div className="ss-ckeys in" style={{ '--i': 1 } as CSSProperties}>
          <div className="kstrip">
            <span className={'pl kp sm' + (category === null ? ' on' : '')} onClick={() => setCategory(null)}>
              <span className="sk">
                <span className="act">{t('cataloguePage.all_classes', 'All classes')}</span>
                <span className={'cap sm' + (category === null ? '' : ' dark')}><b>{searched.length}</b></span>
              </span>
            </span>
            {categories.map(([name, count]) => (
              <span
                key={name}
                className={'pl kp sm' + (category === name ? ' on' : '')}
                style={{ '--r': toneOf(name) } as CSSProperties}
                onClick={() => setCategory(category === name ? null : name)}
              >
                <span className="sk">
                  <i className="dt" />
                  <span className="act">{name}</span>
                  <span className={'cap sm' + (category === name ? '' : ' dark')}><b>{count}</b></span>
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="ss-cscroll studio-scroll">
        {loading && (
          <div className="ss-lwait"><Loader2 className="spin" /><span className="L">{t('cataloguePage.reading', 'Reading the vehicle table')}</span></div>
        )}
        {!loading && cards.length === 0 && (
          <div className="ss-empty">
            {kind === 'items' ? <Package /> : <Car />}
            <div className="T">{needle || category ? t('cataloguePage.no_match', 'Nothing matches that') : kind === 'items' ? t('cataloguePage.no_items', 'No items found') : t('cataloguePage.no_vehicles', 'No vehicles found')}</div>
            {kind === 'vehicles' && !needle && !category && (
              <div className="D">{t('cataloguePage.esx_note', 'The shared-vehicle table comes from qb-core / qbx_core. ESX has no categorised equivalent, so this list is empty there until we add another source.')}</div>
            )}
          </div>
        )}
        <div className="ss-vgrid">
          {shown.map((card, i) => <CatalogueCard key={card.id} card={card} kind={kind} i={i} />)}
        </div>
      </div>

      <div className="ss-lfoot">
        <span className="L">
          {sorted.length
            ? t('cataloguePage.range', '{0}–{1} of {2}')
              .replace('{0}', String(page * PER_PAGE + 1))
              .replace('{1}', String(Math.min((page + 1) * PER_PAGE, sorted.length)))
              .replace('{2}', String(sorted.length))
            : ''}
          {` · ${t('cataloguePage.copy_hint', 'Click a spawn name to copy it')}`}
        </span>
        {pages > 1 && (
          <>
            <Btn sm icon={<ChevronLeft />} label={t('cataloguePage.prev', 'Prev')} onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} />
            <Btn sm icon={<ChevronRight />} label={t('cataloguePage.next', 'Next')} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} />
          </>
        )}
      </div>
    </div>
  );
}

function CatalogueCard({ card, kind, i }: { card: Card; kind: Kind; i: number }) {
  const t = useChrome();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const tone = card.group ? toneOf(card.group) : 'var(--a)';
  const style = {
    '--i': i,
    '--r': tone,
    '--r30': card.group ? hexA(tone, 0.3) : 'var(--a30)',
  } as CSSProperties;

  const copy = () => {
    copyToClipboard(card.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 900);
  };

  // Both actions are decided on the SERVER - the item grant and the vehicle
  // spawn each check the same permission that gates editing a config, and the
  // vehicle is created server-side. Pressing this without it does nothing but
  // say so: a silent button would leave you unable to tell "denied" from
  // "nothing happened".
  const run = async () => {
    if (busy) return;
    setBusy(true);
    const reply = await fetchNui<{ success?: boolean; _error?: string }>(
      kind === 'items' ? 'GIVE_SCRIPT_CONFIG_ITEM' : 'SPAWN_VEHICLE',
      kind === 'items' ? { itemName: card.id, itemAmount: 1 } : { model: card.id },
      { success: false, _error: 'NoReply' },
    ).catch(() => ({ success: false, _error: 'NoReply' }));
    setBusy(false);
    if (!reply?.success) {
      notify('error', FAILURES[reply?._error ?? ''] ?? t('cataloguePage.could_not', 'Could not do that'));
      return;
    }
    notify('success', kind === 'items' ? t('cataloguePage.in_inventory', 'In your inventory') : t('cataloguePage.spawned', 'Spawned'));
    // A spawned vehicle is behind the panel. Closing is the whole point of
    // pressing the button - you asked for it so you could look at it, and an
    // item lands in an inventory you can check later, but a car does not.
    if (kind !== 'items') {
      useStudio.setState({ open: false, searches: {} });
      fetchNui('CLOSE_SCRIPT_STUDIO');
    }
  };

  return (
    <div className="ss-vc in" style={style}>
      <div className="sk">
        <div className="art"><Art src={card.image} kind={kind} /></div>
        <div className="bd">
          <div className="hd">
            {card.group ? <span className="chip c" style={{ '--c': tone } as CSSProperties}><b>{card.group}</b></span> : <span />}
            {card.figure && <span className="vp">{card.figure}</span>}
          </div>
          <div className="t" title={card.label}>{card.label}</div>
          {card.sub && <div className="br" title={card.sub}>{card.sub}</div>}
          <div className="ft">
            <span className={'sn' + (copied ? ' done' : '')} onClick={copy} title={t('cataloguePage.copy_spawn', 'Copy the spawn name')}>
              <code>{copied ? t('cataloguePage.copied', 'copied') : card.id}</code>
              {copied ? <Check /> : <Copy />}
            </span>
            <span
              className={'go' + (busy ? ' busy' : '')}
              onClick={run}
              title={kind === 'items' ? t('cataloguePage.give_one', 'Give me one') : t('cataloguePage.spawn_it', 'Spawn it')}
            >
              {busy ? <Loader2 className="spin" /> : kind === 'items' ? <PackagePlus /> : <Car />}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Art({ src, kind }: { src?: string; kind: Kind }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);

  if (!src || failed) {
    const Icon = kind === 'items' ? Box : Car;
    return <Icon className="none" />;
  }
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
