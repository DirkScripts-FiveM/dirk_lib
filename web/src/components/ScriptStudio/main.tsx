import { alpha, Flex, Text, TextInput, Tooltip, UnstyledButton, useMantineTheme } from '@mantine/core';
import { isEnvBrowser, useSettings } from 'dirk-cfx-react';
import { ConfirmModal, anyDialogOpen, useDialogOpen } from './Dialog';
import { PAGES, Rail, SaveBar, ScriptPicker, ScriptSwitch, SectionHeading, TopBar, ownedByScript } from './Frame';
import { noteRecent } from './stats';
import { Segs, useAccent } from '../Kit';
import './studio.css';
import './pages.css';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, Anchor, ArrowLeft, ArrowRight, Banknote, Box, Braces, Car, Check, ChevronRight, Droplets, Fish, Gamepad2, History, Home, Image, Info, LayoutTemplate, Library, Lightbulb, Link as LinkIcon, ListRestart, Lock, Map as MapIcon, MessageCircle, Music, Package, Palette, Plug, Radar, Redo2, RefreshCw, RotateCcw, ScrollText, Search, Shield, Shovel, SlidersHorizontal, Sprout, Store, Target, TrendingUp, Trophy, Undo2, User, Users, Utensils, Waves, Wrench, X,
} from 'lucide-react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { Fragment, memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNuiEvent } from '../../hooks/useNuiEvent';
import { forgetComponents } from './CustomControl';
import { useCompactHelp } from './compactHelp';
import { fetchNui } from '../../utils/fetchNui';
import { ControlsControl, SettingControl, controlSize, isWideType } from './Controls';
import { ListRows } from './ListRows';
import { SectionBody } from './SectionBody';
import { HistoryModal } from './HistoryModal';
import { LogsPage } from './LogsPage';
import { applyLivePayload, reloadFromServer, type LivePayload } from './live';
import { HomePage } from './HomePage';
import { problemsFor } from './validate';
import { DiscordSetup } from './DiscordSetup';
import { MissingItemsButton } from './MissingItems';
import { BridgesPage } from './BridgesPage';
import { AdminsPage } from './AdminsPage';
import { CataloguePage } from './CataloguePage';
import { MinigamesPage } from './MinigamesPage';
import { JsonModal } from './JsonModal';
import { PaletteControl } from './PaletteControl';
import { GroupsControl, KeyValueControl } from './MapControls';
import { KeybindMapControl } from './KeybindMapControl';
import { GroupGradeControl } from './GroupGradeControl';
import { WeekdayControl } from './WeekdayControl';
import { PositionListControl } from './PositionListControl';
import { CameraListControl } from './CameraListControl';
import { WeightMapControl } from './WeightMapControl';
import { RefListControl } from './RefListControl';
import { MantineColorControl, ShadeControl } from './ThemeControls';
import { CustomControl } from './CustomControl';
import { FieldAction } from './FieldAction';
import { FieldValidator } from './FieldValidator';
import { Icon } from './Icon';
import { PickerDrawer, opensPicker } from './PickerDrawer';
import { SearchResults } from './SearchResults';
import { SearchLinks, type SearchLink } from './SearchLinks';
import { ScriptPage } from './ScriptPage';
import { Chip, StudioButton } from './ui';
import {
  commitDraft, dirtyCount, discardDraft, effectiveValue, factoryReset, isEnabled, isModified, isStaged, matchesSearch, redo, revertToDefault, rowMatches, sectionValues, setValue, undo, useStudio,
} from './store';
import { forgetLocales, loadLocales, sectionKey, settingKey, translate, useActiveLanguage, useBundles, useChrome } from './studioLocale';
import { SetupWizard } from './SetupWizard';
import type { SettingEntry, SettingGroup, SlottedSetting, StudioScript } from './types';
import { useInputCssVars } from './Controls';
import { useAdminToolStore } from 'dirk-cfx-react';
import { ChangelogPage } from './ChangelogPage';
import { TestsPage } from './TestsPage';
import { AccountChip } from './AccountChip';
import { useAnnouncedResources } from './Dispatch';
import { BASIC_CHILD, MAP_CHILD, SKILL_CHILD, tabsAsList } from './types';
import { Toasts } from './Toasts';

// Icons resolve by name from the whole lucide set - see ./Icon. Re-exported
// here because most of the panel already imports `Icon` from main.
export { Icon };

/** Wraps the matched run so a search hit is visible in place, like his does. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <span className="ss-hl">
        {text.slice(index, index + query.length)}
      </span>
      {text.slice(index + query.length)}
    </>
  );
}

/**
 * Put the panel into a named state for a screenshot, from the URL.
 *
 * Browser-only and costs the real build nothing: without `?shot` it returns
 * before doing anything. Setting `data-shot` on the root is what lets the
 * stylesheet silence everything painting behind the panel, so a capture with
 * an alpha channel comes out on genuine transparency.
 *
 * Deep-links through the panel's own navigation rather than setting the
 * destination directly, so a shot also proves the route works.
 */
function useShotMode() {
  useEffect(() => {
    if (!isEnvBrowser()) return;
    const params = new URLSearchParams(window.location.search);
    const shot = params.get('shot');
    if (shot === null) return;

    const state: Record<string, unknown> = { open: true, fullScreen: false };
    const resource = params.get('resource');
    if (resource) state.activeResource = resource;
    // `shot=` on its own means "whatever the panel opens on".
    state.activePage = shot === '' ? null : shot;

    useStudio.setState(state);

    // A section inside a script - Theme, Logger, Bridging. Goes through the
    // panel's own navigation, so a docs screenshot also proves the route
    // still exists rather than quietly photographing the landing page.
    const group = params.get('group');
    if (group) {
      useStudio.setState({
        goToRequest: { resource: resource || 'dirk_lib', group },
      });
    }

    document.documentElement.setAttribute('data-shot', '1');
  }, []);
}

