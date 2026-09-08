import { alpha, Flex, Text, useMantineTheme } from '@mantine/core';
import { motion } from 'framer-motion';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { effectiveValue, setValue, useStudio } from './store';
import { SkillCurve } from './SkillCurve';
import { CompactHelp } from './compactHelp';
import { ZoneMap } from './ZoneMap';
import type { SettingEntry } from './types';
import { BASIC_CHILD, MAP_CHILD, SKILL_CHILD, tabsAsList } from './types';
import { useChrome } from './studioLocale';

/**
 * Renders one section's settings.
 *
 * A section holding several lists (fishing's Equipment is seven lists / 102
 * rows) shows one list at a time behind a sticky tab strip rather than
 * stacking them - otherwise finding a rod means scrolling past every hook.
 * This is the `x-layout: "tabs"` behaviour: it applies to any section whose
 * children are mostly lists, so stores and bait-dig tools inherit it.
 *
 * The rule that makes tabs safe: a search must never hide a match. Tabs badge
 * how many rows they hold for the current query, and the first tab with a
 * match is selected automatically.
 */
export function SectionBody({
  resource, entries, query, renderRow, railDriven,
}: {
  resource: string;
  entries: SettingEntry[];
  query: string;
  /** the row renderer lives in main so it keeps its memoised identity */
  renderRow: (entry: SettingEntry, rowFilter?: string, fill?: boolean) => React.ReactNode;
  /**
   * The RAIL is the switcher, so there is no strip in the body.
   *
   * A workspace section fills the pane, and its lists are already children in
   * the rail - Equipment > Rods, Reel, Hook. Drawing a tab strip as well meant
   * two switchers for one choice, stacked on top of each other, and the strip
   * made seven separate lists look like seven tabs of one. Each list is its
   * own place; picking it in the rail is how you get there.
   */
  railDriven?: boolean;
}) {
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];

  // Which child the rail is pointing at. Not cleared once read: unlike the tab
  // strip's one-shot request, this IS the current selection.
  const requestedList = useStudio((state) => state.activeList);

  // Polygon layers all share one canvas rather than getting a map each.
  // Declared UP HERE because the effect below reads them — leaving them further
  // down put them in the temporal dead zone and threw on first render.
  const mapLayers = useMemo(() => entries.filter((e) => e.type === 'zones'), [entries]);
  const rest = useMemo(() => entries.filter((e) => e.type !== 'zones'), [entries]);

  const railLists = useMemo(() => entries.filter(tabsAsList), [entries]);
  const railPlain = useMemo(() => entries.filter((e) => !tabsAsList(e)), [entries]);

  // Landing on the section itself shows its loose settings - the "Basic" of
  // the pattern - or the first list when it has none.
  const railActive = railDriven
    ? (railLists.find((l) => l.path === requestedList)
      ?? (railPlain.length > 0 ? undefined : railLists[0]))
    : undefined;

  useEffect(() => {
    if (!railDriven) return;
    // When the section's own settings are showing, the child that is on screen
    // is Basic - say so, or the rail highlights nothing at all.
    // A map section reports whichever of its two children is on screen, so the
    // rail highlights Zones when the map is up rather than falling back to
    // Basic and pointing at the wrong row.
    if (mapLayers.length > 0 && rest.length > 0) {
      // Whichever of its children is actually showing, which is now more than
      // two of them. Reporting Basic for everything-that-is-not-the-map meant
      // clicking Sellers changed the page and left the rail pointing at Basic.
      const picked = railLists.some((entry) => entry.path === requestedList
        && entry.type !== 'zones');

      useStudio.setState({
        shownList: requestedList === MAP_CHILD ? MAP_CHILD
          : requestedList === SKILL_CHILD ? SKILL_CHILD
            : picked ? requestedList
              : BASIC_CHILD,
      });
      return;
    }
    useStudio.setState({
      shownList: railActive?.path ?? (railPlain.length > 0 ? BASIC_CHILD : null),
    });
  }, [railDriven, railActive?.path, railPlain.length, requestedList, mapLayers.length, rest.length, railLists]);


  if (railDriven) {
    // A map section FIRST. Being a workspace is exactly what a map section
    // is, so the rail-driven split below - which knows only about lists and
    // loose settings - was catching Zones and rendering it as three plain
    // rows before the map was ever considered.
    if (mapLayers.length > 0) {
      const theMap = (
        <ZoneMap
          resource={resource}
          layers={mapLayers.map((entry) => ({
            entry,
            value: effectiveValue(resource, entry),
            onChange: (next) => setValue(resource, entry, next),
          }))}
        />
      );

      // With settings of its own, the section is two rail children: its
      // settings, and the map. Stacking them put those settings under a
      // full-height map, reading as part of it. Every layer still shares the
      // one canvas - only the map's NEIGHBOURS moved.
      if (rest.length > 0) {
        // The map fills its box; the SETTINGS do not.
        //
        // Both were being rendered into the same bare column, so a map
        // section's Basic page came out with its rows jammed together and no
        // way to reach the ones past the bottom of the panel. They are two
        // different kinds of content and only one of them wants to be a
        // full-height canvas.
        if (requestedList === MAP_CHILD) {
          return (
            <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
              {theMap}
            </Flex>
          );
        }

        // The curve is its own page too, for the same reason the map is: it
        // wants the width, and among the loose settings it would not get it.
        if (requestedList === SKILL_CHILD) {
          const skill = rest.filter((entry) => entry.subgroup?.skill);
          return (
            <Flex
              direction="column" gap="xs" className="studio-scroll"
              style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}
            >
              {skill.map((entry, index) => withSubgroup(
                entry, index, skill, renderRow, color, theme, resource,
              ))}
            </Flex>
          );
        }

        // Each rail child is its OWN page.
        //
        // Rendering everything that was not the map put the section's settings
        // and its tables into one long scroll, so Basic and Sellers pointed at
        // the same screen — the rail offered a choice that changed nothing.
        const pickedList = railLists.find((entry) => entry.path === requestedList
          && entry.type !== 'zones');

        if (pickedList) {
          return (
            <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
              <Fragment key={pickedList.path}>{renderRow(pickedList, query || undefined, true)}</Fragment>
            </Flex>
          );
        }

        // Otherwise the section's own settings, which is what Basic means —
        // minus the skill block, which has a page of its own now and would
        // otherwise be on both.
        const basics = rest.filter((entry) => !tabsAsList(entry) && !entry.subgroup?.skill);
        return (
          <Flex
            direction="column" gap="xs" flex={1}
            className="studio-scroll"
            style={{ minHeight: 0, overflowY: 'auto' }}
          >
            {basics.map((entry, index) => withSubgroup(entry, index, basics, renderRow, color, theme, resource))}
          </Flex>
        );
      }

      return (
        <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
          {theMap}
        </Flex>
      );
    }

    // One list, and at most ONE setting beside it: stack them. A store toggle
    // that switches the whole list off belongs above the thing it switches
    // off, not behind a tab beside it.
    //
    // Beyond that the settings stop being a preamble and start crowding the
    // list, so they get the Basic page the rail already knows how to select.
    if (railLists.length <= 1 && railPlain.length <= 1) {
      return (
        <Flex direction="column" gap="xs" flex={1} style={{ minHeight: 0 }}>
          {railPlain.map((entry, index) => withSubgroup(entry, index, railPlain, renderRow, color, theme, resource))}
          {railLists[0] && (
            <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
              {renderRow(railLists[0], query || undefined, true)}
            </Flex>
          )}
        </Flex>
      );
    }

    if (railActive) {
      return (
        <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
          <Fragment key={railActive.path}>{renderRow(railActive, query || undefined, true)}</Fragment>
        </Flex>
      );
    }
    return (
      <Flex direction="column" gap="xs" flex={1} style={{ minHeight: 0 }}>
        {railPlain.map((entry, index) => withSubgroup(entry, index, railPlain, renderRow, color, theme, resource))}
      </Flex>
    );
  }

  if (mapLayers.length > 0) {
    return (
      <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
        <ZoneMap
          layers={mapLayers.map((entry) => ({
            entry,
            value: effectiveValue(resource, entry),
            onChange: (next) => setValue(resource, entry, next),
          }))}
        />
        {rest.map((entry, index) => withSubgroup(entry, index, rest, renderRow, color, theme, resource))}
      </Flex>
    );
  }

  const lists = entries.filter(tabsAsList);
  const useTabs = lists.length >= 2;

  if (!useTabs) {
    // Keep schema order when there is nothing to tab.
    return <>{entries.map((entry, index) => withSubgroup(entry, index, entries, renderRow, color, theme, resource))}</>;
  }

  // The exact complement of what is tabbed. Testing for `type !== 'list'` was
  // right only while a tabbed list was always type `list`: a script's own
  // control standing in for one is type `custom`, so all seven of fishing's
  // equipment lists went into the tab strip AND rendered stacked underneath
  // it - one column of seven full-height grids you could not get past.
  const plain = entries.filter((e) => !tabsAsList(e));

  // The loose settings become a tab of their own rather than a preamble
  // stacked above the strip. Bait Dig is four numbers and two lists, and
  // reading the numbers first then meeting a tab strip made the strip look
  // like it belonged to the last number rather than to the section.
  return (
    <ListTabs
      resource={resource}
      lists={lists}
      plain={plain}
      query={query}
      renderRow={renderRow}
    />
  );
}

