import { useMemo } from 'react';
import { useStudio } from './store';
import { filterAnnouncements, outdatedScripts, usePublicInfo, type PublicInfo } from './publicInfo';
import { useChrome } from './studioLocale';
import type { DispatchEntry } from './Dispatch';

/*
 * What the Overview's shop window shows: a rotating hero, the store shelf,
 * what is coming, and the latest news.
 *
 * It comes from dirk_publicInfo's optional `store` block, so a new release, a
 * sale or a teaser goes live on every server without anyone updating dirk_lib.
 * Until that block exists (or when GitHub cannot be reached) the shelf below is
 * used, which is the real catalogue as it stood when this build shipped - never
 * an empty page.
 *
 * Nothing here is trusted as markup: every field is plain text dropped into a
 * card this file's page designed.
 */

const IMG = 'https://dunb17ur4ymx4.cloudfront.net/packages/images/';
const STORE_URL = 'https://dirkscripts.com';

export type StoreProduct = {
  id: string;
  title: string;
  /** what running it is called on a server - the first one found means "owned" */
  resources?: string[];
  /** a picture: a full URL, or a Tebex package image hash */
  image?: string;
  price?: number;
  /** under the title when no version is known, e.g. "Stable" */
  kicker?: string;
  isNew?: boolean;
  url?: string;
};

export type StoreSlide = {
  /** a product id from the shelf, for its picture and its resources */
  product?: string;
  image?: string;
  kicker: string;
  /** the big line in two halves: solid, then outlined */
  solid: string;
  outline?: string;
  body?: string;
  tags?: { label: string; tone?: 'a' | 'w' | 'g' }[];
  /** what the main button does: open the script, its changelog, the sale, a page */
  go?: { label: string; open?: 'script' | 'changelog'; url?: string };
  alt?: { label: string; open?: 'script' | 'changelog'; url?: string };
  /** a countdown on the kicker, to the sale's end */
  clock?: boolean;
};

export type StoreSale = { name: string; pct: number; ends: string };

export type StoreBlock = {
  url?: string;
  discord?: string;
  sale?: StoreSale;
  slides?: StoreSlide[];
  products?: StoreProduct[];
  soon?: StoreProduct[];
};

const FALLBACK: Required<Pick<StoreBlock, 'slides' | 'products' | 'soon'>> & { url: string; discord: string } = {
  url: STORE_URL,
  discord: 'https://discord.gg/dirkscripts',
  products: [
    { id: 'multichar', title: 'Multicharacter', resources: ['dirk_multichar'], image: 'df0f3b0ebe03369f5dcd6829a5fc704fbfec5e47', price: 23.99 },
    { id: 'labs', title: 'Drug Labs V2', resources: ['dirk_druglabsv2', 'dirk_druglabs'], image: '495d5321c049ebbe7cdcdff2b130f7923eca1929', price: 20, kicker: 'Stable' },
    { id: 'weed', title: 'Weed Growing', resources: ['dirk_weedv2', 'dirk_weed'], image: 'd9df2a60d75c02ea2ac17a251d957f331b86ba80', price: 25, kicker: 'Stable' },
    { id: 'bounty', title: 'Bounty Hunters V2', resources: ['dirk_bountyhunters', 'dirk_bounty'], image: '99c03457633eeafe7785df21750f163d3a45e5a1', price: 30, kicker: 'Stable' },
    { id: 'fishing', title: 'Fishing Sim V2', resources: ['dirk_fishing'], image: '744ea8b41c82d8016419c5a428beb458c5928837', price: 30 },
    { id: 'cars', title: 'Project Cars', resources: ['dirk_projectCars'], image: '1bf45752623a47a64e9c3b98901ebb97be5a7505', price: 25 },
    { id: 'stores', title: 'Stores', resources: ['dirk_stores'], image: '88a9ad891babac6bd700aaf892ebdff4e008b85a', kicker: 'Stable' },
  ],
  soon: [
    { id: 'traphouses', title: 'Traphouses', image: '40fd39493ed97bdb100509289b73c7dcd03fb76c' },
    { id: 'animations', title: 'Animations', image: '9b891887b84da89ca12f4cf2e0f5a9d0e21a5929' },
  ],
  slides: [
    {
      product: 'fishing', kicker: 'Fishing Sim V2', solid: 'Fishing', outline: 'Sim V2',
      body: 'Rods, reels, lures, a shop and a whole tackle book. Every setting lives right here.',
      go: { label: 'What changed', open: 'changelog' }, alt: { label: 'Open Fishing', open: 'script' },
    },
    {
      product: 'multichar', kicker: 'In the store', solid: 'Multi', outline: 'character',
      body: 'Character select with a scene, a camera and the clothes they left in.',
      go: { label: 'See it', url: STORE_URL },
    },
    {
      product: 'traphouses', image: '40fd39493ed97bdb100509289b73c7dcd03fb76c', kicker: 'Coming soon', solid: 'Trap', outline: 'houses',
      body: 'Next on the bench. Get the ping on Discord the day it lands.',
      tags: [{ label: 'Teaser' }],
      go: { label: 'Notify me', url: 'https://discord.gg/dirkscripts' },
    },
  ],
};