export default function ScriptStudio() {
  useShotMode();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];

  const t = useChrome();
  const open = useStudio((s) => s.open);
  const scripts = useStudio((s) => s.scripts);
  const activeResource = useStudio((s) => s.activeResource);
  const canEdit = useStudio((s) => s.canEdit);
  const askLanguage = useStudio((s) => s.askLanguage);
  const saving = useStudio((s) => s.saving);
  const saveError = useStudio((s) => s.saveError);
  const saved = useStudio((s) => s.saved);
  const activePage = useStudio((s) => s.activePage);
  const shownList = useStudio((s) => s.shownList);
  const inputVars = useInputCssVars();

  /**
   * A running admin tool takes the screen.
   *
   * Picking a position means walking to it, so the panel has to be out of the
   * way - it is hidden rather than closed, because everything staged in it
   * must still be there when you come back. dirk_lib's client has already
   * released NUI focus by this point.
   */
  const activeTool = useAdminToolStore((s) => s.active);
  const accent = useAccent();
  const fresh = useStudio((s) => s.fresh);
  const dialogOpen = useDialogOpen();
  // CTRL K: every script, searchable, instead of a rail that lists them all
  const [pickerOpen, setPickerOpen] = useState(false);
  // the linked account's details, open from the chip top right
  const [acctOpen, setAcctOpen] = useState(false);
  // the missing-items menu under its warn plate, beside the account chip
  const [missOpen, setMissOpen] = useState(false);
  // Mounted from the first open on: closing only hides it (`.shut`), so the
  // next open repaints what is already built instead of rebuilding it.
  const everOpen = useRef(false);
  if (open) everOpen.current = true;
  useEffect(() => { if (!open) setPickerOpen(false); }, [open]);

  /**
   * Published on the DOCUMENT, not on the panel.
   *
   * Mantine portals every dropdown to <body>, which is outside the panel's
   * subtree - so variables set on the panel root are invisible to exactly the
   * elements that need them. Set here, removed on close, so nothing is left
   * behind for whatever else this NUI draws.
   */
  useEffect(() => {
    const root = document.documentElement;
    const entries = Object.entries(inputVars) as [string, string][];
    for (const [key, value] of entries) {
      if (key.startsWith('--') && value) root.style.setProperty(key, value);
    }
    return () => {
      for (const [key] of entries) {
        if (key.startsWith('--')) root.style.removeProperty(key);
      }
    };
  }, [inputVars]);
  const fullScreen = useStudio((s) => s.fullScreen);

  // Which search box we are looking at. Each page owns one; a script's settings
  // share one across their sections, because those scroll as a single list.
  const searchKey = activePage ?? `script:${activeResource}`;
  const search = useStudio((s) => s.searches[searchKey] ?? '');
  const setSearch = useCallback((value: string) => {
    useStudio.setState((state) => ({ searches: { ...state.searches, [searchKey]: value } }));
  }, [searchKey]);
  // Typing stays instant; the 100+ row filter runs on the deferred value.
  const deferredSearch = useDeferredValue(search);
  const editingDesign = useStudio((s) => s.editingDesign);
  // Setting text comes from each script's own bundle; changing the language
  // setting re-renders every label immediately, no reopen.
  const language = useActiveLanguage();
  const bundles = useBundles();

  // Bundles for whatever language is selected, fetched as it changes. Without
  // this the panel resolved every label against an empty store and stayed in
  // English however the language setting was set.
  useEffect(() => {
    if (!open) return;
    void loadLocales(language);
  }, [open, language, scripts]);

  // Live theme switching, the way the old per-resource panel had it: the shared
  // appearance settings feed dirk-cfx-react's settings store, which is what
  // DirkProvider builds the Mantine theme from - so a colour change repaints the
  // panel as you make it, before saving.
  const sharedScript = useMemo(() => scripts.find((entry) => entry.shared), [scripts]);
  const sharedDraft = useStudio((s) => (sharedScript ? s.draft[sharedScript.resource] : undefined));

  useEffect(() => {
    if (!sharedScript) return;
    const read = (suffix: string) => {
      const entry = sharedScript.entries.find((item) => item.path.endsWith(suffix));
      if (!entry) return undefined;
      const staged = sharedDraft?.[entry.path];
      return staged ? (staged.kind === 'reset' ? entry.default : staged.value) : entry.value;
    };

    const primaryColor = read('.primaryColor') ?? read('.primaryColour');
    const primaryShade = read('.primaryShade');
    const customTheme = read('.customTheme');
    // Currency belongs here for the same reason the theme does: a script's own
    // Studio page renders money, and hardcoding "$" in each one means a server
    // running on pounds has to be corrected in every script that shows a price.
    const currency = read('.currency');

    useSettings.setState({
      ...(typeof primaryColor === 'string' ? { primaryColor } : {}),
      ...(typeof primaryShade === 'number' ? { primaryShade } : {}),
      ...(Array.isArray(customTheme) && customTheme.length === 10
        ? { customTheme: customTheme as never }
        : {}),
      ...(typeof currency === 'string' && currency ? { currency } : {}),
      ...(language ? { language } : {}),
    });
  }, [sharedScript, sharedDraft, language]);
  const draft = useStudio((s) => s.draft[s.activeResource]) ?? {};

  const [activeGroup, setActiveGroup] = useState('');
  /** Sections whose sub-blocks are showing in the rail. */
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  /** The block currently being read, for the rail's sub-tree highlight. */
  const [activeSubgroup, setActiveSubgroup] = useState<string | null>(null);
  // the pinned bar only shows once the real heading has scrolled out of view,
  // otherwise you read the same title twice
  const [headingGone, setHeadingGone] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [pickerEntry, setPickerEntry] = useState<SettingEntry | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /**
   * The pane's real height, published as a CSS variable.
   *
   * A workspace control has to fill what is ACTUALLY there. Sizing it in `vh`
   * measures the viewport, and the panel is 84vh windowed — so a control asking
   * for a slice of the viewport overflows a window it knows nothing about, and
   * changing the panel's size silently breaks the arithmetic again.
   */
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const publish = () => {
      node.style.setProperty('--studio-pane', `${node.clientHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, activePage, fullScreen]);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // In game the panel is opened by dirk_lib; in a browser it should just be
  // there, which is how this gets reviewed without launching FiveM.
  useEffect(() => {
    if (typeof window !== 'undefined' && !(window as unknown as { invokeNative?: unknown }).invokeNative) {
      useStudio.setState({ open: true });
    }
  }, []);

  // OPEN_SCRIPT_STUDIO and SCRIPT_STUDIO_DATA are handled in live.ts at module
  // level (onStudioOpen / onStudioData), which also fetches the changelog and
  // test lists - they must work before this component mounts.

  useNuiEvent('CLOSE_SCRIPT_STUDIO', () => useStudio.setState({ open: false }));

  /**
   * A script started or stopped while the panel is open.
   *
   * Re-read rather than close. reloadFromServer keeps what is staged and where
   * you were, so a restart during an edit costs nothing - previously the only
   * way to see a restarted script was to close the panel and reopen it, which
   * threw away any unsaved work.
   *
   * The component cache is dropped for that resource first: a restart may be
   * serving a new build, and the cache is keyed by resource and path, so
   * without this the panel would keep rendering the module it imported before.
   */
  useNuiEvent<{ resource?: string }>('SCRIPT_STUDIO_RESOURCES_CHANGED', (data) => {
    if (data?.resource) {
      forgetComponents(data.resource);
      forgetLocales(data.resource);         // its locale files may be new too
    }
    void reloadFromServer();
  });

  const script = useMemo(
    () => scripts.find((s) => s.resource === activeResource) ?? scripts[0],
    [scripts, activeResource],
  );

  /**
   * The script's own page currently open, if any.
   *
   * Namespaced `page:<id>` so a script cannot collide with a built-in - a
   * resource declaring a page called "logs" should get its own, not dirk_lib's
   * server log.
   */
  const scriptPage = useMemo(
    () => (activePage?.startsWith('page:')
      ? script?.pages?.find((entry) => entry.id === activePage.slice(5))
      : undefined),
    [activePage, script],
  );

  /**
   * A page holding the whole window.
   *
   * Declaring `full` in `x-pages` gives a page PERMISSION to take the window;
   * it asks when it actually wants it. That split is the Designs tab: browsing
   * the gallery is an ordinary page beside the rail, and opening a design
   * grows this same window to the screen and folds the rail. Growing on
   * arrival instead makes browsing feel like a page inside a page.
   *
   * It is NOT the user's own full-screen setting - that stays whatever they
   * left it on, and this comes off when the page closes.
   */
  const [pageWantsFull, setPageWantsFull] = useState(false);
  useEffect(() => { if (!scriptPage) setPageWantsFull(false); }, [scriptPage]);
  const pageFull = !!scriptPage?.full && pageWantsFull;

  /**
   * The window is also given up to a script's own control that asked for it.
   *
   * Same idea as a page, for the other shape of thing that is not a settings
   * column: a workspace control (`x-componentFull`) can be a wall of cards or
   * a canvas, and those want the screen. It is the CONTROL that asks, not the
   * section, because a section holds several tabs and only one of them is the
   * wall - Backstories has its plain settings sitting beside it.
   */
  /**
   * Leaving a page swaps the content AT ONCE, then the box animates.
   *
   * Deferring it with startTransition left the page mounted while the panel
   * shrank, so a wall of cards reflowed its auto-fill grid every frame - five
   * columns down to two - with the rail and the header remounting over the top
   * of it. Swapping first means only the panel is moving, and what is inside
   * it is the settings column, which costs nothing to lay out.
   */
  const goBackFromPage = useCallback(() => {
    // Both in ONE update. Clearing the page and THEN handing the window back
    // is two renders, and in between the panel is still full-screen with the
    // settings column already in it - a flash of the rest of the panel at the
    // wrong size, right before it shrinks.
    setPageWantsFull(false);
    useStudio.setState({ activePage: null });
  }, []);

  /**
   * Opening the panel never drops you straight into a full-window page.
   *
   * The panel remembers where you were, which is right for a settings section
   * and for a gallery, and wrong for a page that takes the whole screen:
   * restart a resource, reopen the panel, and you are looking at a full-screen
   * wall with no sense of having asked for it. A page like that is somewhere
   * you GO.
   */
  useEffect(() => {
    if (!open) return;
    setPageWantsFull(false);
    const landing = useStudio.getState().activePage;
    if (!landing?.startsWith('page:')) return;
    const id = landing.slice(5);
    if (script?.pages?.find((entry) => entry.id === id)?.full) {
      useStudio.setState({ activePage: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * A section to land on once the script owning it is actually open.
   *
   * A global search result belongs to a script that is not selected yet, and
   * jumping in the same tick asks the CURRENT script for a section it does not
   * have - so the click opened the right script on its first section and
   * stopped there. Selecting is one render; jumping is the next.
   */
  const pendingJump = useRef<{ resource: string; group: string; list?: string; rowPath?: string; row?: number } | null>(null);
  /**
   * Bumped whenever `pendingJump` is set from outside the render that
   * consumes it.
   *
   * The consumer is an effect keyed on [script, visibleGroups, query], and
   * `pendingJump` is a REF - so setting it does not re-run anything. When the
   * request arrives after those have already settled (switching script from a
   * link, or from the screenshot hook), the effect had already run against a
   * null ref and never looked again.
   */
  const [jumpNonce, setJumpNonce] = useState(0);

  const query = deferredSearch.trim();

  const groupLabels = useMemo(
    () => new Map((script?.groups ?? []).map((g) => [
      g.id,
      translate(bundles, language, script?.resource ?? '', sectionKey(g.id, 'label'), g.label),
    ])),
    [script, bundles, language],
  );

  /** A group with its label and description resolved for the active language. */
  const localisedGroup = useCallback((group: SettingGroup): SettingGroup => ({
    ...group,
    label: translate(bundles, language, script?.resource ?? '', sectionKey(group.id, 'label'), group.label),
    description: group.description
      ? translate(bundles, language, script?.resource ?? '', sectionKey(group.id, 'description'), group.description)
      : undefined,
  }), [bundles, language, script]);

  // group id -> entries that survive the current search
  const byGroup = useMemo(() => {
    const map = new Map<string, SettingEntry[]>();
    for (const entry of script?.entries ?? []) {
      // published, not edited - see SettingEntry.hidden. It still travels, so a
      // control can read it; it just never draws a row of its own.
      if (entry.hidden) continue;
      if (!matchesSearch(entry, groupLabels.get(entry.group) ?? entry.group, query)) continue;
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return map;
  }, [script, groupLabels, query]);

  const populatedGroups = useMemo(
    () => (script?.groups ?? []).filter((g) => (byGroup.get(g.id)?.length ?? 0) > 0),
    [script, byGroup],
  );



  /**
   * Sections that ARE a workspace - a map, a script's own editor.
   *
   * These are not part of the reading flow. A control that fills the pane
   * cannot also flow with the page: scrolling would carry you through a whole
   * screen of map to reach the next toggle, and the map would fight the page
   * for the wheel. So they come out of the scroll entirely and are opened from
   * the rail instead, one at a time.
   */
  const workspaceGroups = useMemo(() => {
    const ids = new Set<string>();
    for (const group of populatedGroups) {
      const mine = byGroup.get(group.id) ?? [];
      // Declared outright, for a section that simply reads better as its own
      // place rather than because of what it contains.
      if (group.workspace) { ids.add(group.id); continue; }

      const workspaces = mine.filter((e) => controlSize(e.type) === 'workspace');
      // Dominated by one, not merely containing one: a section with a map and a
      // dozen settings still reads as settings.
      if (workspaces.length > 0 && mine.length - workspaces.length <= 2) ids.add(group.id);
    }
    return ids;
  }, [populatedGroups, byGroup]);

  /**
   * Matches the pane cannot show, as links.
   *
   * A workspace section is not in the scroll - it replaces it - so a match
   * inside one had nowhere to appear. The rail lit up and the pane said
   * nothing, and finding the thing meant clicking the section and then hunting
   * the tab. These name the row that matched, say where it is, and go there.
   *
   * Built AFTER the workspace set is known, so it lists exactly the sections
   * the filtered pane is going to leave out.
   */
  const searchLinks = useMemo(() => {
    const needle = query.trim();
    if (!needle || !script) return [];

    const out: SearchLink[] = [];
    for (const group of populatedGroups) {
      if (!workspaceGroups.has(group.id)) continue;

      const label = groupLabels.get(group.id) ?? group.label;
      for (const entry of byGroup.get(group.id) ?? []) {
        for (const hit of rowMatches(entry, needle)) {
          out.push({
            title: hit.title,
            section: label,
            tab: hit.tab,
            within: hit.within,
            icon: group.icon,
            /*
              Through `pendingJump`, the same road the cross-script results
              take — not a direct call.

              Two goes at this landed on Basic instead, because a direct jump
              skips the one thing that makes the existing links work: the effect
              that consumes `pendingJump` REFUSES to move while a search is
              still on (`if (query) return`). `deferredSearch` lags a render, so
              jumping immediately scrolls a pane that is still filtered, and it
              snaps back to the top the moment it unfilters.

              So: state the destination, clear the search, and let the effect
              fire it when the pane has actually settled. The list is carried
              along with it, which is the only thing this needed that the
              cross-script version did not.
            */
            go: () => {
              pendingJump.current = {
                resource: script.resource,
                group: group.id,
                // A MAP section's rail child is `MAP_CHILD`, not the entry's
                // own path — the map is one canvas shared by every polygon
                // layer, so it has a single identity rather than one per list.
                // Passing the path set `activeList` to something no tab could
                // ever match, the request sat there unconsumed, and the section
                // fell back to its Basic tab. That is the whole of "it went to
                // scrapyards/basic".
                list: entry.type === 'zones' ? MAP_CHILD : entry.path,
                // The ROW still belongs to its own layer, so this stays the
                // real path — ZoneMap matches its layers on it.
                rowPath: entry.path,
                // The result named a ROW, so land on the row - not the list it
                // happens to sit in, and not the section above that. Answered
                // by whichever editor owns the list, so it works the same on a
                // plain list and on a map.
                row: hit.index,
              };
              setJumpNonce((n) => n + 1);
              setSearch('');
            },
          });
        }
      }
    }
    // A screenful of "it is over there" is a list, not a hint.
    return out.slice(0, 6);
  }, [query, script, populatedGroups, workspaceGroups, byGroup, groupLabels]);

  /** The scrolling stack: everything that is not a workspace. */
  const visibleGroups = useMemo(
    () => populatedGroups.filter((g) => !workspaceGroups.has(g.id)),
    [populatedGroups, workspaceGroups],
  );

  /**
   * The nested blocks inside each section.
   *
   * The schema walk already tags every setting with the object it came from -
   * `yellowPages.businessAds` and `yellowPages.personalAds` are separate
   * subgroups of one section - and the section body already draws a labelled
   * divider between them. The rail was the only place that flattened it, so a
   * section with five blocks was one undifferentiated entry and a long scroll.
   */
  const subgroupsByGroup = useMemo(() => {
    const map = new Map<string, { id: string; label: string; count: number; list?: string }[]>();

    for (const [groupId, groupEntries] of byGroup) {
      // A section holding several LISTS already shows one at a time behind a
      // tab strip - fishing's Equipment is seven of them. Those tabs are the
      // section's real structure, so the rail names them: Equipment > Hooks,
      // rather than Equipment, then find the strip, then find the tab.
      const lists = groupEntries.filter(tabsAsList);
      const loose = groupEntries.filter((entry) => !tabsAsList(entry));
      const isWorkspace = workspaceGroups.has(groupId);

      // A workspace with a MAP and settings of its own is two places, not one
      // scrolling page. The layers stay together under a single Zones child —
      // splitting them would defeat the shared canvas.
      const mapLayers = groupEntries.filter((entry) => entry.type === 'zones');

      // A levelling curve is a PAGE, not a paragraph. Left among the loose
      // settings it sits under Basic with everything else and the chart beside
      // it gets a third of the width — so it comes out and gets its own child,
      // the same way the map does.
      const skillBlock = groupEntries.find((entry) => entry.subgroup?.skill);
      const skillLabel = skillBlock?.subgroup?.label;
      const isSkill = (entry: SettingEntry) => !!entry.subgroup?.skill;

      const looseSettings = loose.filter(
        (entry) => entry.type !== 'zones' && !isSkill(entry));

      if (isWorkspace && mapLayers.length > 0 && (looseSettings.length > 0 || skillBlock)) {
        // Every OTHER list in the section still gets its own place.
        //
        // This branch used to offer Basic and the map and nothing else, so a
        // workspace that had a map AND an ordinary list — barn finds, with its
        // locations on a canvas and its sellers in a table — simply lost the
        // table. It was in the config, saved fine, and was unreachable.
        const otherLists = lists.filter((entry) => entry.type !== 'zones');

        map.set(groupId, [
          {
            id: BASIC_CHILD,
            label: t('main.basic', 'Basic'),
            count: looseSettings.length,
            list: BASIC_CHILD,
          },
          ...otherLists.map((entry) => ({
            id: entry.path,
            label: entry.label,
            count: Array.isArray(entry.value) ? entry.value.length : 0,
            list: entry.path,
          })),
          // The curve, when this section has one.
          ...(skillBlock ? [{
            id: SKILL_CHILD,
            label: skillLabel ?? t('main.levels', 'Levels'),
            count: groupEntries.filter(isSkill).length,
            list: SKILL_CHILD,
          }] : []),
          {
            id: MAP_CHILD,
            // Named after what is ON the map when there is only one layer, so
            // a section of barn find Locations is not called Zones. Several
            // layers share one canvas and have no single name, so those keep
            // the generic one.
            label: mapLayers.length === 1
              ? mapLayers[0].label
              : t('main.zones', 'Zones'),
            count: mapLayers.reduce(
              (n, entry) => n + (Array.isArray(entry.value) ? entry.value.length : 0), 0),
            list: MAP_CHILD,
          },
        ]);
        continue;
      }

      // TWO or more lists, or a workspace whose ONE list has real settings
      // beside it.
      //
      // A single list with a toggle above it is genuinely one page, and naming
      // that Basic + the-list-again splits one screen for nothing. But once the
      // settings are substantial they crowd the list instead of introducing it,
      // and then each deserves its own place. Same rule as SectionBody's, and
      // the two have to agree: the body decided to show Basic while the rail
      // offered no way to reach it, so the section looked like it had no tabs.
      const splitWorkspace = isWorkspace && lists.length === 1 && loose.length > 1;

      if (lists.length >= 2 || splitWorkspace) {
        const children: { id: string; label: string; count: number; list?: string }[] = [];

        // A workspace's own settings are one of its places, so they get a name
        // and a row like every other. Without it the section's plain settings
        // were only reachable by clicking the parent, which reads as "go back"
        // rather than "go here".
        if (isWorkspace && loose.length > 0) {
          children.push({
            id: BASIC_CHILD,
            label: t('main.basic', 'Basic'),
            count: loose.length,
            list: BASIC_CHILD,
          });
        }

        for (const entry of lists) {
          children.push({
            id: entry.path,
            label: entry.label,
            count: Array.isArray(entry.value) ? entry.value.length : 0,
            list: entry.path,
          });
        }

        map.set(groupId, children);
        continue;
      }

      // Otherwise the nested blocks, which the section body already separates
      // with a labelled divider.
      const seen = new Map<string, { id: string; label: string; count: number }>();
      for (const entry of groupEntries) {
        if (!entry.subgroup) continue;
        const existing = seen.get(entry.subgroup.id);
        if (existing) existing.count += 1;
        else seen.set(entry.subgroup.id, { id: entry.subgroup.id, label: entry.subgroup.label, count: 1 });
      }
      if (seen.size > 0) map.set(groupId, [...seen.values()]);
    }
    return map;
  }, [byGroup, workspaceGroups, t]);

  /** The workspace section currently open, if any. */
  const openWorkspace = useMemo(
    () => (activeGroup && workspaceGroups.has(activeGroup)
      ? populatedGroups.find((g) => g.id === activeGroup)
      : undefined),
    [activeGroup, workspaceGroups, populatedGroups],
  );

  // per-group modified counts drive the rail dots
  const modifiedByGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of script?.entries ?? []) {
      if (entry.hidden) continue;
      if (!isModified(script!.resource, entry)) continue;
      map.set(entry.group, (map.get(entry.group) ?? 0) + 1);
    }
    return map;
  }, [script, draft]);

  useEffect(() => {
    setActiveGroup(visibleGroups[0]?.id ?? '');
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeResource]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setPickerOpen((o) => !o); return; }
      if (e.key !== 'Escape') return;
      if (pickerEntry || resetOpen || anyDialogOpen()) return;
      if (acctOpen) { setAcctOpen(false); return; }
      if (missOpen) { setMissOpen(false); return; }
      handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pickerEntry, resetOpen, acctOpen, missOpen]);
  useEffect(() => { setMissOpen(false); }, [open, activeResource, activePage]);

  // Opening a script from the rail, the tools grid or the picker. Clicking the
  // one already open closes it, the way a tab does, back to the overview -
  // except from the picker, where picking it means "take me there".
  const pickScript = (resource: string, fromPicker = false) => startTransition(() => {
    const state = useStudio.getState();
    const alreadyOpen = !state.activePage && state.activeResource === resource;
    useStudio.setState({
      activeResource: resource,
      activePage: alreadyOpen && !fromPicker ? 'home' : null,
      editingDesign: null,
    });
  });

  // The rail's Recent list: whatever script you actually open, not the shared layer.
  useEffect(() => {
    if (!open || activePage || !activeResource) return;
    if (scripts.find((entry) => entry.resource === activeResource)?.shared) return;
    noteRecent(activeResource);
  }, [open, activePage, activeResource, scripts]);

  const handleClose = () => {
    useStudio.setState({ open: false, searches: {} });
    fetchNui('CLOSE_SCRIPT_STUDIO');
  };

  // ── Virtualised sections ──────────────────────────────────────────────
  //
  // A script is up to ~20 sections holding ~100 inputs and ~270 list rows.
  // Mounting all of that on a switch is what made the click hang, and paging
  // one list only nibbled at it. The pane now renders ONE SECTION PER VIRTUAL
  // ROW, so cost tracks what is on screen rather than how big the script is.
  //
  // Heights vary wildly (a toggle vs a 56vh map), so sections are measured as
  // they render rather than estimated - the same wrong-estimate trap that
  // `content-visibility` fell into earlier.
  //
  // Sections are remembered once measured. Unmeasured ones fall back to a
  // constant, and that constant is only ever a rough placeholder - TanStack
  // memoises estimateSize's output, so a self-adjusting estimate never
  // actually reaches it. Accuracy comes from `forcedIndex` below instead.
  //
  // Keyed by script + section id rather than index, so it survives search
  // filtering and switching scripts - and two scripts that both have a
  // "general" section do not hand each other the wrong height.
  const sizeCache = useRef<Map<string, number>>(new Map());
  const sizeKey = (id: string) => `${activeResource}:${id}`;

  // The section a rail click is travelling to, force-rendered no matter where
  // the viewport is. Without this a long jump cannot land: the pane can only
  // scroll as far as the CURRENT total size allows, and that total is built
  // from estimates for everything unmeasured - so reaching a distant section
  // meant crawling down a screenful at a time, measuring as it went, and under
  // any real CPU load it simply ran out of frames before arriving. Rendering
  // the target immediately means it measures immediately, and one correction
  // puts it exactly under the heading.
  const [forcedIndex, setForcedIndex] = useState<number | null>(null);

  // The section being measured in the background. Mounting the whole script at
  // once costs seconds - measured, not guessed - so the pane cannot simply
  // render everything. But an unmeasured section is one a rail click cannot
  // reliably reach, so the heights get collected anyway: one section per idle
  // tick, off-screen, after the panel has settled. It is invisible, it stops as
  // soon as every height is known, and by the time anyone reaches for the rail
  // the offsets are real numbers rather than estimates.
  const [warmIndex, setWarmIndex] = useState<number | null>(null);

  // Sections kept mounted beyond the scroll window: the few most recently
  // visited, plus whatever the pointer is currently resting on in the rail.
  //
  // Mounting one section is a single 250ms-1s task - it is the destination
  // rendering, not the scroll, that made a rail click feel heavy. Hovering a
  // rail item starts that work while the pointer is still travelling to the
  // click, so by the time the button is pressed there is nothing left to do.
  // Capped at four so search still only ever filters a handful of sections.
  const [pinned, setPinned] = useState<number[]>([]);
  const hoverTimer = useRef<number | undefined>(undefined);

  // How tall the scrolling pane is, so the tail spacer below the list can be
  // sized. Measured rather than assumed: the panel is sized in vh and the
  // window is whatever the player's screen is.
  const [viewHeight, setViewHeight] = useState(0);

  const pinSection = useCallback((index: number) => {
    setPinned((prev) => (prev[0] === index ? prev : [index, ...prev.filter((i) => i !== index)].slice(0, 4)));
  }, []);

  // A pointer sweeping down the rail should not mount everything it passes.
  const prefetchSection = useCallback((index: number) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => pinSection(index), 120);
  }, [pinSection]);

  const cancelPrefetch = useCallback(() => clearTimeout(hoverTimer.current), []);

  const jumpAnim = useRef<number | null>(null);
  /** The lighter watch that keeps a finished jump in place - see `hold`. */
  const holdAnim = useRef<number | null>(null);
  const jumping = useRef(false);

  const virtualizer = useVirtualizer({
    count: visibleGroups.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const id = visibleGroups[index]?.id;
      return (id && sizeCache.current.get(sizeKey(id))) || 700;
    },
    overscan: 2,
    // offsetHeight, NOT getBoundingClientRect: the panel animates scale 0.97 -> 1
    // on open, and a rect measured mid-animation is 3% short - which across a
    // ~18,000px list is a 500px error baked into the cache.
    measureElement: (el) => {
      const height = (el as HTMLElement).offsetHeight;
      const id = (el as HTMLElement).dataset.groupId;
      if (id && height > 0) sizeCache.current.set(sizeKey(id), height);
      return height;
    },
    getItemKey: (index) => visibleGroups[index]?.id ?? index,
    rangeExtractor: (range) => {
      const base = defaultRangeExtractor(range);
      const extra = [forcedIndex, warmIndex, ...pinned].filter(
        (index): index is number => index !== null && index < visibleGroups.length && !base.includes(index),
      );
      if (extra.length === 0) return base;
      return [...new Set([...base, ...extra])].sort((a, b) => a - b);
    },
  });

  const items = virtualizer.getVirtualItems();

  // Same deps as the scroll listener below, and for the same reason: a
  // workspace or a full page replaces the pane, so the element this measures
  // is a different one each time.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const read = () => setViewHeight(container.clientHeight);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(container);
    return () => observer.disconnect();
  }, [open, activePage, openWorkspace?.id]);

  // Which section is being read: the last one starting above the fold. Comes
  // from measurements the virtualiser already holds, so no layout reads here.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || visibleGroups.length === 0) return;

    const onScroll = () => {
      // a rail jump drives scrollTop itself; letting this run mid-glide would
      // flick the rail highlight through every section on the way past
      if (jumping.current) return;
      const threshold = container.scrollTop + 90;
      const measured = virtualizer.getVirtualItems();
      let current = visibleGroups[0]?.id ?? '';
      for (const item of measured) {
        if (item.start <= threshold) current = visibleGroups[item.index]?.id ?? current;
      }
      if (current) setActiveGroup((prev) => (prev === current ? prev : current));

      // the pinned bar appears once the real heading has scrolled past
      const active = measured.find((item) => visibleGroups[item.index]?.id === current);
      setHeadingGone(active ? active.start + 44 < container.scrollTop : false);

      // ...and which BLOCK inside it, so the rail's sub-tree follows the scroll
      // the same way the section list does. Read from the DOM rather than the
      // virtualiser, which only knows about whole sections.
      const anchors = container.querySelectorAll<HTMLElement>('[data-subgroup]');
      let block: string | null = null;
      const top = container.getBoundingClientRect().top + 90;
      for (const node of anchors) {
        if (node.getBoundingClientRect().top <= top) block = node.dataset.subgroup ?? block;
      }
      setActiveSubgroup((prev) => (prev === block ? prev : block));
    };

    onScroll();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
    // These are deps because they decide whether the scroller EXISTS. Without
    // them this effect ran once, found scrollRef empty because the pane had not
    // mounted yet, bailed, and never re-ran - so the rail silently stopped
    // following the scroll position.
    //
    // A WORKSPACE is the third of them: it replaces the scrolling stack, so
    // leaving one mounts a brand new scroller while this listener was still
    // attached to the old, detached one. Everything looked fine and nothing
    // highlighted.
  }, [virtualizer, visibleGroups, open, activePage, openWorkspace?.id]);

  // Walk the unmeasured sections, one per idle tick, and let the virtualiser
  // measure each as it mounts. Yields to anything the user is doing: it stands
  // down while a jump is in flight and restarts from wherever it got to.
  useEffect(() => {
    if (!open || activePage || visibleGroups.length === 0) return;

    let cancelled = false;
    let index = 0;
    let timer: number | undefined;
    let idle: number | undefined;

    const step = () => {
      if (cancelled) return;
      if (jumping.current) return schedule();

      while (index < visibleGroups.length && sizeCache.current.has(sizeKey(visibleGroups[index]!.id))) index += 1;
      if (index >= visibleGroups.length) return setWarmIndex(null);

      setWarmIndex(index);
      index += 1;
      schedule();
    };

    // Two frames per section: one to mount it, one for its measurement to land.
    // Queued behind whatever else the browser is doing, so warming never
    // competes with typing or scrolling - the timeout only stops it stalling
    // forever on a busy page.
    const schedule = () => {
      const run = () => requestAnimationFrame(() => requestAnimationFrame(step));
      const onIdle = window.requestIdleCallback;
      if (onIdle) idle = onIdle.call(window, run, { timeout: 600 });
      else timer = window.setTimeout(run, 120);
    };

    // Not straight away: the first seconds after an open belong to the open
    // itself (the fresh values landing, the first sections painting).
    const start = window.setTimeout(schedule, 2000);
    return () => {
      cancelled = true;
      clearTimeout(start);
      if (timer) clearTimeout(timer);
      if (idle) window.cancelIdleCallback?.(idle);
      setWarmIndex(null);
    };
  }, [open, activePage, activeResource, visibleGroups]);

  /**
   * Jump the pane to a section.
   *
   * NOT `virtualizer.scrollToIndex`. That aims at an offset built from
   * estimates and re-aims every frame as sections measure; with CSS
   * `scroll-behavior: smooth` each re-aim restarted a fresh glide, so the pane
   * chased a moving target and visibly never arrived.
   *
   * Two phases. The glide is the visible motion, aimed at the virtualiser's
   * offset. The settle then stops trusting that model and corrects against
   * where the section's element ACTUALLY is - which is the only number that
   * cannot be wrong, and the one that matters on a first visit when nothing
   * below has been measured yet.
   */
  // jumpTo re-enters itself after closing a page, so it reaches its own latest
  // identity through a ref rather than listing itself as a dependency
  const jumpToRef = useRef<(groupId: string, subgroupId?: string, keepList?: boolean) => void>(() => {});
  const jumpToSubgroupRef = useRef<(groupId: string, subgroupId: string, listPath?: string) => void>(() => {});

  /**
   * Scroll to a sub-block within its section.
   *
   * Handed to the SAME jump the rail uses rather than running a scroll of its
   * own. A second `scrollIntoView` on top of that glide meant two animations
   * pulling the container in different directions on the same frames, which
   * read as a twitch and then nothing.
   */
  const jumpToSubgroup = useCallback((groupId: string, subgroupId: string, listPath?: string) => {
    // A list is selected, not scrolled to - what the section shows is swapped,
    // so there is no separate anchor to land on.
    if (listPath) {
      // `keepList` below matters: selecting the SECTION clears the child, which
      // is what makes the parent mean "the section itself" - and this jump goes
      // through that same code, so without it a child click wiped the very
      // selection it had just made and nothing happened.
      useStudio.setState({ activeList: listPath === BASIC_CHILD ? null : listPath });
      jumpToRef.current(groupId, undefined, true);
      return;
    }
    {
      // Highlight it NOW rather than waiting for the scroll handler. That
      // handler stands down while a jump is in flight - otherwise the rail
      // would flick through every block on the way past - so after a click
      // nothing marked the destination until you happened to scroll by hand.
      setActiveSubgroup(subgroupId);
    }
    jumpToRef.current(groupId, listPath ? undefined : subgroupId);
  }, []);

  /** Bounds the re-jump when the scroll pane has to be remounted first. */
  const jumpRetry = useRef(0);
  /** Bounds the wait for a just-selected script's sections to arrive. */
  const missRetry = useRef(0);

  // A field asking to be taken to another script's setting. Same path a
  // search result takes - switch script, drop the page, queue the scroll.
  const goToRequest = useStudio((s) => s.goToRequest);
  useEffect(() => {
    if (!goToRequest) return;
    const { resource, group, page } = goToRequest;
    // A page target (Logs, Admins, Bridges) is not a settings section, so there
    // is nothing to scroll to - opening it IS the destination.
    useStudio.setState({ activeResource: resource, activePage: page ?? null, goToRequest: null });
    setSearch('');
    if (!page && group) {
      pendingJump.current = { resource, group };
      setJumpNonce((n) => n + 1);
    }
  }, [goToRequest]);

  const jumpTo = useCallback((groupId: string, subgroupId?: string, keepList?: boolean) => {
    // Picking a section opens its sub-tree. Having to hit the chevron
    // specifically made the tree feel like a separate control rather than part
    // of the thing you just selected.
    setOpenGroups((prev) => (prev.has(groupId) ? prev : new Set(prev).add(groupId)));

    // A workspace section is not IN the scroll - it replaces it. Selecting one
    // is a switch, not a jump, and there is nothing to scroll to.
    if (workspaceGroups.has(groupId)) {
      startTransition(() => {
        // Clearing the child selection is what makes picking the parent mean
        // "the section itself" - its own settings - rather than whichever of
        // its lists you happened to be in last.
        useStudio.setState(keepList
          ? { activePage: null, editingDesign: null }
          : { activePage: null, editingDesign: null, activeList: null, shownList: null });
        setActiveGroup(groupId);
      });
      return;
    }

    const index = visibleGroups.findIndex((group) => group.id === groupId);
    if (index < 0) {
      // The section may belong to a script that has only just been selected,
      // so its groups are not in hand yet. This used to give up, and the click
      // landed you on that script's first section instead - you had to click
      // the one you wanted a second time. Wait a frame and look again.
      if (missRetry.current >= 20) { missRetry.current = 0; return; }
      missRetry.current += 1;
      requestAnimationFrame(() => jumpToRef.current(groupId, subgroupId));
      return;
    }
    missRetry.current = 0;

    // A full page (Design, Bridges, …) replaces the settings pane entirely, so
    // its scroll container is not mounted and the jump below has nothing to
    // scroll — the click used to die here. Close the page, then jump once React
    // has put the pane back.
    if (useStudio.getState().activePage) {
      useStudio.setState({ activePage: null, editingDesign: null });
      requestAnimationFrame(() => requestAnimationFrame(() => jumpToRef.current(groupId, subgroupId)));
      return;
    }

    const container = scrollRef.current;
    if (!container) {
      // Same shape as the page case above: a WORKSPACE section also replaces
      // the scrolling stack, so while one is open there is no container to
      // scroll and the click for any other section died here silently. Switch
      // away from the workspace first, then jump once the pane is back.
      //
      // The retry is bounded - if the container still is not there, something
      // else is wrong and looping frame after frame would only hide it.
      if (jumpRetry.current >= 2) { jumpRetry.current = 0; return; }
      jumpRetry.current += 1;
      setActiveGroup(groupId);
      requestAnimationFrame(() => requestAnimationFrame(() => jumpToRef.current(groupId, subgroupId)));
      return;
    }
    jumpRetry.current = 0;

    setActiveGroup(groupId);
    if (jumpAnim.current !== null) cancelAnimationFrame(jumpAnim.current);
    if (holdAnim.current !== null) cancelAnimationFrame(holdAnim.current);
    jumping.current = true;
    setForcedIndex(index);
    pinSection(index);
    // The LAST section too, because the tail spacer is sized from its height
    // and a jump can only travel as far as the road that exists. Unmeasured,
    // there is no spacer, the final screenful of scroll does not exist yet,
    // and a jump to the end of the list stops short - then the background
    // measuring pass (which stands down while a jump is in flight) adds the
    // room a moment later with nothing left running to use it.
    pinSection(visibleGroups.length - 1);

    const from = container.scrollTop;
    const startedAt = performance.now();
    const SETTLE = 1500;
    const pad = parseFloat(getComputedStyle(container).paddingTop) || 0;

    const clamp = (offset: number) =>
      Math.min(Math.max(0, offset), Math.max(0, container.scrollHeight - container.clientHeight));

    const modelOffset = () => clamp(virtualizer.getOffsetForIndex(index, 'start')?.[0] ?? from);
    const initialTarget = modelOffset;

    /**
     * How far the target is from where it should sit, or null if unrendered.
     *
     * The target is the SUB-BLOCK when one was asked for, and the section
     * otherwise. The coarse aim above is always the section - the virtualiser
     * only knows section indices - and this correction walks the last bit,
     * which is exactly the settle loop's job already.
     */
    const realDelta = () => {
      const el = (subgroupId
        && container.querySelector<HTMLElement>(`[data-subgroup="${CSS.escape(subgroupId)}"]`))
        || container.querySelector<HTMLElement>(`[data-group-id="${CSS.escape(groupId)}"]`);
      if (!el) return null;
      return el.getBoundingClientRect().top - container.getBoundingClientRect().top - pad;
    };

    // Gliding means physically scrolling THROUGH everything in between, and
    // every frame of that mounts and unmounts whatever the window passes over -
    // which on a 16,000px trip is the entire script, seventeen times. So the
    // glide is kept for short hops, where it reads as connected movement and
    // costs almost nothing, and long jumps cut straight there.
    const glide = Math.abs(initialTarget() - from) <= container.clientHeight * 1.5 ? 240 : 0;

    /**
     * Keep the landing while the rest of the list is still measuring.
     *
     * The jump has to LET GO before the background measuring pass will run at
     * all - that pass stands down while a jump is in flight - and it is the
     * pass that finally replaces the 700px estimate for every section ABOVE
     * the target with a real height. Each one that changes moves the target
     * with it, so a jump that landed perfectly slid most of a screen out of
     * place a moment after it finished, and the rail highlight went with it.
     *
     * So this watches for the list resizing and puts the target back. It only
     * acts on a resize, it gives up the moment the user scrolls themselves,
     * and it is over in a couple of seconds.
     */
    const hold = (from: number) => {
      let height = container.scrollHeight;
      let mine = container.scrollTop;
      const until = from + 2500;
      const watch = (now: number) => {
        if (now > until) { holdAnim.current = null; return; }
        // The resize is checked FIRST, and the "did the user take over" test
        // only runs on a frame where nothing resized. The browser's own scroll
        // anchoring nudges scrollTop when content above changes - a couple of
        // hundred pixels of it here - and reading that as a hand on the wheel
        // is what made this watch give up on the exact frame it existed for.
        if (container.scrollHeight !== height) {
          height = container.scrollHeight;
          const drift = realDelta();
          if (drift !== null && Math.abs(drift) >= 1) container.scrollTop = clamp(container.scrollTop + drift);
          mine = container.scrollTop;
        } else if (Math.abs(container.scrollTop - mine) > 2) {
          holdAnim.current = null;
          return;
        }
        holdAnim.current = requestAnimationFrame(watch);
      };
      holdAnim.current = requestAnimationFrame(watch);
    };

    let settled = 0;
    // The list keeps resizing under the jump. Every section that swaps its
    // 700px estimate for a real height moves everything below it - the target
    // included - and the background warming pass carries on doing that for a
    // second or two after the jump has "finished". Landing before that stops
    // means landing on a number that is about to change, which is how a jump
    // to the far end of a long script arrived a screen and a half short.
    //
    // So the settle is not on a fixed clock: any change in the scroll height
    // reopens the window, up to a hard ceiling so a script that never stops
    // measuring cannot hold the pane forever.
    const CEILING = 6000;
    let lastHeight = container.scrollHeight;
    let deadline = startedAt + glide + SETTLE;

    const step = (now: number) => {
      const elapsed = now - startedAt;

      const height = container.scrollHeight;
      if (height !== lastHeight) {
        lastHeight = height;
        settled = 0;
        deadline = Math.min(now + SETTLE, startedAt + glide + CEILING);
      }

      if (elapsed < glide) {
        const t = elapsed / glide;
        container.scrollTop = from + (modelOffset() - from) * (1 - (1 - t) ** 3);
        jumpAnim.current = requestAnimationFrame(step);
        return;
      }

      const delta = realDelta();
      if (delta === null) {
        // still outside the rendered window - keep pushing at the model
        container.scrollTop = modelOffset();
        settled = 0;
      } else {
        if (Math.abs(delta) >= 1) {
          container.scrollTop = clamp(container.scrollTop + delta);
          settled = 0;
        } else {
          settled += 1;
        }
      }

      if (settled >= 3 || now > deadline) {
        jumpAnim.current = null;
        jumping.current = false;
        setForcedIndex(null);
        setHeadingGone(false);
        hold(now);
        return;
      }
      jumpAnim.current = requestAnimationFrame(step);
    };

    jumpAnim.current = requestAnimationFrame(step);
  }, [virtualizer, visibleGroups, pinSection]);

  // Land on the section a global search result named, once its script is the
  // one on screen. `visibleGroups` is what proves that: it is derived from the
  // active script, so the moment it contains the target the pane is showing
  // that script and the anchor exists to scroll to.
  //
  // A REF rather than state, and cleared BEFORE the frame is asked for. Held
  // as state, clearing it re-ran this effect, and the re-run's cleanup
  // cancelled the very frame that was about to do the jump - so nothing
  // happened at all, and the click looked like it had merely opened the
  // script.
  useEffect(() => {
    const want = pendingJump.current;
    if (!want) return;
    if (script?.resource !== want.resource) return;
    // The search is cleared on the same click, but `deferredSearch` lags a
    // render - so jumping straight away scrolled a list that was still
    // filtered, and the pane snapped back when it unfiltered a tick later.
    if (query) return;
    // `populatedGroups`, NOT `visibleGroups`.
    //
    // `visibleGroups` is `populatedGroups` with the workspaces filtered OUT -
    // they are not in the scroll, they replace it - so this guard could never
    // pass for a workspace target and the jump simply never happened. You
    // clicked a result and stayed wherever you were, which read as the link
    // going to Basic.
    //
    // The guard is only here to prove the script on screen is the right one.
    // A workspace needs no anchor to scroll to; `jumpTo` switches to it.
    if (!populatedGroups.some((group) => group.id === want.group)) return;

    pendingJump.current = null;
    // Two frames: the pane has just gone from one section to all of them, and
    // the virtualiser measures on the frame after that.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // A list was named, so land IN it rather than on the section — a
        // workspace opens on whichever of its lists you were last in
        // otherwise, which is not where the result was.
        if (want.list) jumpToSubgroupRef.current(want.group, want.list, want.list);
        else jumpToRef.current(want.group);

        // Asked for AFTER the section switch, so the editor that answers it is
        // mounted by the time it looks. Both row editors watch this; whichever
        // owns the list picks it up and the other ignores it.
        if (want.rowPath && want.row !== undefined) {
          useStudio.setState({ openRowRequest: { path: want.rowPath, index: want.row } });
        }
      });
    });
  }, [script, visibleGroups, populatedGroups, query, jumpNonce]);

  jumpToRef.current = jumpTo;
  // Through a ref for the same reason `jumpTo` is: the search links are built
  // above where `jumpToSubgroup` is defined, and a link is only ever called
  // after render anyway.
  jumpToSubgroupRef.current = jumpToSubgroup;

  useEffect(() => () => {
    if (jumpAnim.current !== null) cancelAnimationFrame(jumpAnim.current);
    // MUST clear the flag, not just the frame. onScroll ignores events while a
    // jump is in flight, so a jump interrupted by leaving the pane (clicking a
    // page, switching script) left it stuck true and the rail stopped tracking
    // the scroll position entirely until a reload.
    jumping.current = false;
  }, []);

  // Same hazard when the pane itself remounts: the flag outlives the animation.
  useEffect(() => {
    jumping.current = false;
  }, [activeResource, activePage]);

  // Stable per-entry handler, otherwise memo(SettingRow) never hits and every
  // keystroke re-renders all ~108 rows.
  const openPicker = useCallback((entry: SettingEntry) => setPickerEntry(entry), []);

  const dirty = script ? dirtyCount(script.resource) : 0;
  // Recomputed whenever the draft moves, so an error clears as it is fixed
  // rather than at the next save attempt.
  const draftForScript = useStudio((state) => (script ? state.draft[script.resource] : undefined));
  const problems = useMemo(
    () => (script ? problemsFor(script.resource) : []),
    [script, draftForScript],
  );
  const problemsByPath = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const problem of problems) {
      const list = map.get(problem.path) ?? [];
      list.push(problem.message);
      map.set(problem.path, list);
    }
    return map;
  }, [problems]);

  const undoDepth = useStudio((state) => (script ? state.undoStack[script.resource]?.length ?? 0 : 0));
  const redoDepth = useStudio((state) => (script ? state.redoStack[script.resource]?.length ?? 0 : 0));

  if (!script) return null;

  // The window is a grid of separate plates (lib kit, 24/10): top bar, rail,
  // page and save bar each float over the game on their own, with nothing
  // square painted behind them. A full-window page IS the window and gets the
  // one cell; the design editor drops the rail; pages drop the save bar.
  const wide = fullScreen || pageFull;
  const winClass = 'ss-win'
    + (pageFull ? ' bare' : '')
    + (!pageFull && editingDesign ? ' noRail' : '')
    + (activePage || pageFull ? ' noSave' : '')
    + (dialogOpen ? ' modal' : '')
    + (pickerOpen ? ' picking' : '')
    + (acctOpen || missOpen ? ' acct' : '');

  if (!everOpen.current) return null;

  return (
    <div className={'dk ss' + (wide ? ' wide' : '') + (open ? '' : ' shut')} style={accent}>
      <div className="ss-dim" style={{ visibility: activeTool ? 'hidden' : undefined }} />
      <div
        className={winClass}
        // Named so a page that needs the GAME visible behind it - the intro
        // editor's live view - can step the panel aside without closing it.
        data-studio-panel
        // Hidden, not unmounted: staged edits, scroll position and the open
        // modal all have to survive walking across the map.
        style={{ visibility: activeTool ? 'hidden' : undefined }}
      >
        {!pageFull && (
          <TopBar
            query={search}
            onQuery={setSearch}
            searchable={SEARCHABLE_PAGES.has(activePage ?? '') || !activePage || activePage === 'home'}
            placeholder={activePage === 'items' ? t('main.search_items', 'Search items...')
              : activePage === 'vehicles' ? t('main.search_vehicles', 'Search vehicles...')
                : activePage && activePage !== 'home' ? t('main.search_settings', 'Search these settings...')
                  : !activePage ? t('main.search_script', 'Search {0}...').replace('{0}', script.label)
                    : t('main.search_everything', 'Search every setting...')}
            onClose={handleClose}
            canEdit={canEdit}
            missingItems={activePage ? undefined : <MissingItemsButton script={script} open={missOpen} onOpen={setMissOpen} />}
            account={<AccountChip live={open} open={acctOpen} onOpen={setAcctOpen} />}
            switcher={(
              <ScriptSwitch
                scripts={scripts}
                script={script}
                activePage={activePage}
                open={pickerOpen}
                onOpen={() => setPickerOpen((o) => !o)}
              />
            )}
          />
        )}

        {/* The rail drops ONLY while a design is open in the editor: the canvas
            is the one thing that genuinely needs the width. */}
        {!editingDesign && !pageFull && (
          <Rail
            scripts={scripts}
            script={script}
            groupLabels={groupLabels}
            visibleGroups={populatedGroups}
            byGroup={byGroup}
            modifiedByGroup={modifiedByGroup}
            activeGroup={activeGroup}
            activePage={activePage}
            onPickScript={pickScript}
            onPickPage={(id) => startTransition(() => useStudio.setState({ activePage: id, editingDesign: null }))}
            onPickGroup={jumpTo}
            onPickSubgroup={jumpToSubgroup}
            subgroupsByGroup={subgroupsByGroup}
            openGroups={openGroups}
            activeSubgroup={activeSubgroup}
            shownList={shownList}
            setOpenGroups={setOpenGroups}
            onHoverGroup={prefetchSection}
            onLeaveGroup={cancelPrefetch}
            onOpenPicker={() => setPickerOpen((o) => !o)}
          />
        )}

        <main className="ss-main">
          {/* Opened from memory: what is shown is last time's, the fresh values
              are on their way and saves wait for them. Says so, quietly. */}
          {!fresh && (
            <div className="pl ss-ld edge in">
              <div className="sk"><span className="L">{t('main.loading_latest', 'Loading latest...')}</span><Segs n={8} frac={1} /></div>
            </div>
          )}
                {/* A search typed while standing on a page searches EVERY
                    script. Overview is where you land, and the search box did
                    nothing there - which is the one moment you are most likely
                    to be looking for a setting whose owner you cannot name.
                    Inside a script's settings the box still filters that
                    script, which is what you mean there - until that script has
                    NO match, which used to leave an empty pane while the thing
                    being looked for sat in the script next door. */}
                {(activePage || (query && populatedGroups.length === 0)) && query ? (
                  <SearchResults
                    query={query}
                    onOpen={(resource, group, target) => {
                      useStudio.setState({ activeResource: resource, activePage: null });
                      setSearch('');
                      // Same shape the in-script cards build, including the
                      // MAP_CHILD rule - a map section's rail child is not its
                      // entry path, and getting that wrong is what left every
                      // one of these landing on the section's Basic tab.
                      const entry = target
                        ? scripts.find((s) => s.resource === resource)
                          ?.entries.find((e) => e.path === target.list)
                        : undefined;
                      pendingJump.current = target
                        ? {
                          resource,
                          group,
                          list: entry?.type === 'zones' ? MAP_CHILD : target.list,
                          rowPath: target.list,
                          row: target.row,
                        }
                        : { resource, group };
                      setJumpNonce((n) => n + 1);
                    }}
                  />
                ) : activePage === 'home' ? <HomePage onOpenPicker={() => setPickerOpen(true)} />
                  : activePage === 'bridges' ? <BridgesPage />
                  : activePage === 'admins' ? <AdminsPage canEdit={canEdit} />
                  : activePage === 'logs' ? <LogsPage canEdit={canEdit} />
                  : activePage === 'items' ? <CataloguePage kind="items" query={query} />
                  : activePage === 'vehicles' ? <CataloguePage kind="vehicles" query={query} />
                  : activePage === 'changelog' ? <ChangelogPage resource={activeResource} />
                  : activePage === 'tests' ? <TestsPage resource={activeResource} />
                  : activePage === 'minigames' ? <MinigamesPage />
                  : scriptPage ? (
                    <ScriptPage
                      resource={script.resource}
                      page={scriptPage}
                      canEdit={canEdit}
                      onBack={goBackFromPage}
                      full={pageFull}
                      setFull={setPageWantsFull}
                      // A page that declares a path is a LIST: it gets the
                      // entry, and the settings that belong with it, so it
                      // keeps the row editor and the save bar.
                      entry={scriptPage.path
                        ? script.entries.find((e) => e.path === scriptPage.path)
                        : undefined}
                      settings={scriptPage.path && scriptPage.settings
                        ? script.entries
                          .filter((e) => scriptPage.settings!.some(
                            (prefix) => e.path === prefix || e.path.startsWith(`${prefix}.`),
                          ))
                          .map((e) => ({
                            path: e.path,
                            label: e.label,
                            node: (
                              <SettingRow
                                key={e.path}
                                resource={script.resource}
                                entry={e}
                                query=""
                                canEdit={canEdit}
                                problems={problemsByPath.get(e.path)}
                                onDrill={openPicker}
                              />
                            ),
                          }))
                        : undefined}
                    />
                  )
                  : activePage ? (
                  <Flex align="center" justify="center" style={{ flex: 1 }}>
                    <Text ff="Akrobat Bold" size="sm" c="rgba(255,255,255,0.35)">
                      {activePage} page is not built yet
                    </Text>
                  </Flex>
                ) : openWorkspace ? (
                  // A workspace section REPLACES the scrolling stack. It fills
                  // the pane, the page does not scroll behind it, and the wheel
                  // belongs to the map rather than being fought over. You leave
                  // it by picking something else in the rail.
                  <Flex direction="column" flex={1} p="md" style={{ minHeight: 0, overflow: 'hidden' }}>
                    <SectionHeading
                      icon={openWorkspace.icon}
                      label={localisedGroup(openWorkspace).label}
                      description={openWorkspace.description ? localisedGroup(openWorkspace).description : undefined}
                      style={{ marginBottom: '1vh', flexShrink: 0 }}
                    />

                    <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
                      <SectionBody
                        resource={script.resource}
                        entries={byGroup.get(openWorkspace.id) ?? []}
                        query={query}
                        railDriven
                        renderRow={(entry, rowFilter, fill) => (
                          <SettingRow
                            resource={script.resource}
                            entry={entry}
                            query={query}
                            rowFilter={rowFilter}
                            fill={fill}
                            canEdit={canEdit}
                            problems={problemsByPath.get(entry.path)}
                            onDrill={openPicker}
                          />
                        )}
                      />
                    </Flex>
                  </Flex>
                ) : (<>
                <CurrentSection
                  group={(() => {
                    const found = visibleGroups.find((g) => g.id === activeGroup) ?? visibleGroups[0];
                    return found ? localisedGroup(found) : undefined;
                  })()}
                  show={headingGone}
                />

                <Flex
                  ref={scrollRef as never}
                  className="studio-scroll"
                  direction="column"
                  flex={1}
                  gap="xl"
                  p="md"
                  style={{
                    overflowY: 'auto',
                    minHeight: 0,
                    position: 'relative',
                    scrollPaddingTop: '1.2vh',
                    // no `scrollBehavior: smooth` - jumpTo animates scrollTop
                    // itself, and the CSS glide fought every correction
                  }}
                >
                  <SearchLinks links={searchLinks} />

                  {visibleGroups.length === 0 && searchLinks.length === 0 && (
                    <Flex direction="column" align="center" justify="center" gap="xs" style={{ flex: 1, paddingTop: '18vh' }}>
                      <Search size="3vh" color="rgba(255,255,255,0.18)" />
                      <Text ff="Akrobat Bold" size="sm" c="rgba(255,255,255,0.4)">
                        Nothing matches "{query}"
                      </Text>
                      <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.25)">
                        {t('main.search_covers_names_paths_descriptions_a', 'Search covers names, paths, descriptions and options.')}
                      </Text>
                    </Flex>
                  )}

                  <Flex
                    direction="column"
                    style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}
                  >
                  {items.map((item) => {
                    const group = visibleGroups[item.index];
                    if (!group) return null;
                    return (
                    <Flex
                      key={group.id}
                      ref={((el: HTMLDivElement | null) => {
                        sectionRefs.current[group.id] = el;
                        if (el) virtualizer.measureElement(el);
                      }) as never}
                      data-index={item.index}
                      data-group-id={group.id}
                      direction="column"
                      gap="xs"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${item.start}px)`,
                        paddingBottom: '3vh',
                      }}
                    >
                      <SectionHeading
                        icon={group.icon}
                        label={localisedGroup(group).label}
                        description={group.description ? localisedGroup(group).description : undefined}
                      />

                      <SectionBody
                        resource={script.resource}
                        entries={byGroup.get(group.id) ?? []}
                        query={query}
                        renderRow={(entry, rowFilter) => (
                          <SettingRow
                            resource={script.resource}
                            entry={entry}
                            query={query}
                            rowFilter={rowFilter}
                            canEdit={canEdit}
                            problems={problemsByPath.get(entry.path)}
                            onDrill={openPicker}
                          />
                        )}
                      />

                      {/* Anything a schema walk cannot produce for this block */}
                      {(() => {
                        const Extra = SECTION_EXTRAS[`${script.resource}:${group.id}`];
                        return Extra ? <Extra resource={script.resource} canEdit={canEdit} /> : null;
                      })()}
                    </Flex>
                    );
                  })}
                  </Flex>

                  {/* Room past the end, so the LAST sections can reach the top.
                      Without it a script's final one or two sections physically
                      cannot be scrolled under the heading - there is nothing
                      below them to scroll - so a rail click or a search result
                      landed as far down as the pane would go and the highlight
                      settled on whichever section happened to be nearest the
                      top instead. It read as "the link goes to the wrong
                      place"; the link was right and the pane was out of road.

                      Sized to exactly the shortfall: viewport minus the last
                      section, so at the bottom of the scroll that section sits
                      at the top and nothing further is blank. */}
                  {(() => {
                    const last = visibleGroups[visibleGroups.length - 1];
                    const height = last && sizeCache.current.get(sizeKey(last.id));
                    if (!height || viewHeight === 0) return null;
                    const room = Math.max(0, viewHeight - height);
                    return room > 0 ? <Flex style={{ height: room, flexShrink: 0 }} /> : null;
                  })()}

                </Flex>

                </>)}

        </main>

        {!activePage && !pageFull && <SaveBar
                  dirty={dirty}
                  saving={saving}
                  saveError={saveError && saveError.resource === script.resource ? saveError.message : null}
                  saved={!!saved && saved.resource === script.resource}
                  canEdit={canEdit}
                  problems={problems}
                  onShowProblem={(problem) => {
                    // Take me to the actual field. A problem path is either a
                    // plain setting or one row of a list - `fish[27].waterTypes`
                    // - and jumping to the section alone did nothing at all
                    // when you were already looking at it.
                    const row = /^(.+)\[(\d+)\]/.exec(problem.path);
                    if (row) {
                      const [, listPath, index] = row;
                      useStudio.setState({
                        activeList: listPath!,
                        openRowRequest: { path: listPath!, index: Number(index) },
                      });
                      jumpTo(problem.group, undefined, true);
                      return;
                    }
                    jumpTo(problem.group);
                  }}
                  canUndo={undoDepth > 0}
                  canRedo={redoDepth > 0}
                  onUndo={() => undo(script.resource)}
                  onRedo={() => redo(script.resource)}
                  onDiscard={() => discardDraft(script.resource)}
                  onSave={() => commitDraft(script.resource)}
                  onJson={() => setJsonOpen(true)}
                  onHistory={() => setHistoryOpen(true)}
                  onReset={() => setResetOpen(true)}
                  onRefresh={() => reloadFromServer()}
                />}

        {pickerOpen && (
          <ScriptPicker
            scripts={scripts}
            current={activePage && !ownedByScript(activePage) ? undefined : script.resource}
            onPick={(resource) => { setPickerOpen(false); pickScript(resource, true); }}
            onClose={() => setPickerOpen(false)}
            onHome={() => { setPickerOpen(false); startTransition(() => useStudio.setState({ activePage: 'home', editingDesign: null })); }}
          />
        )}

        {/* Asked once, before anything else is worth reading - a panel in
          * the wrong language is the one screen a translation cannot fix. */}
        {askLanguage && canEdit && (
          <SetupWizard onDone={() => useStudio.setState({ askLanguage: false })} />
        )}
      </div>

          <AnimatePresence>
            {pickerEntry && (
              <PickerDrawer
                type={pickerEntry.type}
                label={pickerEntry.label}
                help={pickerEntry.help}
                iconSet={pickerEntry.iconSet}
                bodyHeight={pickerEntry.bodyHeight}
                value={effectiveValue(script.resource, pickerEntry)}
                disabled={!canEdit}
                onApply={(next) => setValue(script.resource, pickerEntry, next)}
                onClose={() => setPickerEntry(null)}
              />
            )}
          </AnimatePresence>

          <Toasts />

          <AnimatePresence>
            {jsonOpen && (
              <JsonModal
                script={script}
                canEdit={canEdit}
                onClose={() => setJsonOpen(false)}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {historyOpen && (
              <HistoryModal
                resource={activePage ? 'dirk_lib' : script.resource}
                canEdit={canEdit}
                onRevert={(changes) => {
                  for (const change of changes) {
                    const entry = script.entries.find((e) => e.path === change.path);
                    if (!entry) continue;
                    // A log entry for a setting that had never been changed
                    // carries NO previous value - `{path, new}` and nothing
                    // else - because there was no override, only the default.
                    // Undoing that means going back to the default, not
                    // staging `undefined`: doing the latter left the row
                    // holding a value that was neither the default nor a real
                    // one, so it stayed marked modified with its revert button
                    // still showing.
                    if (change.value === undefined) revertToDefault(script.resource, entry);
                    else setValue(script.resource, entry, change.value);
                  }
                  setHistoryOpen(false);
                }}
                onClose={() => setHistoryOpen(false)}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {resetOpen && (
              <ConfirmModal
                title={t('main.factory_reset', 'Factory reset')}
                description={t(
                  'main.factory_reset_body',
                  'Every setting in %s goes back to how it shipped. Type the resource name to confirm — this stages the reset, you still have to save.',
                ).replace('%s', script.label)}
                confirmLabel={t('main.reset_everything', 'Reset everything')}
                confirmText={script.resource}
                onConfirm={() => { factoryReset(script.resource); setResetOpen(false); }}
                onClose={() => setResetOpen(false)}
                zIndex={10200}
              />
            )}
          </AnimatePresence>
    </div>
  );
}

/**
 * The section you are currently reading, pinned above the scroll area rather
 * than inside it. Sticky-inside-the-scroller kept leaving a strip where rows
 * showed through the pane's padding; a sibling of the scroller cannot.
 */
/** Line box shared by a section heading's title and its description. */
const HEADING_LINE = '2.6vh';

function CurrentSection({ group, show }: { group?: SettingGroup; show: boolean }) {
  if (!group) return null;
  return (
    <div className={'ss-cur' + (show ? '' : ' hide')}>
      <SectionHeading icon={group.icon} label={group.label} description={group.description} />
    </div>
  );
}

/**
 * Extra UI a section needs that its fields cannot express - the beginnings of
 * the x-section registry. Keyed `resource:group` so two scripts can use the
 * same block name without colliding.
 *
 * A bot token is the case that forces this: no arrangement of inputs can tell
 * you whether the credential you pasted actually works, so the block gets a
 * test button and the six steps for obtaining one.
 */
const SECTION_EXTRAS: Record<string, React.ComponentType<{ resource: string; canEdit: boolean }>> = {
  'dirk_lib:discord': DiscordSetup,
};

/** Which views the header's search box actually drives. */
const SEARCHABLE_PAGES = new Set(['', 'items', 'vehicles']);

const SettingRow = memo(function SettingRow({
  resource, entry, query, rowFilter, canEdit: allowed, problems, onDrill, fill,
}: {
  resource: string;
  entry: SettingEntry;
  query: string;
  /** what is wrong with this setting's current value, if anything */
  problems?: string[];
  /** search text applied to the rows of a list, not just its label */
  rowFilter?: string;
  canEdit: boolean;
  /**
   * This row IS the pane, so it must fit inside it.
   *
   * A workspace hands its body a definite height. Left to size itself the row
   * grew to whatever its list needed and hung over the bottom edge - the card
   * border, the paging and the Add button all cut off. Filling instead means
   * the rows area is the part that gives, and scrolls.
   */
  fill?: boolean;
  onDrill: (entry: SettingEntry) => void;
}) {
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const t = useChrome();
  // subscribing to the draft keeps this row live as the value changes
  const staged = useStudio((s) => s.draft[resource]?.[entry.path]);
  // ...and keeps the master-switch check live too: flipping `theme.useOverride`
  // greys its block immediately rather than after a save.
  const gate = useStudio((s) => (entry.enabledWhen ? s.draft[resource]?.[entry.enabledWhen.path] : undefined));
  const live = entry.enabledWhen ? isEnabled(resource, entry) : true;
  void gate;

  // A setting its master switch has turned off is read-only for the same
  // reason a view-only admin's is: editing it would change nothing.
  const canEdit = allowed && live;
  // Label and help come from the owning script's bundle, with the schema's
  // English as the fallback - so a script needs no translations to work.
  const language = useActiveLanguage();
  const bundles = useBundles();
  const label = translate(bundles, language, resource, settingKey(entry.path, 'label'), entry.label);
  const help = entry.help
    ? translate(bundles, language, resource, settingKey(entry.path, 'description'), entry.help)
    : undefined;

  /**
   * A dropdown's options and a slider's bands, in the panel's language.
   *
   * These come from the schema and the schema is English, so a fully
   * translated panel still had English words inside its controls with no key
   * to translate them by. Derived from the path like everything else:
   *
   *   settings.<path>.enum.<value>
   *   settings.<path>.bands.<index>
   *   settings.<path>.bool.true / .bool.false
   *
   * The last pair are a `boolChoice`'s two sides. They came straight off
   * `x-boolLabels` untranslated, so a German panel still offered "Trowel
   * (kneel)" and there was no key to fix it with.
   *
   * Row columns do the same in FieldRow - one field deeper in the key.
   */
  const localisedEntry = useMemo(() => {
    if (!entry.options && !entry.bandLabels && !entry.boolLabels) return entry;
    return {
      ...entry,
      options: entry.options?.map((option) => ({
        ...option,
        label: translate(
          bundles, language, resource,
          `settings.${entry.path}.enum.${option.value}`, option.label,
        ),
      })),
      bandLabels: entry.bandLabels?.map((band, i) => translate(
        bundles, language, resource,
        `settings.${entry.path}.bands.${i}`, band,
      )),
      boolLabels: entry.boolLabels && {
        true: translate(
          bundles, language, resource,
          `settings.${entry.path}.bool.true`, entry.boolLabels.true ?? '',
        ) || undefined,
        false: translate(
          bundles, language, resource,
          `settings.${entry.path}.bool.false`, entry.boolLabels.false ?? '',
        ) || undefined,
      },
    };
  }, [entry, bundles, language, resource]);

  const value = effectiveValue(resource, entry);
  const modified = isModified(resource, entry);
  const wide = isWideType(entry.type);
  const compactHelp = useCompactHelp();

  /**
   * A control that asked for the whole workspace gets it.
   *
   * No row card, no label column, no frame - the section heading above already
   * names it, and a map framed inside a row inside a padded pane is boxed in
   * twice. Everything else about it is unchanged: it still stages, still
   * saves, still sits under the same save bar.
   */
  if (entry.type === 'custom' && entry.componentFull) {
    return (
      <CustomControl
        resource={resource}
        component={entry.component ?? ''}
        entry={entry}
        value={value}
        canEdit={canEdit}
        bare
        onChange={(next) => setValue(resource, entry, next)}
      />
    );
  }

  return (
    <Flex
      direction={wide ? 'column' : 'row'}
      align={wide ? 'stretch' : 'center'}
      // `space-between` is for the NARROW layout, where it pushes the label
      // left and the control right. Stacked and stretched to fill a workspace
      // it did the same thing vertically: the heading at the top, the list
      // pinned to the bottom, and a hole between them.
      justify={wide ? 'flex-start' : 'space-between'}
      gap="sm"
      px="1.6vh" py="1.1vh"
      // A filling list owns the whole pane, so it gets no plate of its own -
      // a box inside a box. Changed / staged / wrong is a left edge either way.
      className={'ss-fr'
        + (fill && wide ? ' flat' : '')
        + (problems?.length ? ' bad' : staged !== undefined ? ' stg' : modified ? ' mod' : '')}
      style={{
        position: wide ? 'relative' : undefined,
        ...(fill && wide ? { flex: 1, minHeight: 0, overflow: 'hidden' } : {}),
        // Dimmed rather than hidden: knowing the setting exists and why it is
        // inert is the useful part. Hiding it just makes people hunt for it.
        opacity: live ? 1 : 0.42,
      }}
    >
      {/* `flex: 1` is for the NARROW layout, where it pushes the control to
        * the right. Stacked into a workspace the main axis is vertical, so it
        * grew the heading instead: measured in the stores workspace, the label
        * block and the list were 288px each - half the pane spent on three
        * lines of text, and the search box floating in the middle of it. */}
      <Flex direction="column" gap="0.2vh" style={{ minWidth: 0, flex: wide ? '0 0 auto' : 1 }}>
        <Flex align="center" gap="xs" wrap="wrap">
          <span className="ss-lbl">
            <Highlight text={label} query={query} />
          </span>

          {modified && (
            <Chip label={t('main.modified', 'Modified')} color={color} dot />
          )}
          {entry.restartRequired && (
            <Chip label={t('main.restart_required', 'Restart required')} color="#E0B15F" icon={RotateCcw} />
          )}
          {entry.serverOnly && (
            <Chip label={t('main.server_only', 'Server only')} color="#4CC3DE" icon={Lock} />
          )}

          {/* Narrow column: the description hides behind the same hover icon
              the row editors use, rather than wrapping to a dozen lines and
              pushing the control it belongs to out of sight. */}
          {(help || compactHelp) && compactHelp && (
            <Tooltip
              label={(
                <>
                  {help}
                  {/* The path lives in here too. On its own line under a
                      half-width label it wrapped mid-word — "strictC /
                      atchLevel" — and every row ended up a different height
                      for the sake of a string nobody reads twice. */}
                  <div style={{ marginTop: help ? '0.5vh' : 0, opacity: 0.55, fontFamily: 'monospace' }}>
                    {entry.path}
                    {modified ? `  ·  default: ${formatDefault(entry.default)}` : ''}
                  </div>
                </>
              )}
              position="top"
              withArrow
              multiline
              w={300}
              zIndex={10500}
              styles={{
                tooltip: {
                  background: alpha(theme.colors.dark[7], 0.97),
                  border: '0.1vh solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.75)',
                  fontFamily: 'Akrobat SemiBold',
                  fontSize: '1.2vh',
                  padding: '0.6vh 0.8vh',
                  lineHeight: 1.35,
                },
              }}
            >
              <Flex align="center" style={{ cursor: 'help' }}>
                <Info size="1.3vh" color="rgba(255,255,255,0.35)" />
              </Flex>
            </Tooltip>
          )}
        </Flex>

        {help && !compactHelp && (
          <div className="ss-help" style={{ maxWidth: '82vh' }}>
            <Highlight text={help} query={query} />
          </div>
        )}

        {/* "That is set over there." Only while the value it applies to is
            actually in force - telling someone where the global theme lives
            is noise once they have stopped following it. */}
        {entry.goTo && (entry.goTo.when === undefined || value === entry.goTo.when) && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.99 }}
            onClick={() => useStudio.setState({
              goToRequest: {
                resource: entry.goTo!.resource,
                group: entry.goTo!.group,
                page: entry.goTo!.page,
              },
            })}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4vh',
              background: 'transparent', border: 'none', padding: 0,
              cursor: 'pointer', width: 'fit-content',
            }}
          >
            <Text ff="Akrobat Bold" size="xxs" c={color} td="underline">
              {entry.goTo.label ?? t('main.go_to_setting', 'Change it there')}
            </Text>
            <ArrowRight size="1.1vh" color={color} />
          </motion.button>
        )}

        <Flex align="center" gap="xs" wrap="wrap" style={{ minWidth: 0 }}>
          {/* The path and the default move to the hover icon in a narrow
              column. Everything after them - a validator, an action, a gate
              reason - stays, because those are things you act on. */}
          {!compactHelp && (
            <span className="ss-path">
              <Highlight text={entry.path} query={query} />
            </span>
          )}
          {modified && !compactHelp && (
            <span className="ss-path">
              default: <b>{formatDefault(entry.default)}</b>
            </span>
          )}
          {problems?.map((problem) => (
            <Flex key={problem} align="center" gap="0.4vh">
              <AlertTriangle size="1.1vh" color="#ef4444" />
              <Text ff="Akrobat Bold" size="xxs" c="#ef4444">{problem}</Text>
            </Flex>
          ))}
          {/* Whether the value actually WORKS, as opposed to whether it is
              in range - only the service behind an API key can answer that. */}
          {entry.validateWith && (
            <FieldValidator
              resource={resource}
              callback={entry.validateWith}
              value={value}
              disabled={!canEdit}
            />
          )}

          {/* ...and whether to go and DO the thing, which is a separate
              question from whether the value looks right. */}
          {entry.action && (
            <FieldAction
              resource={resource}
              action={entry.action}
              value={value}
              section={entry.action.sendSection ? sectionValues(resource, entry.path) : undefined}
              disabled={!canEdit}
            />
          )}
          {!live && entry.enabledWhen && (
            <Flex align="center" gap="0.4vh">
              <Lock size="1.1vh" color="#E0B15F" />
              <Text ff="Akrobat SemiBold" size="xxs" c="#E0B15F">
                needs {entry.enabledWhen.path} {formatDefault(entry.enabledWhen.equals)}
              </Text>
            </Flex>
          )}
        </Flex>
      </Flex>

      <Flex
        align="center" gap="xs"
        justify="flex-end"
        style={{ flexShrink: 0, position: wide ? 'absolute' : 'static', top: '1vh', right: '1vh' }}
      >
        {!wide && (
          <SettingControl
            type={entry.type}
            entry={localisedEntry}
            resource={resource}
            value={value}
            disabled={!canEdit}
            onChange={(next) => setValue(resource, entry, next)}
            onDrill={opensPicker(entry.type) ? () => onDrill(entry) : undefined}
          />
        )}

        <Flex w="3vh" justify="flex-end" style={{ flexShrink: 0 }}>
          {modified && canEdit && (
            <Tooltip
              label={t('main.back_to_default', 'Back to default')}
              position="top"
              withArrow
              zIndex={10000}
              styles={{
                tooltip: {
                  background: alpha(theme.colors.dark[7], 0.95),
                  border: '0.1vh solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.75)',
                  fontFamily: 'Akrobat Bold',
                  fontSize: '1.2vh',
                  padding: '0.5vh 0.8vh',
                },
              }}
            >
              <motion.button
                type="button"
                onClick={() => revertToDefault(resource, entry)}
                whileHover={{ background: alpha(color, 0.16), borderColor: alpha(color, 0.5) }}
                whileTap={{ scale: 0.94 }}
                style={{
                  aspectRatio: '1 / 1', height: '3vh',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent',
                  border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.55)}`,
                  borderRadius: theme.radius.xs,
                  cursor: 'pointer',
                  color: 'rgba(255,255,255,0.55)',
                }}
                aria-label={t('main.back_to_default', 'Back to default')}
              >
                <ListRestart size="1.5vh" />
              </motion.button>
            </Tooltip>
          )}
        </Flex>
      </Flex>

      {wide && (
        // The owning script's own editor, before any built-in - it was chosen
        // deliberately, so nothing here should second-guess it.
        entry.type === 'custom' ? (
          <CustomControl
            resource={resource}
            component={entry.component ?? ''}
            entry={entry}
            value={value}
            canEdit={canEdit}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'weightMap' ? (
          <WeightMapControl
            resource={resource}
            value={value}
            disabled={!canEdit}
            min={entry.min}
            max={entry.max}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'cameras' ? (
          <CameraListControl
            value={value}
            disabled={!canEdit}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'positions' ? (
          <PositionListControl
            value={value}
            disabled={!canEdit}
            bodyHeight={entry.bodyHeight}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'weekdays' ? (
          <WeekdayControl
            value={value}
            disabled={!canEdit}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'refs' ? (
          <RefListControl
            resource={resource}
            value={value}
            disabled={!canEdit}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'groupGrades' ? (
          <GroupGradeControl
            value={value}
            disabled={!canEdit}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'keybindMap' ? (
          <KeybindMapControl
            value={value}
            disabled={!canEdit}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'mantineColor' ? (
          <MantineColorControl
            value={value}
            resource={resource}
            path={entry.path}
            disabled={!canEdit}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'shade' ? (
          <ShadeControl
            value={value}
            resource={resource}
            path={entry.path}
            disabled={!canEdit}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'keyvalue' ? (
          <KeyValueControl
            value={value}
            disabled={!canEdit}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'groups' ? (
          <GroupsControl
            value={value}
            disabled={!canEdit}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'controls' ? (
          <ControlsControl
            value={value}
            disabled={!canEdit}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : entry.type === 'palette' ? (
          <PaletteControl
            shades={(value as string[]) ?? []}
            disabled={!canEdit}
            onChange={(next) => setValue(resource, entry, next)}
          />
        ) : (
          <ListRows
            entry={entry}
            resource={resource}
            rows={(value as Record<string, unknown>[]) ?? []}
            disabled={!canEdit}
            rowFilter={rowFilter}
            fill={fill}
            onChange={(next) => setValue(resource, entry, next)}
          />
        )
      )}
    </Flex>
  );
});

function formatDefault(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (Array.isArray(value)) return `${value.length} entries`;
  if (typeof value === 'object') {
    const c = value as { x?: number; y?: number; z?: number };
    if (typeof c.x === 'number') return `${c.x.toFixed(1)}, ${c.y?.toFixed(1)}, ${c.z?.toFixed(1)}`;
    return 'object';
  }
  return String(value) || 'empty';
}
