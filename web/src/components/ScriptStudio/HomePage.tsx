import { useEffect, useMemo, useRef, useState, type CSSProperties, type ElementType } from 'react';
import {
  AlertTriangle, Check, ChevronRight, History, Lightbulb, Megaphone, RefreshCw, Tag,
} from 'lucide-react';
import { useStudio } from './store';
import { useChrome } from './studioLocale';
import { useScriptStats } from './stats';
import { imageUrl, openUrl, useShopWindow, type ShelfItem, type ShopWindow } from './shopWindow';
import type { DispatchEntry } from './Dispatch';
import './home.css';

/**
 * Where `/dirk_config` lands: the DirkScripts shop window.
 *
 * Built like lsx_lib's front door - a rotating two-tone hero, then what is
 * in the store, then the news and what is coming - with this server's own
 * numbers beside the hero, because the one thing a shop window here must
 * never hide is "something on your server needs a look".
 *
 * Everything on it comes from dirk_publicInfo (see shopWindow.ts), so a
 * release or a sale reaches every server without a dirk_lib update.
 *
 * `/dirk_fishing` still opens fishing directly - someone naming a script has
 * already chosen.
 */
export function HomePage({ onOpenPicker }: { onOpenPicker?: () => void }) {
  const t = useChrome();
  const shop = useShopWindow();
  const scripts = useStudio((s) => s.scripts);
  const changelogs = useStudio((s) => s.changelogs);
  const stats = useScriptStats();

  const configurable = scripts.filter((s) => !s.shared);
  const totals = useMemo(() => {
    let changed = 0, problems = 0;
    const updates: string[] = [];
    let firstProblem: string | undefined;
    for (const s of scripts) {
      const st = stats.get(s.resource);
      if (!st) continue;
      changed += st.changed;
      problems += st.problems;
      if (st.problems && !firstProblem) firstProblem = s.resource;
      if (st.update) updates.push(`${s.label} ${st.update}`);
    }
    return { changed, problems, updates, firstProblem };
  }, [scripts, stats]);

  const openScript = (resource: string, page: string | null = null) =>
    useStudio.setState({ activeResource: resource, activePage: page });
  const openChangelog = (resource: string) =>
    openScript(resource, changelogs.includes(resource) ? 'changelog' : null);

  // the shelf is a shop window: what you do not own first, four at most
  const shelf = useMemo(() => {
    const out = shop.shelf.filter((p) => !p.owned);
    for (const p of shop.shelf) if (out.length < 4 && p.owned) out.push(p);
    return out.slice(0, 4);
  }, [shop.shelf]);

  return (
    <div className="ss-home">
      <div className="shop">
        <Hero shop={shop} onScript={openScript} onChangelog={openChangelog} />

        <div className="srv">
          <div className="sec rise" style={{ '--i': 2 } as CSSProperties}>
            <span className="L">{t('home.server', 'On this server')}</span>
            <Two solid={t('home.yourScripts.solid', 'Your')} outline={t('home.yourScripts.outline', 'scripts')} sm />
          </div>
          <Stat i={3} value={configurable.length} label={t('home.stat.scripts', 'Scripts')} help={t('home.stat.scriptsHelp', 'open any of them')} icon={ChevronRight} onClick={onOpenPicker} />
          <Stat i={4} value={totals.changed} label={t('home.stat.changed', 'Changed')} help={t('home.stat.changedHelp', 'from the defaults')} icon={History} edge="rgba(255,255,255,.35)" />
          <Stat
            i={5} value={totals.problems} tone={totals.problems ? 'w' : undefined}
            label={t('home.stat.problems', 'Needs a look')}
            help={totals.problems ? t('home.stat.problemsHelp', 'values that will not save') : t('home.stat.problemsNone', 'nothing to fix')}
            icon={AlertTriangle} edge="var(--warn)"
            onClick={totals.firstProblem ? () => openScript(totals.firstProblem!) : undefined}
          />
          <Stat
            i={6} value={totals.updates.length} tone={totals.updates.length ? 'a' : undefined}
            label={t('home.stat.updates', 'Updates ready')}
            help={totals.updates.length ? totals.updates.join(' · ') : t('home.stat.updatesNone', 'everything is current')}
            icon={RefreshCw} edge="var(--a)"
          />
        </div>
      </div>

      <div className="sec row rise" style={{ '--i': 5 } as CSSProperties}>
        <span className="L">{t('home.store', 'In the store')}</span>
        {shop.sale
          ? <Two solid={t('home.sale.solid', 'On')} outline={t('home.sale.outline', 'sale')} sm />
          : <Two solid={t('home.shelf.solid', 'The')} outline={t('home.shelf.outline', 'shelf')} sm />}
        <span className="sp" />
        {shop.sale && (
          <>
            <span className="L">{t('home.sale.ends', '{0}% off · ends in').replace('{0}', String(shop.sale.pct))}</span>
            <Countdown to={shop.sale.endsAt} />
          </>
        )}
        <span className="more" onClick={() => openUrl(shop.url)}>{shop.url.replace(/^https:\/\//, '')} ↗</span>
      </div>

      <div className="prods">
        {shelf.map((p, k) => (
          <Product key={p.id} p={p} i={k + 6} sale={shop.sale?.pct}
            onClick={() => (p.owned ? openScript(p.owned) : openUrl(p.url ?? shop.url))} />
        ))}
      </div>

      <div className={'low2' + (shop.news.length ? '' : ' nonews')}>
        {shop.news.length > 0 && (
          <div className="box">
            <div className="sec rise" style={{ '--i': 12 } as CSSProperties}>
              <span className="L">{t('home.news', 'From DirkScripts')}</span>
              <Two solid={t('home.news.solid', 'Latest')} outline={t('home.news.outline', 'updates')} sm />
            </div>
            <div className="newsrow">
              {shop.news.slice(0, 3).map((entry, k) => (
                <News key={entry.id} entry={entry} i={k + 13}
                  onClick={() => {
                    if (entry.action?.changelog) openChangelog(entry.action.changelog);
                    else openUrl(entry.action?.url);
                  }} />
              ))}
            </div>
          </div>
        )}
        {shop.soon.length > 0 && (
          <div className="box">
            <div className="sec rise" style={{ '--i': 12 } as CSSProperties}>
              <span className="L">{t('home.soon', 'On the bench')}</span>
              <Two solid={t('home.soon.solid', 'Coming')} outline={t('home.soon.outline', 'soon')} sm />
            </div>
            <div className="soonrow">
              {shop.soon.slice(0, shop.news.length ? 2 : 4).map((p, k) => (
                <div key={p.id} className="pt soon rise" style={{ '--i': k + 15 } as CSSProperties} onClick={() => openUrl(p.url ?? shop.discord)}>
                  <div className="sk">
                    <div className="pic">
                      {imageUrl(p.image) && <Img className="bg" src={imageUrl(p.image)!} />}
                      {imageUrl(p.image) && <Img className="full" src={imageUrl(p.image)!} />}
                      <span className="chip"><b>{t('home.soonChip', 'Soon')}</b></span>
                    </div>
                    <div className="mt">
                      <div className="t">{p.title}</div>
                      <div className="ft">
                        <span className="sub">{t('home.soonWhere', 'On Discord first')}</span>
                        <span className="nt"><Megaphone />{t('home.notify', 'Notify me')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── the hero ────────────────────────────────────────────────────────────────

const SLIDE_MS = 6000;

function Hero({ shop, onScript, onChangelog }: {
  shop: ShopWindow;
  onScript: (resource: string) => void;
  onChangelog: (resource: string) => void;
}) {
  const t = useChrome();
  const slides = shop.slides;
  const [at, setAt] = useState(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (slides.length < 2) return;
    const id = window.setTimeout(() => setAt((k) => (k + 1) % slides.length), SLIDE_MS);
    return () => clearTimeout(id);
  }, [at, cycle, slides.length]);

  if (slides.length === 0) return <div className="hero" />;
  const on = Math.min(at, slides.length - 1);

  type Act = NonNullable<ShopWindow['slides'][number]['go']>;
  const run = (act: Act, owned?: string) => {
    if (act.open === 'script' && owned) onScript(owned);
    else if (act.open === 'changelog' && owned) onChangelog(owned);
    else openUrl(act.url ?? shop.url);
  };
  // a button that opens a script nobody here owns has nowhere to go
  const usable = (act: Act | undefined, owned?: string): act is Act =>
    !!act && (!act.open || !!owned);

  return (
    <div className="hero rise" style={{ '--i': 1 } as CSSProperties}>
      {slides.map((s, k) => (
        <div key={k} className={'slide' + (k === on ? ' on' : '')}>
          <div className="art">{s.picture && <Img src={s.picture} />}</div>
          <div className="shade" />
          <div className="cp">
            <div className="kick">
              {s.kicker}
              {s.clock && shop.sale && <Countdown to={shop.sale.endsAt} />}
            </div>
            <div className="two stack"><span>{s.solid}</span>{s.outline && <span className="o">{s.outline}</span>}</div>
            {s.body && <div className="D">{s.body}</div>}
            <div className="row">
              {(s.tags ?? []).map((tag) => <span key={tag.label} className={'chip ' + (tag.tone ?? '')}><b>{tag.label}</b></span>)}
              {s.owned && <span className="chip g"><b>{t('home.owned', 'You own this')}</b></span>}
              <span style={{ width: '.6vh' }} />
              {usable(s.go, s.owned) && (
                <div className="pl ss-btn go" onClick={() => run(s.go!, s.owned)}>
                  <div className="sk"><span className="act">{s.go.label}</span><ChevronRight /></div>
                </div>
              )}
              {usable(s.alt, s.owned) && (
                <div className="pl ss-btn" onClick={() => run(s.alt!, s.owned)}>
                  <div className="sk"><span className="act">{s.alt.label}</span></div>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      <div className="foot" />
      {slides.length > 1 && (
        <div className="dots">
          {slides.map((_, k) => (
            // keyed by the cycle so the fill restarts when a dot is clicked
            <i key={`${k}:${k === on ? cycle : 0}`} className={k === on ? 'on' : ''}
              onClick={() => { setAt(k); setCycle((c) => c + 1); }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────

function Two({ solid, outline, sm }: { solid: string; outline: string; sm?: boolean }) {
  return <div className={'two' + (sm ? ' sm' : '')}><span>{solid}</span><span className="o">{outline}</span></div>;
}

/** A store picture that fades in, and is simply left out when it will not load. */
function Img({ src, className }: { src: string; className?: string }) {
  const [state, setState] = useState<'load' | 'ok' | 'bad'>('load');
  if (state === 'bad') return null;
  return <img src={src} alt="" className={[className, state === 'ok' ? 'ok' : ''].filter(Boolean).join(' ')} onLoad={() => setState('ok')} onError={() => setState('bad')} />;
}

function useCountUp(target: number) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 520);
      const v = Math.round(a + (target - a) * (1 - (1 - k) ** 3));
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

function Stat({ i, value, label, help, icon: Ico, edge, tone, onClick }: {
  i: number; value: number; label: string; help: string; icon: ElementType;
  edge?: string; tone?: 'w' | 'a'; onClick?: () => void;
}) {
  const shown = useCountUp(value);
  return (
    <div className={'pl sv edge in' + (onClick ? ' go' : '')} style={{ '--i': i, ...(edge ? { '--e': edge } : {}) } as CSSProperties} onClick={onClick}>
      <div className="sk">
        <span className={'V' + (tone ? ' ' + tone : '')}>{shown}</span>
        <div><div className="L">{label}</div><div className="D">{help}</div></div>
        <Ico className="ico" />
      </div>
    </div>
  );
}

const money = (n: number) => '£' + (Number.isInteger(n) ? n : n.toFixed(2));

function Product({ p, i, sale, onClick }: { p: ShelfItem; i: number; sale?: number; onClick: () => void }) {
  const t = useChrome();
  const cut = sale && p.price ? Math.round(p.price * (100 - sale)) / 100 : undefined;
  return (
    <div className="pt rise" style={{ '--i': i } as CSSProperties} onClick={onClick}>
      <div className="sk">
        <div className="pic">
          {imageUrl(p.image) && <Img src={imageUrl(p.image)!} />}
          {p.owned
            ? <span className="chip g"><b>{t('home.ownedShort', 'Owned')}</b></span>
            : cut !== undefined ? <span className="chip w"><b>−{sale}%</b></span> : null}
          {(p.isNew || p.update) && <span className="nw"><span className="chip a"><b>{p.update ? t('home.update', 'Update') : t('home.new', 'New')}</b></span></span>}
        </div>
        <div className="mt">
          <div className="t">{p.title}</div>
          <div className="ft">
            <span className="sub">{p.update ? `v${p.version} → v${p.update}` : p.version ? `v${p.version}` : p.kicker ?? ''}</span>
            {p.owned
              ? <span className="own"><Check />{t('home.yours', 'Yours')}</span>
              : p.price !== undefined
                ? <span className="pz">{cut !== undefined && <s>{money(p.price)}</s>}{money(cut ?? p.price)}</span>
                : null}
          </div>
        </div>
      </div>
    </div>
  );
}

const NEWS_ICON: Record<string, ElementType> = {
  update: RefreshCw, promo: Tag, action: AlertTriangle, tip: Lightbulb, notice: Megaphone,
};

function News({ entry, i, onClick }: { entry: DispatchEntry; i: number; onClick: () => void }) {
  const t = useChrome();
  const Ico = NEWS_ICON[entry.kind] ?? Megaphone;
  const word = entry.chip ?? t(`home.kind.${entry.kind}`, entry.kind);
  const loud = entry.kind === 'action' || entry.kind === 'promo';
  return (
    <div className={'pl nc in' + (entry.kind === 'action' ? ' act' : '')} style={{ '--i': i } as CSSProperties} onClick={onClick}>
      <div className="sk">
        <div className="nh">
          <Ico className="ico" />
          <span className={'chip' + (loud ? ' a' : '')}><b>{word}</b></span>
          {entry.stamp && <span className="when">{entry.stamp}</span>}
        </div>
        <div className="t">{entry.title}</div>
        {entry.body && <div className="D">{entry.body}</div>}
      </div>
    </div>
  );
}

function Countdown({ to }: { to: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((to - now) / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  const parts = [`${Math.floor(s / 86400)}d`, `${p(Math.floor((s % 86400) / 3600))}h`, `${p(Math.floor((s % 3600) / 60))}m`, `${p(s % 60)}s`];
  return <span className="cd">{parts.map((v, k) => <span key={k} className="cap"><b>{v}</b></span>)}</span>;
}