export const imageUrl = (image?: string) => {
  if (!image) return undefined;
  if (/^https?:\/\//.test(image)) return image;
  return /^[0-9a-f]{40}$/.test(image) ? `${IMG}${image}.png` : undefined;
};

/** Only http(s) links leave the panel - a feed can never make it run anything else. */
export const safeUrl = (url?: string) => (url && /^https:\/\//.test(url) ? url : undefined);

export type ShelfItem = StoreProduct & {
  owned?: string;
  /** the version this server runs, or the newest released one */
  version?: string;
  update?: string;
};

export type ShopWindow = {
  url: string;
  discord: string;
  sale?: StoreSale & { endsAt: number };
  slides: (StoreSlide & { owned?: string; picture?: string })[];
  shelf: ShelfItem[];
  soon: ShelfItem[];
  news: DispatchEntry[];
};

const NEWS_ORDER: Record<string, number> = { action: 0, notice: 1, update: 2, promo: 3, tip: 4 };

export function useShopWindow(): ShopWindow {
  const scripts = useStudio((s) => s.scripts);
  const info = usePublicInfo().data as (PublicInfo & { store?: StoreBlock }) | undefined;
  const t = useChrome();

  return useMemo(() => {
    const installed: Record<string, string> = {};
    for (const s of scripts) installed[s.resource] = s.version;
    const latest = info?.versions ?? {};
    const block = info?.store && typeof info.store === 'object' ? info.store : undefined;

    const list = <T,>(v: T[] | undefined, fb: T[]) => (Array.isArray(v) && v.length ? v : fb);
    const products = list(block?.products, FALLBACK.products);
    const soon = list(block?.soon, FALLBACK.soon);

    const dress = (p: StoreProduct): ShelfItem => {
      const owned = p.resources?.find((r) => installed[r]);
      const known = p.resources?.find((r) => latest[r]);
      const version = owned ? installed[owned] : known ? latest[known] : undefined;
      const newer = owned && latest[owned] && latest[owned] !== installed[owned] ? latest[owned] : undefined;
      return { ...p, owned, version, update: newer };
    };

    // what you own goes to the end: the shelf is a shop window first
    const shelf = products.map(dress).sort((a, b) => Number(!!a.owned) - Number(!!b.owned));
    const byId = new Map(shelf.map((p) => [p.id, p]));

    const ends = block?.sale?.ends ? Date.parse(block.sale.ends) : NaN;
    const sale = block?.sale && Number.isFinite(ends) && ends > Date.now() && block.sale.pct > 0
      ? { ...block.sale, endsAt: ends }
      : undefined;

    const slides = list(block?.slides, FALLBACK.slides)
      // a sale slide with no live sale behind it says nothing true
      .filter((s) => !s.clock || sale)
      .map((s) => {
        const p = s.product ? byId.get(s.product) : undefined;
        const kicker = p?.version && !s.clock ? `${s.kicker} · v${p.update ?? p.version}` : s.kicker;
        return { ...s, kicker, owned: p?.owned, picture: imageUrl(s.image ?? p?.image) };
      });

    const news = filterAnnouncements(info?.announcements ?? [], installed)
      .slice()
      .sort((a, b) => Number(!!b.pin) - Number(!!a.pin) || (NEWS_ORDER[a.kind] ?? 9) - (NEWS_ORDER[b.kind] ?? 9));

    // A short feed is topped up with what this server is behind on - real
    // news for this server, and never a blank card.
    for (const o of outdatedScripts(latest, installed)) {
      if (news.length >= 3) break;
      const label = scripts.find((x) => x.resource === o.resource)?.label ?? o.resource;
      news.push({
        id: `update:${o.resource}`,
        kind: 'update',
        title: `${label} ${o.available}`,
        body: t('home.newsUpdate', 'A newer version is out. This server runs v{0}.').replace('{0}', o.have),
        stamp: `v${o.available}`,
        action: { label: t('home.whatChanged', 'What changed'), changelog: o.resource },
      });
    }

    return {
      url: safeUrl(block?.url) ?? FALLBACK.url,
      discord: safeUrl(block?.discord) ?? FALLBACK.discord,
      sale,
      slides,
      shelf,
      soon: soon.map(dress),
      news,
    };
  }, [scripts, info, t]);
}

/** Leaves the game for a page - FiveM's own browser call, a tab in dev. */
export function openUrl(url?: string) {
  const safe = safeUrl(url);
  if (!safe) return;
  const native = (window as unknown as { invokeNative?: (name: string, arg: string) => void }).invokeNative;
  if (native) native('openUrl', safe);
  else window.open(safe, '_blank');
}