const BASIC_TAB = BASIC_CHILD;

function ListTabs({
  resource, lists, plain, query, renderRow,
}: {
  resource: string;
  lists: SettingEntry[];
  /** the section's loose settings, shown as a leading "Basic" tab */
  plain: SettingEntry[];
  query: string;
  renderRow: (entry: SettingEntry, rowFilter?: string) => React.ReactNode;
}) {
  const theme = useMantineTheme();
  const t = useChrome();
  const color = theme.colors[theme.primaryColor][5];
  const [activePath, setActivePath] = useState(plain.length > 0 ? BASIC_TAB : (lists[0]?.path ?? ''));

  // how many rows in each list match the current search
  const matches = useMemo(() => {
    const map = new Map<string, number>();
    if (!query) return map;
    const needle = query.toLowerCase();
    for (const list of lists) {
      const rows = effectiveValue(resource, list) as unknown;
      const count = Array.isArray(rows)
        ? rows.filter((row) => JSON.stringify(row ?? '').toLowerCase().includes(needle)).length
        : 0;
      map.set(list.path, count);
    }
    return map;
  }, [lists, query, resource]);

  // never let a search hide a hit behind an unopened tab
  useEffect(() => {
    if (!query) return;
    if ((matches.get(activePath) ?? 0) > 0) return;
    const firstHit = lists.find((l) => (matches.get(l.path) ?? 0) > 0);
    if (firstHit) setActivePath(firstHit.path);
  }, [query, matches, activePath, lists]);

  useEffect(() => {
    if (activePath === BASIC_TAB && plain.length > 0) return;
    if (!lists.some((l) => l.path === activePath)) {
      setActivePath(plain.length > 0 ? BASIC_TAB : (lists[0]?.path ?? ''));
    }
  }, [lists, plain.length, activePath]);

  // The rail can name a tab directly. Cleared once taken so that picking the
  // same one again still works, and so it does not fight a later manual choice.
  const requestedList = useStudio((state) => state.activeList);
  useEffect(() => {
    if (!requestedList) return;
    if (!lists.some((l) => l.path === requestedList)) return;
    setActivePath(requestedList);
    useStudio.setState({ activeList: null });
  }, [requestedList, lists]);

  const showBasic = activePath === BASIC_TAB && plain.length > 0;
  const active = showBasic ? undefined : (lists.find((l) => l.path === activePath) ?? lists[0]);

  // Tell the rail what is on screen, so the matching child highlights.
  useEffect(() => {
    if (!active) return;
    useStudio.setState({ shownList: active.path });
  }, [active?.path]);

  return (
    <Flex direction="column" gap="xs">
      {/* Not sticky: a virtualised section is absolutely positioned and
          transformed, which breaks position:sticky and let the strip drift down
          the list. A fixed-height body below keeps it visible instead. */}
      <Flex
        gap="0.3vh"
        wrap="wrap"
        p="0.3vh"
        style={{
          background: alpha(theme.colors.dark[9], 0.7),
          border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.4)}`,
          borderRadius: theme.radius.xs,
          flexShrink: 0,
        }}
      >
        {plain.length > 0 && (
          <motion.button
            type="button"
            onClick={() => setActivePath(BASIC_TAB)}
            whileTap={{ scale: 0.98 }}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5vh',
              padding: '0.5vh 0.9vh',
              background: showBasic ? alpha(color, 0.16) : 'transparent',
              border: '0.1vh solid transparent',
              borderRadius: theme.radius.xs,
              cursor: 'pointer',
            }}
          >
            <Text
              ff="Akrobat Bold" size="xs" tt="uppercase" lts="0.05em"
              c={showBasic ? color : 'rgba(255,255,255,0.6)'}
            >
              {t('sectionBody.basic', 'Basic')}
            </Text>
            <Text ff="monospace" size="xxs" c={showBasic ? alpha(color, 0.7) : 'rgba(255,255,255,0.3)'}>
              {plain.length}
            </Text>
          </motion.button>
        )}

        {lists.map((list) => {
          const on = list.path === active?.path;
          const hits = matches.get(list.path) ?? 0;
          const rows = Array.isArray(list.value) ? (list.value as unknown[]).length : 0;
          return (
            <motion.button
              key={list.path}
              type="button"
              onClick={() => setActivePath(list.path)}
              whileTap={{ scale: 0.98 }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5vh',
                padding: '0.5vh 0.9vh',
                background: on ? alpha(color, 0.16) : 'transparent',
                border: `0.1vh solid ${query && hits > 0 && !on ? alpha(color, 0.45) : 'transparent'}`,
                borderRadius: theme.radius.xs,
                cursor: 'pointer',
              }}
            >
              <Text
                ff="Akrobat Bold" size="xs" tt="uppercase" lts="0.05em"
                c={on ? color : 'rgba(255,255,255,0.6)'}
              >
                {list.label}
              </Text>
              <Text ff="monospace" size="xxs" c={on ? alpha(color, 0.7) : 'rgba(255,255,255,0.3)'}>
                {query ? `${hits}/${rows}` : rows}
              </Text>
            </motion.button>
          );
        })}
      </Flex>

      {/* Rows FLOW into the page scroll rather than sitting in a scroller of
          their own.

          This used to be a fixed 48vh box, so that switching from 13 rods to 24
          hooks could not resize the section and shove everything below it. That
          traded a small jump for a permanent one: a scrollbar inside a
          scrollbar, and 37 fish in a letterbox less than half the window tall.
          Scroll-within-scroll is the worse deal, and the old panel never did it.

          A min-height keeps the jump small when a short tab follows a long one,
          without capping how tall a long one may be. */}
      {showBasic && (
        <Flex direction="column" gap="xs" style={{ minHeight: '24vh' }}>
          {plain.map((entry, index) => withSubgroup(entry, index, plain, renderRow, color, theme, resource))}
        </Flex>
      )}

      {active && (
        <Flex
          direction="column"
          style={{ minHeight: '24vh' }}
        >
          <Fragment key={active.path}>
            {renderRow(active, query || undefined)}
          </Fragment>
        </Flex>
      )}
    </Flex>
  );
}

/** Nested schema objects get a labelled divider inside the section. */
function withSubgroup(
  entry: SettingEntry,
  index: number,
  list: SettingEntry[],
  renderRow: (entry: SettingEntry, rowFilter?: string) => React.ReactNode,
  color: string,
  theme: ReturnType<typeof useMantineTheme>,
  resource?: string,
) {
  const previous = list[index - 1];
  const startsBlock = entry.subgroup && previous?.subgroup?.id !== entry.subgroup.id;
  const skill = entry.subgroup?.skill;

  const heading = startsBlock ? (
    // The rail's sub-tree scrolls to this. The divider already marked where a
    // block begins; it just had no name anything could aim at.
    <Flex
      align="center" gap="xs" mt="xs" mb="0.1vh"
      data-subgroup={entry.subgroup!.id}
    >
      <Flex h="0.1vh" w="1.4vh" style={{ background: alpha(color, 0.5) }} />
      <Text ff="Akrobat Bold" size="xs" tt="uppercase" lts="0.1em" c={alpha(color, 0.85)}>
        {entry.subgroup!.label}
      </Text>
      <Flex h="0.1vh" style={{ flex: 1, background: alpha(theme.colors.dark[5], 0.5) }} />
    </Flex>
  ) : null;

  /*
    A skill block is drawn as ONE thing: settings on the left, the curve beside
    them on the right.

    The curve started underneath, after the last field, which reads the wrong
    way round — you change a setting at the top and the thing that tells you
    what you just did is off the bottom of the block, and you cannot see both at
    once. A levelling block is four or five short fields and never grows, so the
    room is there to put them side by side and watch the climb move as you drag.

    Consumed in one go at the first entry, and every later entry of the block
    returns nothing. Rendering them individually is what forced the curve to be
    an afterthought appended at the end.
  */
  if (skill) {
    if (!startsBlock) return null;

    const mine = list.filter((e) => e.subgroup?.id === entry.subgroup!.id);

    return (
      <Fragment key={entry.path}>
        {heading}
        <Flex gap="md" align="flex-start" wrap="wrap">
          {/*
            Descriptions move to a hover icon in here.

            A setting's help text is laid out inline at up to 82vh wide, which
            is fine down the middle of a full pane and awful in a column half
            that: the levelling-style paragraph wrapped to twelve lines and the
            dropdown it belongs to ended up floating in the middle of them. The
            same information, on the same hover icon the row editors already
            use, and the fields stay a list of fields.
          */}
          <CompactHelp>
            <Flex direction="column" gap="xs" style={{ flex: '1 1 34vh', minWidth: '30vh' }}>
              {mine.map((e) => <Fragment key={e.path}>{renderRow(e)}</Fragment>)}
            </Flex>
          </CompactHelp>

          {resource && (
            <Flex style={{ flex: '1 1 34vh', minWidth: '28vh' }}>
              <SkillCurveForBlock resource={resource} block={entry.subgroup!.id} list={list} />
            </Flex>
          )}
        </Flex>
      </Fragment>
    );
  }

  return (
    <Fragment key={entry.path}>
      {heading}
      {renderRow(entry)}
    </Fragment>
  );
}

/**
 * The curve for one `x-skill` block, from what is STAGED rather than saved.
 *
 * Reading the draft is the whole point: an admin dragging the modifier watches
 * the climb change under their hand, which is the only way that number means
 * anything before they commit to it.
 */
function SkillCurveForBlock({
  resource, block, list,
}: { resource: string; block: string; list: SettingEntry[] }) {
  // Subscribed, not read once - `effectiveValue` is a plain function, so
  // without this the chart would freeze at whatever it was on first render.
  useStudio((state) => state.draft[resource]);

  const read = (key: string, fallback: number) => {
    const entry = list.find((e) => e.subgroup?.id === block && e.path.endsWith(`.${key}`));
    if (!entry) return fallback;
    const value = effectiveValue(resource, entry);
    return typeof value === 'number' ? value : fallback;
  };

  const readText = (key: string, fallback: string) => {
    const entry = list.find((e) => e.subgroup?.id === block && e.path.endsWith(`.${key}`));
    if (!entry) return fallback;
    const value = effectiveValue(resource, entry);
    return typeof value === 'string' ? value : fallback;
  };

  return (
    <SkillCurve
      settings={{
        baseLevel: read('baseLevel', 1),
        maxLevel: read('maxLevel', 99),
        baseXP: read('baseXP', 83),
        modifier: read('modifier', 1),
        curve: readText('curve', 'runescape') as never,
      }}
    />
  );
}
