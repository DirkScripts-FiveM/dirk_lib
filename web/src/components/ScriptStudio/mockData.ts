// PHASE 0 - the hub rendered from the REAL schemas.
//
// dirk_fishing/schema.json and dirk_lib/schema.json are copied verbatim into
// fixtures/ and walked by schemaToStudio, so what you see is those scripts'
// actual settings, in their actual sections - not a hand-written impression of
// them. Nothing is invented, reordered or renamed here.
//
// The only hand-written parts are:
//   - group icons (the schema has no x-icon yet)
//   - which array renders as the map control (no x-control yet)
//   - a handful of demo overrides so MODIFIED / revert states are visible
// Each of those is a schema annotation Phase 2 adds, listed in the artifact.

import fishingSchema from './fixtures/dirk_fishing.schema.json';
import libSchema from './fixtures/dirk_lib.schema.json';
import loadingSchema from './fixtures/dirk_loading.schema.json';
// projectCars is here for the WORKSPACE shapes fishing does not have: a section
// that is a map AND a list AND a levelling curve, all in one rail entry. Those
// paths are only reachable through a schema shaped like this one.
import projectCarsSchema from './fixtures/dirk_projectCars.schema.json';
import { useItems } from 'dirk-cfx-react';
import { schemaToStudio } from './schemaToStudio';
import type { StudioScript } from './types';

const fishing = schemaToStudio(fishingSchema as Record<string, unknown>, {
  resource: 'dirk_fishing',
  label: 'Fishing',
  icon: 'fish',
  version: '2.4.1',
  groupIcons: {
    basic: 'sliders-horizontal',
    theme: 'palette',
    access: 'shield',
    baitDig: 'shovel',
    depthOverride: 'waves',
    equipment: 'anchor',
    fish: 'fish',
    zones: 'map',
    stores: 'store',
    seaBoundary: 'waves',
    tournaments: 'trophy',
    dailyChallenges: 'target',
    logging: 'scroll-text',
  },
  // The zones array is placed geographically, so it gets the map control.

  // Fishing's fish editor really does have these four tabs, with these fields -
  // taken from FishSection's GENERAL_KEYS / ECOLOGY_KEYS / GUTTING_KEYS.

  // fishing's `basic` holds ~40 settings spanning six unrelated concerns, which
  // is what made it an endless tab. Split by concern so the rail can find
  // things - deliberately NOT mixing aspects: trap mechanics stay away from
  // trap gear, permits stay whole, gutting stays whole.

  // Who can open and edit a script is set once on the Admins page. Leaving a
  // per-script copy in the rail would be the same thing in two places, and two
  // places disagree.
  managedElsewhere: ['access'],
  // Stand-ins for values an admin has changed, so the panel is not a wall of
  // untouched defaults while the states are being reviewed.
  overrides: {
    'basic.debug': true,
    // within the schema's 0-0.85 range; 8 was invalid seed data and the
    // validator was right to refuse it
    'basic.spookPerCatch': 0.08,
    'theme.useOverride': true,
    // a palette NAME, not a hex - primaryColor selects a Mantine palette
    'theme.primaryColor': 'teal',
  },
});

const lib = schemaToStudio(libSchema as Record<string, unknown>, {
  resource: 'dirk_lib',
  label: 'Shared Settings',
  icon: 'library',
  version: '1.2.79',
  shared: true,
  groupIcons: {
    basic: 'sliders-horizontal',
    appearance: 'palette',
    bridging: 'plug',
    groups: 'users',
    access: 'shield',
    discord: 'message-circle',
    logger: 'scroll-text',
    advanced: 'wrench',
  },
  // Both of these have a page of their own that says more than a list of text
  // boxes can: Bridges shows what each choice actually resolved to on this
  // server, and Admins shows who holds access and where it came from. Leaving
  // a second copy in Shared Settings would be the same values in two places.
  managedElsewhere: ['bridging', 'access'],
});


