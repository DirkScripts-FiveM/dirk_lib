import { alpha, Flex, NumberInput, Text, TextInput, useMantineTheme } from '@mantine/core';
import {
  Modal, WorldPositionPicker, blipUrlForSprite, getBlipColor, getBlipEntry,
  isEnvBrowser, loadModels, useItems, useModels,
  type Vector4Value,
} from 'dirk-cfx-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { PedArt } from './pedArt';
import { IconPicker } from './IconPicker';

/**
 * The real catalogues, discovered rather than hardcoded.
 *
 * dirk-cfx-react resolves a blip colour or sprite BY ID; it exports no list.
 * Walking the id space once and keeping whatever resolves gives the full set
 * without a copy of it living here to fall out of date - which is exactly how
 * this panel ended up offering ten colours out of eighty-odd.
 */
const BLIP_COLOURS = Array.from({ length: 90 }, (_, id) => getBlipColor(id))
  .filter((entry): entry is { id: number; label: string; hex: string } => !!entry);

const BLIP_SPRITES = Array.from({ length: 900 }, (_, id) => getBlipEntry(id))
  .filter((entry): entry is { id: number; name: string; ext: string } => !!entry);

/**
 * Which models are PEDS.
 *
 * The model dump is peds, vehicles and props in one list with no flag saying
 * which is which - but ped models follow a naming convention that has held
 * since launch: a_/s_/u_/g_ plus male-female-child, the cutscene and
 * multiplayer prefixes, the animals. Matching the prefix is reading the scheme
 * rather than guessing at it.
 */
const PED_PREFIX = /^(a_[cmf]_|s_[mf]_|u_[mf]_|g_[mf]_|cs_|csb_|ig_|mp_[mf]_|player_|hc_)/;
import { motion } from 'framer-motion';
import { ItemArt } from './ui';
import {
  Crosshair, Keyboard, MapPin, Navigation, Package, Palette, Plus, Search, Shapes, User,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useInputStyles, useSearchInputStyles } from './Controls';
import { StudioButton } from './ui';
import { MOCK_ITEMS } from './mockData';
import type { ControlType } from './types';
import { useChrome } from './studioLocale';

// Every non-list picker that opens a sub-view. Same shell for all of them so a
// new picker type is a case here, not another modal to design.

type PickerProps = {
  type: ControlType;
  label: string;
  help?: string;
  value: unknown;
  onApply: (next: unknown) => void;
  onClose: () => void;
  disabled?: boolean;
  /** which icon set an `icon` picker should offer - schema `x-iconSet` */
  iconSet?: 'lucide' | 'fontawesome';
};


export function PickerDrawer({
  type, label, help, value, onApply, onClose, disabled, iconSet,
}: PickerProps) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const styles = useInputStyles();
  const searchStyles = useSearchInputStyles();
  const [draft, setDraft] = useState<unknown>(value);
  const [query, setQuery] = useState('');
  const [capturing, setCapturing] = useState(false);
  // only the game can place something in the world
  const inBrowser = isEnvBrowser();

  // keybind capture - swallow the key so it never reaches the panel behind it
  useEffect(() => {
    if (type !== 'keybind' || !capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(false); return; }
      const key = e.key === ' ' ? 'SPACE' : e.key.length === 1 ? e.key.toUpperCase() : e.key.toUpperCase();
      setDraft(key);
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [type, capturing]);

  const meta = PICKER_META[type] ?? { icon: Palette, title: 'Pick a value' };

  // The REAL inventory. Picking from MOCK_ITEMS meant that on a live server the
  // item picker offered a fixture list - so it could not offer an item the
  // server actually has, and would happily write one it does not.
  const inventory = useItems();

  /**
   * A callback ref, not a plain one.
   *
   * The virtualiser asks for its scroll element while rendering, and a plain
   * ref is still null on that first pass - so it started with no element,
   * never set up its observer, and rendered an empty window. The list scrolled
   * (the sized spacer was there) and showed nothing, which is the same
   * measure-once-against-nothing trap the map hit.
   *
   * Held in state so attaching the node re-renders and the virtualiser gets a
   * real element to measure.
   */
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);


  const items = useMemo(() => {
    if (type !== 'item') return [];
    const all = Object.keys(inventory).length > 0
      ? Object.values(inventory).map((item) => ({
        name: item.name,
        label: item.label || item.name,
      }))
      // A browser has no game to ask, and the picker still has to show
      // something to design against.
      : MOCK_ITEMS;
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((item) => item.name.toLowerCase().includes(needle)
      || item.label.toLowerCase().includes(needle));
  }, [type, query, inventory]);

  /**
   * A typed name that matches no installed item.
   *
   * Offered as its own row rather than silently allowed, so choosing it is a
   * decision. Hidden once the name IS installed - there is a real row for it.
   */
  /**
   * Every sprite that matches, with no cap.
   *
   * Capping the list assumed you know what to search for, and nobody knows
   * the name of a blip they have not seen - browsing IS the way you pick one.
   * The artwork loads as it scrolls into view (see BlipArt), so eight hundred
   * of them costs eight hundred small DOM nodes and only the images actually
   * looked at.
   */
  // The model dump is a ~1MB dynamic import, pulled only when a ped picker
  // actually opens.
  useEffect(() => { if (type === 'ped') loadModels(); }, [type]);
  const { models } = useModels();

  /**
   * Ped models matching the search - people first.
   *
   * `a_c_` is the animal prefix and sorts before every human one, so the
   * picker opened on a boar, a cat and a chicken. Whoever is being placed
   * behind a counter is a person almost every time; the animals keep their
   * place in the list, just not the first screen of it.
   */
  const peds = useMemo(() => {
    if (type !== 'ped') return [];
    const all = models.filter((model) => PED_PREFIX.test(model));
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? all.filter((model) => model.toLowerCase().includes(needle))
      : all;
    const animal = (model: string) => (model.startsWith('a_c_') ? 1 : 0);
    return [...matched].sort((a, b) => animal(a) - animal(b) || a.localeCompare(b));
  }, [type, models, query]);

  /** A typed model the list does not know. */
  const customPed = useMemo(() => {
    const typed = query.trim();
    if (type !== 'ped' || !typed) return '';
    return peds.some((model) => model.toLowerCase() === typed.toLowerCase()) ? '' : typed;
  }, [type, query, peds]);

  const sprites = useMemo(() => {
    if (type !== 'blipSprite') return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return BLIP_SPRITES;
    return BLIP_SPRITES.filter((s) => (
      s.name.toLowerCase().includes(needle) || String(s.id) === needle
    ));
  }, [type, query]);

  const customName = useMemo(() => {
    const typed = query.trim();
    if (type !== 'item' || !typed) return '';
    return items.some((item) => item.name.toLowerCase() === typed.toLowerCase()) ? '' : typed;
  }, [type, query, items]);

  // Row height in px, from vh, because the virtualiser measures in pixels and
  // the panel is sized in vh. Measured per row after mount, so this only has
  // to be close.
  const itemVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listEl,
    estimateSize: () => Math.round(window.innerHeight * 0.052),
    overscan: 10,
    // Re-window whenever the list changes length, so typing a search does not
    // leave the virtualiser holding a range from the previous result set.
    getItemKey: (index) => items[index]?.name ?? index,
  });

  return (
    <Modal
      title={label}
      icon={meta.icon}
      iconColor={color}
      description={help}
      onClose={onClose}
      width={type === 'item' ? '68vh' : type === 'coords' ? '62vh' : '72vh'}
      height={type === 'coords' ? '42vh' : '62vh'}
      // Above the row editors that open it.
      //
      // At 10100 this tied with RowModal and sat under NestedRowModal (10400),
      // so a blip colour picked from a store row opened behind the very modal
      // that asked for it. Toasts stay above at 10500.
      zIndex={10450}
    >
      <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
        <Flex direction="column" flex={1} p="sm" gap="xs" style={{ overflowY: 'auto', minHeight: 0 }}>

          {type === 'keybind' && (
            <Flex direction="column" align="center" justify="center" gap="sm" flex={1}>
              <motion.button
                type="button"
                onClick={() => !disabled && setCapturing(true)}
                animate={capturing ? { borderColor: color, scale: 1.02 } : {}}
                transition={capturing ? { repeat: Infinity, repeatType: 'reverse', duration: 0.7 } : {}}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '1vh', width: '30vh', height: '18vh',
                  background: alpha(theme.colors.dark[9], 0.7),
                  border: `0.2vh ${capturing ? 'solid' : 'dashed'} ${capturing ? color : alpha(theme.colors.dark[4], 0.6)}`,
                  borderRadius: theme.radius.sm,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                }}
              >
                <Keyboard size="3vh" color={capturing ? color : 'rgba(255,255,255,0.35)'} />
                {capturing ? (
                  <Text ff="Akrobat Bold" size="sm" c={color}>{t('pickerDrawer.press_any_key', 'Press any key...')}</Text>
                ) : (
                  <>
                    <Text ff="monospace" size="xl" c="rgba(255,255,255,0.9)">{String(draft)}</Text>
                    <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.35)">{t('pickerDrawer.click_to_rebind', 'Click to rebind')}</Text>
                  </>
                )}
              </motion.button>
              <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.3)">
                {t('pickerDrawer.escape_cancels_the_capture_without_chang', 'Escape cancels the capture without changing the key.')}
              </Text>
            </Flex>
          )}

          {type === 'blipColor' && (
            <>
              <TextInput
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                placeholder={t('pickerDrawer.search_colours', 'Search colours')}
                leftSection={<Search size="1.5vh" color="rgba(255,255,255,0.35)" />}
                styles={searchStyles}
                style={{ width: '100%' }}
              />
            {/* A GRID, not a wrap.
              * Fixed-width tiles in a wrapping row leave whatever does not
              * divide evenly as a ragged strip down the right-hand side.
              * auto-fill spreads the same tiles across the full width. */}
            <div
              className="studio-scroll"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(11vh, 1fr))',
                gap: '0.8vh',
                maxHeight: '44vh',
                overflowY: 'auto',
                alignContent: 'start',
              }}
            >
              {BLIP_COLOURS
                .filter((blip) => {
                  const needle = query.trim().toLowerCase();
                  if (!needle) return true;
                  return blip.label.toLowerCase().includes(needle) || String(blip.id) === needle;
                })
                .map((blip) => {
                const active = blip.id === Number(draft);
                return (
                  <motion.button
                    key={blip.id}
                    type="button"
                    onClick={() => !disabled && setDraft(blip.id)}
                    whileTap={{ scale: 0.96 }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5vh',
                      padding: '1vh 0.6vh', minWidth: 0,
                      background: active ? alpha(color, 0.12) : alpha(theme.colors.dark[8], 0.5),
                      border: `0.1vh solid ${active ? alpha(color, 0.6) : alpha(theme.colors.dark[5], 0.4)}`,
                      borderRadius: theme.radius.xs,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <Flex w="3.4vh" h="3.4vh" style={{ background: blip.hex, borderRadius: '0.4vh' }} />
                    <Text ff="Akrobat Bold" size="xxs" c="rgba(255,255,255,0.8)" truncate style={{ maxWidth: '100%' }}>
                      {blip.label}
                    </Text>
                    <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.3)">{blip.id}</Text>
                  </motion.button>
                );
              })}
            </div>
            </>
          )}

          {type === 'blipSprite' && (
            <>
              {/* Eight hundred sprites is not a wall to scroll: it is a thing
                  to search. The grid shows what matches, capped, because
                  nobody reads past a screenful anyway. */}
              <TextInput
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                placeholder={t('pickerDrawer.search_sprites', 'Search sprites')}
                leftSection={<Search size="1.5vh" color="rgba(255,255,255,0.35)" />}
                styles={searchStyles}
                style={{ width: '100%' }}
              />
            <div
              className="studio-scroll"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(11vh, 1fr))',
                gap: '0.8vh',
                maxHeight: '44vh',
                overflowY: 'auto',
                alignContent: 'start',
              }}
            >
              {sprites.map((sprite) => {
                const active = sprite.id === Number(draft);
                return (
                  <motion.button
                    key={sprite.id}
                    type="button"
                    onClick={() => !disabled && setDraft(sprite.id)}
                    whileTap={{ scale: 0.96 }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5vh',
                      padding: '1vh 0.6vh', minWidth: 0,
                      background: active ? alpha(color, 0.12) : alpha(theme.colors.dark[8], 0.5),
                      border: `0.1vh solid ${active ? alpha(color, 0.6) : alpha(theme.colors.dark[5], 0.4)}`,
                      borderRadius: theme.radius.xs,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {/* The blip's own artwork - the whole point of choosing
                        one by eye rather than by number. */}
                    <BlipArt id={sprite.id} active={active} color={color} />
                    <Text ff="Akrobat Bold" size="xxs" c="rgba(255,255,255,0.8)" truncate style={{ maxWidth: '100%' }}>
                      {sprite.name}
                    </Text>
                    <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.3)">{sprite.id}</Text>
                  </motion.button>
                );
              })}

              {sprites.length === 0 && (
                <Flex justify="center" py="md" style={{ gridColumn: '1 / -1' }}>
                  <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.3)">
                    {t('pickerDrawer.no_sprite', 'No sprite matches that')}
                  </Text>
                </Flex>
              )}
            </div>
            </>
          )}

          {/* The icon grid is the same component the row used to embed. What
              changed is where it lives: inline, it was a 300px block sitting in
              the middle of a form, pushing everything after it off the screen -
              and it was the one picker in the panel that did not open like the
              rest of them. */}
          {type === 'icon' && (
            <IconPicker
              value={draft}
              set={iconSet}
              disabled={disabled}
              onChange={(next) => setDraft(next)}
            />
          )}

          {type === 'ped' && (
            <>
              <TextInput
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                placeholder={t('pickerDrawer.search_peds', 'Search peds, or type a custom model')}
                leftSection={<Search size="1.5vh" color="rgba(255,255,255,0.35)" />}
                styles={searchStyles}
                style={{ width: '100%' }}
              />

              {/* A model this list does not know is still a model: servers add
                  their own peds constantly, and the picker should not be the
                  reason one cannot be used. Flagged, not refused. */}
              {customPed && (
                <motion.button
                  type="button"
                  onClick={() => {
                    if (disabled) return;
                    setDraft(customPed);
                    onApply(customPed);
                    onClose();
                  }}
                  whileTap={{ scale: 0.995 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.9vh',
                    padding: '0.7vh 0.8vh',
                    background: alpha('#f59e0b', 0.1),
                    border: `0.1vh solid ${alpha('#f59e0b', 0.45)}`,
                    borderRadius: theme.radius.xs,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    textAlign: 'left', width: '100%',
                  }}
                >
                  <PedArt model={customPed} size="3.2vh" />
                  <Flex direction="column" style={{ minWidth: 0, lineHeight: 1.15 }}>
                    <Text ff="Akrobat Bold" size="xs" c="#f59e0b">
                      {t('pickerDrawer.use_this_ped', 'Use this model anyway')}
                    </Text>
                    <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.4)">
                      {customPed}
                    </Text>
                  </Flex>
                </motion.button>
              )}

              <div
                className="studio-scroll"
                style={{
                  display: 'grid',
                  // Five across, fixed. Auto-fill packed in as many as would go, which
                  // for a picture of a person meant a wall of thumbnails you had
                  // to lean in to read. Fewer, bigger, is the whole point of
                  // showing the ped rather than its model name.
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '0.8vh',
                  maxHeight: '44vh',
                  overflowY: 'auto',
                  alignContent: 'start',
                }}
              >
                {peds.map((model) => {
                  const active = model === draft;
                  return (
                    <motion.button
                      key={model}
                      type="button"
                      onClick={() => !disabled && setDraft(model)}
                      whileTap={{ scale: 0.96 }}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5vh',
                        padding: '0.9vh 0.5vh', minWidth: 0,
                        background: active ? alpha(color, 0.12) : alpha(theme.colors.dark[8], 0.5),
                        border: `0.1vh solid ${active ? alpha(color, 0.6) : alpha(theme.colors.dark[5], 0.4)}`,
                        borderRadius: theme.radius.xs,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <PedArt model={model} size="13vh" />
                      <Text
                        ff="monospace" size="xxs" c="rgba(255,255,255,0.7)"
                        truncate style={{ maxWidth: '100%' }}
                      >
                        {model}
                      </Text>
                    </motion.button>
                  );
                })}

                {peds.length === 0 && (
                  <Flex justify="center" py="md" style={{ gridColumn: '1 / -1' }}>
                    <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.3)">
                      {t('pickerDrawer.no_ped', 'No ped matches that')}
                    </Text>
                  </Flex>
                )}
              </div>
            </>
          )}

          {type === 'item' && (
            <>
              <TextInput
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                placeholder={t('pickerDrawer.search_the_inventory', 'Search the inventory')}
                leftSection={<Search size="1.5vh" color="rgba(255,255,255,0.35)" />}
                styles={searchStyles}
                style={{ width: '100%' }}
              />
              {/* Only what is on screen is rendered.
                  An inventory is thousands of items, and every one of them was
                  mounted the moment the picker opened - a few thousand buttons,
                  each with its own image - so the modal stalled before it drew,
                  and got slower every time the server added an item. */}
              {/* Name an item that is not installed YET.
                  Building new equipment usually means configuring it before
                  the item exists - it lands on the next restart - and a picker
                  that only offers what is already installed makes that a
                  chicken-and-egg problem. Typed names are accepted and flagged
                  amber wherever they appear, rather than refused. */}
              {customName && (
                <motion.button
                  type="button"
                  // Applies and closes rather than just selecting. The row
                  // reads as a decision - "use this name anyway" - so needing
                  // to then find Apply made it look like it had done nothing.
                  onClick={() => {
                    if (disabled) return;
                    setDraft(customName);
                    onApply(customName);
                    onClose();
                  }}
                  whileTap={{ scale: 0.995 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.9vh',
                    padding: '0.7vh 0.8vh',
                    background: alpha('#f59e0b', 0.1),
                    border: `0.1vh solid ${alpha('#f59e0b', 0.45)}`,
                    borderRadius: theme.radius.xs,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    textAlign: 'left', width: '100%',
                  }}
                >
                  <Flex
                    align="center" justify="center" w="3.2vh" h="3.2vh"
                    style={{ flexShrink: 0 }}
                  >
                    <Plus size="1.6vh" color="#f59e0b" />
                  </Flex>
                  <Flex direction="column" style={{ minWidth: 0, lineHeight: 1.15 }}>
                    <Text ff="Akrobat Bold" size="xs" c="#f59e0b">
                      {t('pickerDrawer.use_this_name', 'Use this name anyway')}
                    </Text>
                    <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.4)">
                      {customName} — {t('pickerDrawer.not_installed', 'not installed yet')}
                    </Text>
                  </Flex>
                </motion.button>
              )}

              <div
                ref={setListEl}
                className="studio-scroll"
                style={{ maxHeight: '44vh', overflowY: 'auto' }}
              >
                <div style={{ height: itemVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
                  {itemVirtualizer.getVirtualItems().map((virtual) => {
                    const item = items[virtual.index];
                    if (!item) return null;
                    const active = item.name === draft;
                    return (
                      <div
                        key={item.name}
                        data-index={virtual.index}
                        ref={itemVirtualizer.measureElement}
                        style={{
                          position: 'absolute', top: 0, left: 0, width: '100%',
                          transform: `translateY(${virtual.start}px)`,
                          paddingBottom: '0.4vh',
                        }}
                      >
                        <motion.button
                          type="button"
                          onClick={() => !disabled && setDraft(item.name)}
                          whileTap={{ scale: 0.995 }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.9vh',
                            padding: '0.7vh 0.8vh',
                            background: active ? alpha(color, 0.12) : alpha(theme.colors.dark[8], 0.45),
                            border: `0.1vh solid ${active ? alpha(color, 0.5) : alpha(theme.colors.dark[5], 0.3)}`,
                            borderRadius: theme.radius.xs,
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            textAlign: 'left', width: '100%',
                          }}
                        >
                          {/* The actual item image. This drew a generic parcel
                              icon for every row - while a note underneath
                              promised real images - so the one list where you
                              choose an item by sight was the one place you
                              could not see one. ItemArt falls back to the
                              parcel by itself when an item has no image. */}
                          <ItemArt name={item.name} size="3.2vh" />
                          <Flex direction="column" style={{ minWidth: 0, lineHeight: 1.15 }}>
                            <Text ff="Akrobat Bold" size="xs" c={active ? color : 'rgba(255,255,255,0.85)'}>{item.label}</Text>
                            <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.3)">{item.name}</Text>
                          </Flex>
                        </motion.button>
                      </div>
                    );
                  })}
                </div>

                {items.length === 0 && (
                  <Flex justify="center" py="md">
                    <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.3)">No item matches "{query}"</Text>
                  </Flex>
                )}
              </div>
            </>
          )}

          {type === 'coords' && (
            <Flex direction="column" gap="sm">
              {/*
                `w` only when the value HAS one.

                The picker writes a heading, so hiding the field meant the one
                number you cannot judge by eye was also the one you could not
                see or correct. A zone corner has no heading, though, and
                offering it a box to type one into is worse than not showing it.
              */}
              <Flex gap="xs">
                {((draft as Record<string, unknown>)?.w !== undefined
                  ? (['x', 'y', 'z', 'w'] as const)
                  : (['x', 'y', 'z'] as const)
                ).map((axis) => (
                  <Flex key={axis} direction="column" gap="0.3vh" style={{ flex: 1 }}>
                    <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.1em" c="rgba(255,255,255,0.35)">{axis}</Text>
                    <NumberInput
                      value={Number((draft as Record<string, number>)?.[axis] ?? 0)}
                      onChange={(v) => setDraft({ ...(draft as object), [axis]: Number(v) || 0 })}
                      disabled={disabled}
                      decimalScale={2}
                      hideControls
                      styles={styles}
                    />
                  </Flex>
                ))}
              </Flex>

              {/*
                The SHARED picker, not a local copy of one.

                These two buttons were hand-rolled here and fired
                `START_POSITION_PICK` / `TELEPORT_TO_POSITION` - callback names
                no resource has ever registered. So the fetch went nowhere, the
                drawer closed on top of it, and the Set button looked like it
                did nothing. Meanwhile the real flow already existed and the
                positions LIST two files over was using it correctly.

                `WorldPositionPicker` speaks the `lib.adminTool` dispatch
                (`ADMIN_TOOL_BEGIN { id: 'capturePosition' }` /
                `ADMIN_TOOL_INVOKE { id: 'gotoCoord' }`), which is gated on the
                panel actually being open - so neither the walk-and-set nor the
                teleport is reachable from CEF devtools with the panel shut.
              */}
              <Flex gap="xs" justify="flex-end">
                <WorldPositionPicker
                  value={draft as Vector4Value}
                  onChange={(next: Vector4Value) => setDraft(next)}
                />
              </Flex>

              <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.28)">
                {inBrowser
                  ? t('pickerDrawer.set_hint_browser', 'In game, Set hides the panel and lets you walk to the spot — typing numbers is the fallback, not the workflow.')
                  : t('pickerDrawer.set_hint', 'Set hides the panel so you can walk to the spot. Your heading is taken from the way you are facing.')}
              </Text>
            </Flex>
          )}

          {/*
            A drawer that knows nothing about this type.

            Every branch above is opt-in per control, so a field whose control
            has no picker here opened an EMPTY modal - a header, two buttons and
            a void, with nothing anywhere saying which type it could not draw.
            That is indistinguishable from a picker whose contents failed to
            load, which is the wrong thing to go looking for.
          */}
          {!DRAWABLE.has(type) && (
            <Flex direction="column" align="center" gap="0.6vh" py="xl">
              <Text ff="Akrobat Bold" size="sm" c="rgba(255,255,255,0.55)">
                {t('pickerDrawer.no_picker', 'No picker for this field')}
              </Text>
              <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.3)">
                {`type: ${String(type)}`}
              </Text>
            </Flex>
          )}
        </Flex>

        <Flex
          justify="flex-end" gap="xs" px="sm" py="xs"
          style={{ borderTop: `0.1vh solid ${alpha(theme.colors.dark[4], 0.4)}`, flexShrink: 0 }}
        >
          <StudioButton label={t('pickerDrawer.cancel', 'Cancel')} onClick={onClose} />
          <StudioButton
            label={t('pickerDrawer.apply', 'Apply')}
            primary
            disabled={disabled}
            onClick={() => { onApply(draft); onClose(); }}
          />
        </Flex>
      </Flex>
    </Modal>
  );
}