// dirk_loading — the loading-screen resource. Included because it is the first
// script whose settings are VISUAL rather than fields: backgrounds are a
// filmstrip of thumbnails, music rows carry cover art, and both pick from files
// shipped in the resource. The generic adapter renders all of that as plain list
// rows, which is correct and much worse — so this is the clearest example so far
// of a gap in the schema vocabulary rather than a UI problem.
//
// `designs` is x-serverOnly and holds authored design JSON; it is hidden from the
// rail on purpose. The design EDITOR is the separate `design` page, not a setting.
const loading = schemaToStudio(loadingSchema as Record<string, unknown>, {
  resource: 'dirk_loading',
  label: 'Loading Screen',
  icon: 'image',
  version: '1.0.12',
  groupIcons: {
    settings: 'sliders-horizontal',
    backgrounds: 'image',
    songs: 'music',
    changelogs: 'scroll-text',
    tips: 'lightbulb',
    links: 'link',
    players: 'trophy',
  },
  sections: [
    {
      id: 'backgrounds', label: 'Backgrounds', icon: 'image',
      description: 'The slides a design can use. WANTS a thumbnail picker, not list rows.',
      paths: ['backgrounds', 'settings.carouselTime'],
    },
    {
      // id must NOT be the schema key: a section whose id already exists as a
      // group keeps the schema's label, so 'songs' would render as "Songs".
      id: 'music', label: 'Music', icon: 'music',
      description: 'Tracks a design can play. Rows want cover art and a file picker.',
      paths: ['songs'],
    },
    { id: 'changelogs', label: 'Changelogs', icon: 'scroll-text', description: 'Updates a design can show.', paths: ['changelogs'] },
    { id: 'tips', label: 'Tips', icon: 'lightbulb', description: 'Lines a design can rotate through.', paths: ['tips'] },
    { id: 'links', label: 'Links', icon: 'link', description: 'Links a design can offer.', paths: ['links'] },
    { id: 'podium', label: 'Podium', icon: 'trophy', description: 'Players a design can feature.', paths: ['players'] },
  ],
  // Authored design JSON and the active-design pointer. Neither is a form field —
  // the design EDITOR owns both — so they are parked out of the rail without
  // dropping their values.
  managedElsewhere: ['designs', 'activeDesignId'],
});

const projectCars = schemaToStudio(projectCarsSchema as Record<string, unknown>, {
  resource: 'dirk_projectCars',
  label: 'Project Cars',
  icon: 'car',
  version: '1.0.0',
});

export const MOCK_SCRIPTS: StudioScript[] = [
  fishing, projectCars, { ...loading, designs: true }, lib,
];

/**
 * Stands in for the live inventory the item picker reads in game.
 *
 * Built from the items fishing's schema actually references, minus a handful
 * held back on purpose so the missing-items banner has something real to
 * report - that is the state a server lands in when it installs the script but
 * not the items.
 */
const NOT_INSTALLED = new Set(['abyssalreel', 'bluemarlin', 'fishfinder', 'brutasrod']);

function itemNamesFromSchema(): string[] {
  const found = new Set<string>();
  const visit = (node: unknown, key = ''): void => {
    if (Array.isArray(node)) { node.forEach((n) => visit(n, key)); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      // item references are string values on keys the schema installs from
      if (typeof v === 'string' && /^(name|item|.*Item|.*ItemOverride)$/.test(k) && /^[a-z][a-z0-9_]{2,}$/.test(v)) {
        found.add(v);
      }
      visit(v, k);
    }
  };
  visit((fishingSchema as { properties?: unknown }).properties);
  return [...found];
}

export const MOCK_ITEMS: { name: string; label: string }[] = itemNamesFromSchema()
  .filter((name) => !NOT_INSTALLED.has(name))
  .concat(['money'])
  .sort()
  .map((name) => ({
    name,
    label: name.replace(/[_-]+/g, ' ').replace(/\w/g, (c) => c.toUpperCase()),
  }));


// In game FETCH_ALL_ITEMS fills dirk-cfx-react's item store from the inventory
// bridge. In a browser nothing answers it, so seed the same store from the mock
// - that is what makes SelectItem, item images and the inventory-sourced
// label/description mirroring behave the way they will on a server.
useItems.setState(
  Object.fromEntries(MOCK_ITEMS.map((item) => [item.name, {
    name: item.name,
    label: item.label,
    weight: 100,
    image: '',
    description: `${item.label} — description sourced from the inventory.`,
  }])),
  true,
);