/** The types this drawer actually draws something for. */
const DRAWABLE = new Set<string>(['item', 'coords', 'icon', 'blipColor', 'blipSprite', 'ped']);

const PICKER_META: Partial<Record<ControlType, { icon: React.ElementType; title: string }>> = {
  keybind: { icon: Keyboard, title: 'Rebind key' },
  blipColor: { icon: Palette, title: 'Blip colour' },
  blipSprite: { icon: MapPin, title: 'Blip sprite' },
  ped: { icon: User, title: 'Ped model' },
  icon: { icon: Shapes, title: 'Icon' },
  item: { icon: Package, title: 'Pick an item' },
  coords: { icon: Crosshair, title: 'Position' },
};

/** Types that open PickerDrawer rather than editing inline. */
export function opensPicker(type: ControlType): boolean {
  // keybind and control edit inline through dirk-cfx-react's own inputs, so
  // they deliberately do not open a sub-view.
  //
  // The blips DO. Their controls draw a picker button and hand `onDrill` up,
  // but a field only receives one when this says so - and while they were
  // briefly dropdowns, this stopped saying so. The buttons stayed, wired to
  // nothing, which is why clicking a blip colour in a store did nothing at all.
  return type === 'item' || type === 'coords' || type === 'icon'
    || type === 'blipColor' || type === 'blipSprite' || type === 'ped';
}


/** A blip's artwork, falling back to a pin when it has none. */
function BlipArt({ id, active, color }: { id: number; active: boolean; color: string }) {
  const [failed, setFailed] = useState(false);
  const src = blipUrlForSprite(id);

  if (!src || failed) {
    return <MapPin size="2.6vh" color={active ? color : 'rgba(255,255,255,0.5)'} />;
  }
  return (
    <img
      src={src}
      alt=""
      // Fetched when it scrolls into view, not all at once. This is what lets
      // the whole catalogue be browsable rather than searched blind.
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={{ width: '2.8vh', height: '2.8vh', objectFit: 'contain' }}
    />
  );
}
