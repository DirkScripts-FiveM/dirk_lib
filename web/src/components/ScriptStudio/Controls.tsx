import { alpha, ColorInput, MultiSelect, NumberInput, PasswordInput, Select, Switch, Text, Textarea, TextInput, Tooltip, useMantineTheme } from '@mantine/core';
import { Flex } from '@mantine/core';
import { motion } from 'framer-motion';
import { ItemArt } from './ui';
import { AlertTriangle, ChevronRight, Crosshair, Eye, EyeOff, Keyboard, MapPin, Package, PackagePlus } from 'lucide-react';
import { useState } from 'react';
import {
  AccountSelect, BlipDisplaySelect, ControlMultiSelect, ControlSelect, FiveMKeyBindInput,
  blipUrlForSprite, getBlipColor, getBlipEntry,
  GroupSelect, Vector4Display, WorldPositionPicker, fetchNui, useItems,
} from 'dirk-cfx-react';
import { MeterControl } from './MeterControl';
import { RangeControl, SliderControl } from './RichControls';
import { Icon } from './Icon';
import { notify } from './Toasts';
import { AnyIcon } from './Icon';
import { ModelControl } from './ModelControl';
import { VehicleControl, VehiclesControl } from './VehicleControl';
import { PedField, PedsField } from './PedControl';
import type { ControlType, SettingColumn, SettingEntry } from './types';
import { DiscordChannelControl } from './DiscordChannelControl';
import { DurationControl } from './DurationControl';
import { ObjectPicker, type ObjectValue } from './ObjectPicker';
import { BoolChoiceControl } from './BoolChoiceControl';
import { useChrome } from './studioLocale';

// One dispatch, keyed by the schema's control type. Adding a control here is
// what "x-control" buys us: every script's panel gains it at once.

export type ControlProps = {
  type: ControlType;
  value: unknown;
  onChange: (next: unknown) => void;
  entry?: SettingEntry;
  column?: SettingColumn;
  disabled?: boolean;
  /** list types hand this up so the row can open the drill-in pane */
  onDrill?: () => void;
  compact?: boolean;
  /** the script being edited, so "give me one" is gated on ITS permissions */
  resource?: string;
};

const CONTROL_WIDTH = '32vh';

/** Why the server refused a "give me one", in words. */
const GIVE_FAILURES: Record<string, string> = {
  NoPermission: 'You are not allowed to give yourself items for this script',
  BadItem: 'That item name is not valid',
  BadRequest: 'That item name is not valid',
  NoInventory: 'No inventory bridge is running',
  InventoryError: 'The inventory refused it',
  NotAdded: 'It would not fit - your inventory may be full',
  CallbackFailed: 'The server did not answer',
};

export function useInputStyles(compact?: boolean) {
  const theme = useMantineTheme();
  return {
    input: {
      background: alpha(theme.colors.dark[9], 0.75),
      border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.55)}`,
      color: 'rgba(255,255,255,0.9)',
      fontFamily: 'Akrobat SemiBold',
      fontSize: compact ? '1.3vh' : '1.45vh',
      height: compact ? '3vh' : '3.4vh',
      minHeight: compact ? '3vh' : '3.4vh',
      borderRadius: theme.radius.xs,
      paddingInline: '0.9vh',
    },
    section: { width: '2.6vh' },
    // The POPUP, not just the box.
    //
    // This lived inline on the panel's own Select, so every input that took
    // the shared styles still opened a default Mantine dropdown - which is
    // why the control pickers looked foreign the moment you clicked them.
    // Shared here, so matching is the default rather than something each call
    // site has to remember.
    dropdown: {
      background: theme.colors.dark[8],
      border: `0.1vh solid ${theme.colors.dark[6]}`,
      borderRadius: theme.radius.xs,
    },
    option: {
      fontFamily: 'Akrobat SemiBold',
      fontSize: compact ? '1.3vh' : '1.4vh',
      borderRadius: theme.radius.xs,
    },
  };
}

/**
 * The same input look, as CSS variables.
 *
 * A few of dirk-cfx-react's inputs have closed prop types and accept no
 * `styles` at all - GroupSelect among them - so they came out looking like a
 * different product from the field above them. Rather than eyeball a matching
 * colour in CSS, the panel publishes the values it is already using and the
 * stylesheet reads them: one source, so the two can never drift.
 */
export function useInputCssVars(): React.CSSProperties {
  const styles = useInputStyles();
  return {
    '--studio-input-bg': styles.input.background,
    '--studio-input-border': styles.input.border,
    '--studio-input-radius': styles.input.borderRadius,
    '--studio-input-height': styles.input.height,
    '--studio-input-font-size': styles.input.fontSize,
    '--studio-input-padding': styles.input.paddingInline,
    '--studio-dropdown-bg': styles.dropdown.background,
    '--studio-dropdown-border': styles.dropdown.border,
    '--studio-dropdown-radius': styles.dropdown.borderRadius,
  } as React.CSSProperties;
}

/**
 * Input styles for a SEARCH box - one with a magnifier in its left section.
 *
 * The shared input padding is 0.9vh, sized for a box with nothing in front of
 * the text; with an icon there the caret starts almost on top of it. Three
 * separate search boxes had been patched by hand before this existed, so it is
 * one place rather than a habit.
 */
export function useSearchInputStyles(compact?: boolean) {
  const base = useInputStyles(compact);
  return {
    ...base,
    input: {
      ...base.input,
      paddingLeft: compact ? '3vh' : '3.4vh',
    },
    section: { width: compact ? '2.6vh' : '2.9vh' },
  };
}

/**
 * Input styles for a control with a swatch or icon in its LEFT section.
 *
 * The section is 2.6vh wide but the input's own padding is 0.9vh, so the text
 * starts underneath it - a colour input read as its hex value sandwiched into
 * its own preview swatch. The padding has to clear the section, not the border.
 */
export function useLeftSectionStyles(compact?: boolean) {
  const base = useInputStyles(compact);
  return {
    ...base,
    input: { ...base.input, paddingLeft: '3.2vh' },
  };
}

/** GTA blip palette - enough of it to make the picker read as real. */

function ControlShell({
  children, width, className,
}: { children: React.ReactNode; width?: string; className?: string }) {
  return (
    <Flex
      align="center" gap="xs"
      className={className}
      style={{ width: width ?? CONTROL_WIDTH, flexShrink: 0, justifyContent: 'flex-end' }}
    >
      {children}
    </Flex>
  );
}

/** Neutral pressable used by the pickers that would open a sub-view in game. */
function PickerButton({
  children, onClick, disabled, grow, warn,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  grow?: boolean;
  /** amber outline: the value is usable but points at something not installed */
  warn?: boolean;
}) {
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const [hovered, setHovered] = useState(false);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      style={{
        flex: grow ? 1 : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.8vh',
        height: '3.4vh',
        paddingInline: '0.9vh',
        background: alpha(theme.colors.dark[9], 0.75),
        border: `0.1vh solid ${warn
          ? alpha('#f59e0b', 0.55)
          : hovered && !disabled ? alpha(color, 0.5) : alpha(theme.colors.dark[4], 0.55)}`,
        borderRadius: theme.radius.xs,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'border-color 0.15s',
        minWidth: 0,
      }}
    >
      {children}
    </motion.button>
  );
}

/** The shared input style, freed from the single-line height it is built for. */
function textareaInput(input: Record<string, unknown>) {
  const { height: _h, minHeight: _mh, maxHeight: _xh, ...rest } = input;
  return { ...rest, paddingBlock: '0.6vh' };
}

/**
 * The 24 hours, named rather than numbered.
 *
 * Midnight and midday are called out because "0" and "12" are the two people
 * second-guess.
 */
const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: h === 0 ? '00:00 — midnight'
    : h === 12 ? '12:00 — midday'
      : `${String(h).padStart(2, '0')}:00`,
}));

export function SettingControl({ type, value, onChange, entry, column, disabled, onDrill, compact, resource }: ControlProps) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const styles = useInputStyles(compact);
  const swatchStyles = useLeftSectionStyles(compact);
  const items = useItems();
  const suffix = entry?.suffix ?? column?.suffix;
  const min = entry?.min ?? column?.min;
  const max = entry?.max ?? column?.max;
  const options = entry?.options ?? column?.options;

  switch (type) {
    case 'boolean':
      return (
        <ControlShell>
          <Switch
            checked={value === true}
            onChange={(e) => onChange(e.currentTarget.checked)}
            disabled={disabled}
            color={theme.primaryColor}
            styles={{ track: { cursor: disabled ? 'not-allowed' : 'pointer' } }}
            style={{
              '--switch-height': '2.4vh',
              '--switch-width': '4.8vh',
              '--switch-thumb-size': '1.8vh',
              '--switch-radius': '1.2vh',
            } as React.CSSProperties}
          />
        </ControlShell>
      );

    case 'number':
    case 'integer':
    case 'percent':
      return (
        <ControlShell>
          <NumberInput
            value={typeof value === 'number' ? value : undefined}
            onChange={(v) => onChange(typeof v === 'number' ? v : Number(v) || 0)}
            disabled={disabled}
            min={min}
            max={max}
            step={type === 'integer' || type === 'percent' ? 1 : 0.1}
            decimalScale={type === 'number' ? 2 : 0}
            hideControls
            suffix={suffix ? ` ${suffix}` : undefined}
            styles={styles}
            style={{ flex: 1 }}
          />
        </ControlShell>
      );

    case 'enum':
      // When the schema styles its values (`x-enumIcons` / `x-enumColors`),
      // show the real thing rather than a dropdown of words: for a place
      // category the colour and icon ARE the setting, and a grid of the actual
      // pins is what the old hand-built panel gave you.
      if ((options ?? []).some((option) => option.icon || option.color)) {
        return (
          <ControlShell width="34vh">
            <Flex gap="0.4vh" wrap="wrap" justify="flex-end" style={{ flex: 1 }}>
              {(options ?? []).map((option) => {
                const active = option.value === value;
                const hex = option.color ?? theme.colors[theme.primaryColor][5];
                return (
                  <Tooltip
                    key={option.value}
                    label={option.label}
                    position="top"
                    withArrow
                    zIndex={10800}
                    styles={{
                      tooltip: {
                        background: alpha(theme.colors.dark[7], 0.95),
                        border: '0.1vh solid rgba(255,255,255,0.1)',
                        color: 'rgba(255,255,255,0.75)',
                        fontFamily: 'Akrobat Bold',
                        fontSize: '1.2vh',
                        padding: '0.4vh 0.7vh',
                      },
                    }}
                  >
                    <motion.button
                      type="button"
                      onClick={() => !disabled && onChange(option.value)}
                      whileTap={disabled ? undefined : { scale: 0.9 }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        aspectRatio: '1 / 1', height: '2.6vh',
                        background: hex,
                        border: `0.2vh solid ${active ? '#ffffff' : alpha('#000000', 0.35)}`,
                        borderRadius: '50%',
                        boxShadow: active ? `0 0 0.7vh ${hex}` : 'none',
                        opacity: disabled ? 0.4 : active ? 1 : 0.55,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                      }}
                      aria-label={option.label}
                    >
                      <Icon name={option.icon ?? 'map-pin'} size="1.45vh" color="#ffffff" />
                    </motion.button>
                  </Tooltip>
                );
              })}
            </Flex>
          </ControlShell>
        );
      }

      return (
        <ControlShell>
          <Select
            data={(options ?? []).map((o) => ({ value: o.value, label: o.label }))}
            value={typeof value === 'string' ? value : null}
            onChange={(v) => onChange(v)}
            disabled={disabled}
            allowDeselect={false}
            // Worth typing through once there are more than a handful - eleven
            // languages is a scroll. Below that the search box is just a way to
            // type something that is not an option.
            searchable={(options?.length ?? 0) > 5}
            comboboxProps={{ zIndex: 10800 }}
            styles={styles}
            style={{ flex: 1 }}
          />
        </ControlShell>
      );

    case 'color':
      return (
        <ControlShell>
          <ColorInput
            value={typeof value === 'string' ? value : '#000000'}
            onChange={onChange}
            disabled={disabled}
            format="hex"
            withEyeDropper={false}
            popoverProps={{ zIndex: 10800 }}
            styles={swatchStyles}
            style={{ flex: 1 }}
          />
        </ControlShell>
      );

    // Our own picker modal, filled from the library's catalogue.
    //
    // The list used to be ten colours hand-written in this file, out of the
    // eighty-odd the game has. Swapping the whole control for the library's
    // dropdown fixed the list and lost the picker - so only the DATA comes
    // from there now, and the modal is the same one every other picker uses.
    case 'blipColor': {
      const blip = getBlipColor(Number(value));
      return (
        <ControlShell>
          <PickerButton onClick={onDrill} disabled={disabled} grow>
            <Flex align="center" gap="xs" style={{ minWidth: 0 }}>
              <Flex
                w="1.8vh" h="1.8vh"
                style={{ background: blip?.hex ?? '#888', borderRadius: '0.3vh', flexShrink: 0 }}
              />
              <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.85)">
                {blip?.label ?? t('controls.custom', 'Custom')}
              </Text>
              <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.35)">{String(value)}</Text>
            </Flex>
            <ChevronRight size="1.5vh" color="rgba(255,255,255,0.35)" />
          </PickerButton>
        </ControlShell>
      );
    }

    case 'enumList':
      return (
        <ControlShell>
          <MultiSelect
            data={(column?.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
            value={Array.isArray(value) ? value.map(String) : []}
            onChange={(next) => onChange(next)}
            disabled={disabled}
            clearable
            comboboxProps={{ zIndex: 10800 }}
            styles={{ ...styles, input: { ...styles.input, height: undefined, minHeight: '3.2vh' } }}
            style={{ flex: 1 }}
          />
        </ControlShell>
      );

    case 'secret':
      // Masked with a reveal toggle, as the old panel's bot-token field was.
      return (
        <ControlShell>
          <PasswordInput
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.currentTarget.value)}
            disabled={disabled}
            placeholder={t('controls.not_set', 'not set')}
            visibilityToggleIcon={({ reveal }) => (reveal
              ? <EyeOff size="1.6vh" color="rgba(255,255,255,0.6)" />
              : <Eye size="1.6vh" color="rgba(255,255,255,0.6)" />)}
            styles={{ ...styles, visibilityToggle: { marginRight: '0.4vh' } }}
            style={{ flex: 1 }}
          />
        </ControlShell>
      );

    case 'text':
      return (
        <ControlShell>
          <Textarea
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.currentTarget.value)}
            disabled={disabled}
            // NOT autosize. Mantine routes that through react-textarea-autosize,
            // which rejects any style carrying a minHeight - and the shared input
            // style is built around a fixed height. The old fishing panel landed
            // in the same place: its autosize Textarea is commented out and the
            // live one is a plain rows={3}.
            rows={3}
            styles={{ ...styles, input: textareaInput(styles.input) }}
            style={{ flex: 1 }}
          />
        </ControlShell>
      );

    case 'blipDisplay':
      return (
        <ControlShell>
          <BlipDisplaySelect
            // Empty, not undefined: the library declares `label = "Blip
            // Display"` as a default parameter, so passing undefined asks for
            // the default rather than for nothing.
            label=""
            value={typeof value === 'number' ? value : 4}
            onChange={(next) => onChange(next)}
            disabled={disabled}
            styles={styles}
            comboboxProps={{ zIndex: 10800 }}
            style={{ flex: 1 }}
          />
        </ControlShell>
      );

    case 'blipSprite': {
      const sprite = getBlipEntry(Number(value));
      const art = blipUrlForSprite(Number(value));
      return (
        <ControlShell>
          <PickerButton onClick={onDrill} disabled={disabled} grow>
            <Flex align="center" gap="xs" style={{ minWidth: 0 }}>
              {art
                ? <img src={art} alt="" style={{ width: '1.8vh', height: '1.8vh', flexShrink: 0 }} />
                : <MapPin size="1.5vh" color={color} />}
              <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.85)" truncate>
                {sprite?.name ?? `Sprite ${String(value)}`}
              </Text>
              <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.35)">{String(value)}</Text>
            </Flex>
            <ChevronRight size="1.5vh" color="rgba(255,255,255,0.35)" />
          </PickerButton>
        </ControlShell>
      );
    }

    // One framework job or gang, declared with `x-groupPicker`. A plain text
    // box here is a silent failure waiting to happen: a typo makes, say, a
    // business nobody can ever staff, and nothing ever says so.
    // A length of time, read in whatever unit divides cleanly. 86400 in a
    // number box says nothing; "1 day" says everything.
    case 'boolChoice':
      return (
        <ControlShell width="26vh">
          <BoolChoiceControl
            value={value}
            labels={entry?.boolLabels ?? column?.boolLabels}
            disabled={disabled}
            onChange={onChange}
          />
        </ControlShell>
      );

    case 'duration':
      return (
        <ControlShell width="21vh">
          <DurationControl
            value={value}
            base={entry?.durationBase ?? column?.durationBase ?? 'seconds'}
            min={min}
            max={max}
            disabled={disabled}
            compact={compact}
            onChange={onChange}
          />
        </ControlShell>
      );

    // An hour of the day. A 0-23 number box asks you to think in 24-hour time
    // AND remember that 0 is midnight; this just lists the hours.
    case 'hourOfDay':
      return (
        <ControlShell width="20vh">
          <Select
            value={typeof value === 'number' ? String(value) : null}
            onChange={(next) => onChange(next === null ? 0 : Number(next))}
            disabled={disabled}
            data={HOURS}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true, zIndex: 10400 }}
            styles={styles}
            style={{ flex: 1 }}
          />
        </ControlShell>
      );

    case 'discordChannel':
      return (
        <ControlShell width="30vh" className="studio-native">
          <DiscordChannelControl value={value} disabled={disabled} onChange={onChange} />
        </ControlShell>
      );

    case 'group':
      return (
        <ControlShell width="40vh" className="studio-native">
          <GroupSelect
            value={{ name: typeof value === 'string' ? value : '', grade: 0 }}
            onChange={(next) => onChange(next.name ?? '')}
            style={{ flex: 1 }}
          >
            <GroupSelect.Name />
          </GroupSelect>
        </ControlShell>
      );

    // An icon. This was a text box, which asked you to know that the icon
    // called "fuel" exists and is spelled that way. Nobody knows that; they
    // know what a fuel pump looks like.
    //
    // Which SET is the field's business, not the panel's: a script whose own
    // UI draws Font Awesome must keep getting Font Awesome back.
    case 'icon': {
      const iconName = typeof value === 'string' ? value : '';
      return (
        <ControlShell>
          <PickerButton onClick={onDrill} disabled={disabled} grow>
            <Flex align="center" gap="xs" style={{ minWidth: 0 }}>
              <AnyIcon name={iconName || 'help-circle'} size="1.7vh" color={color} />
              <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.85)" truncate>
                {iconName || t('controls.no_icon', 'No icon')}
              </Text>
            </Flex>
            <ChevronRight size="1.5vh" color="rgba(255,255,255,0.35)" />
          </PickerButton>
        </ControlShell>
      );
    }

    case 'account':
      // dirk_lib knows the framework's real account list; the picker asks it.
      return (
        <ControlShell width="40vh">
          <AccountSelect
            endpoint="LIST_ACCOUNTS"
            value={typeof value === 'string' ? value : null}
            onChange={(next) => onChange(next)}
            disabled={disabled}
            // No comboboxProps here: AccountSelect's props are a closed union
            // in dirk-cfx-react, so its dropdown is raised by the
            // .mantine-Combobox-dropdown rule in index.css instead.
            style={{ flex: 1 }}
            styles={styles}
            />
        </ControlShell>
      );

    case 'accounts':
      return (
        <ControlShell width="44vh">
          <AccountSelect
            endpoint="LIST_ACCOUNTS"
            multi
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={(next) => onChange(next)}
            disabled={disabled}
            style={{ flex: 1 }}
            styles={styles}
            />
        </ControlShell>
      );

    case 'model':
      // A world/prop model - searchable against the full model list.
      return (
        <ControlShell width="40vh">
          <ModelControl value={value} onChange={onChange} disabled={disabled} compact={compact} />
        </ControlShell>
      );

    case 'peds':
      return (
        <ControlShell>
          <PedsField value={value} onChange={(next) => onChange(next)} disabled={disabled} />
        </ControlShell>
      );

    // Several of them. Wide, like `peds` and `tags` — a row of chips does not
    // belong squeezed into the right-hand control column.
    case 'vehicles':
      return (
        <ControlShell>
          <VehiclesControl
            value={value}
            onChange={(next) => onChange(next)}
            disabled={disabled}
            compact={compact}
          />
        </ControlShell>
      );

    case 'vehicle':
      return (
        <ControlShell>
          <VehicleControl
            value={value}
            onChange={(next) => onChange(next)}
            disabled={disabled}
            compact={compact}
          />
        </ControlShell>
      );

    case 'ped':
      // The portrait and the catalogue, same as `peds` — not a text box asking
      // you to remember `s_m_y_dealer_01`. One is not a reason to lose the
      // picker; it is only a reason to hold one at a time.
      return (
        <ControlShell>
          <PedField value={value} onChange={(next) => onChange(next)} disabled={disabled} />
        </ControlShell>
      );

    case 'coords': {
      // The readout AND the buttons, in the row.
      //
      // This was a single button that opened a modal to do anything at all -
      // including just going to look at the place, which is the most common
      // thing you want from a coordinate and needs no editor open. The old
      // panels put Goto and Set right next to the numbers, and these are the
      // very same cfx-react controls those panels used.
      const vec = (value ?? {}) as { x?: number; y?: number; z?: number; w?: number };
      const position = {
        x: typeof vec.x === 'number' ? vec.x : 0,
        y: typeof vec.y === 'number' ? vec.y : 0,
        z: typeof vec.z === 'number' ? vec.z : 0,
        w: typeof vec.w === 'number' ? vec.w : 0,
      };

      // The picker always produces four numbers, because a player always has a
      // height and a heading. The FIELD might only want two. Writing back all
      // four gave a flat zone corner a `z` and a `w` that nothing reads, and
      // put them in every diff and every changelog line thereafter.
      const dims = entry?.vectorDims ?? column?.vectorDims ?? 4;
      const trim = (next: { x: number; y: number; z: number; w: number }) => {
        if (dims === 2) return { x: next.x, y: next.y };
        if (dims === 3) return { x: next.x, y: next.y, z: next.z };
        return next;
      };

      return (
        <ControlShell width="44vh">
          <Flex align="center" gap="xs" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Vector4Display value={position} />
            </div>
            {/*
              `WorldPositionPicker`, not the two buttons individually.

              cfx-react exports TWO Set buttons and they do different things.
              The standalone `WorldPositionSetButton` calls `GET_POSITION` and
              writes your current coordinates immediately - no walking, no
              instruction card, nothing to confirm. The one inside
              `WorldPositionPicker` speaks the admin-tool router: it hides the
              panel, shows the card, and waits for E.

              This used the first, so Set looked broken by working instantly -
              and Goto, which only has one implementation, worked fine and made
              it look like the wiring was sound.
            */}
            <Flex gap="0.3vh" style={{ flexShrink: 0 }}>
              <WorldPositionPicker
                value={position}
                onChange={(next: { x: number; y: number; z: number; w: number }) => onChange(trim(next))}
                compact
              />
            </Flex>
          </Flex>
        </ControlShell>
      );
    }

    case 'prop': {
      // A prop, put where it goes rather than typed. Same admin-tool round
      // trip as `coords` - the panel hides, the game hands back an answer -
      // but the thing being positioned is visible while you position it, so
      // the placer spawns the real model and you look at it.
      const obj = (value ?? {}) as Partial<ObjectValue>;
      return (
        <ControlShell width="44vh">
          <ObjectPicker
            value={{
              x: typeof obj.x === 'number' ? obj.x : 0,
              y: typeof obj.y === 'number' ? obj.y : 0,
              z: typeof obj.z === 'number' ? obj.z : 0,
              w: typeof obj.w === 'number' ? obj.w : 0,
              rx: typeof obj.rx === 'number' ? obj.rx : 0,
              ry: typeof obj.ry === 'number' ? obj.ry : 0,
            }}
            model={entry?.propModel ?? column?.propModel}
            // Pick will only accept these. One entry today; a field that can
            // use several props lists them all.
            allow={[entry?.propModel ?? column?.propModel].filter(Boolean) as string[]}
            disabled={disabled}
            onChange={onChange}
          />
        </ControlShell>
      );
    }

    case 'chance': case 'multiplier': case 'difficulty':
    case 'forgiveness': case 'rarity': case 'balance': case 'progression':
    case 'generosity':
      return (
        <ControlShell width="30vh">
          <MeterControl
            scale={type}
            value={value}
            min={entry?.min ?? column?.min}
            max={entry?.max ?? column?.max}
            disabled={disabled}
            compact={compact}
            onChange={onChange}
          />
        </ControlShell>
      );

    case 'time':
      return (
        <ControlShell>
          <TextInput
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.currentTarget.value)}
            disabled={disabled}
            placeholder={t('controls.hh_mm', 'HH:MM')}
            styles={{ ...styles, input: { ...styles.input, fontFamily: 'monospace', textAlign: 'center' } }}
            style={{ flex: 1 }}
          />
        </ControlShell>
      );

    case 'keybind': {
      // dirk-cfx-react owns the key catalogue and the { _type, _key } shape -
      // this is a keybind primary key, NOT a numeric game control id.
      const bind = (value && typeof value === 'object' && '_key' in (value as object))
        ? (value as { _type: string; _key: string })
        : { _type: 'keyboard', _key: typeof value === 'string' ? value : '' };
      return (
        <ControlShell width="44vh">
          <FiveMKeyBindInput value={bind} onChange={(next) => onChange(next)}>
            <FiveMKeyBindInput.Category />
            <FiveMKeyBindInput.Key />
          </FiveMKeyBindInput>
        </ControlShell>
      );
    }

    case 'control':
      // A single numeric control id (IsControlPressed / DisableControlAction).
      return (
        <ControlShell width="44vh">
          <ControlSelect
            value={typeof value === 'number' ? value : null}
            onChange={(next) => onChange(next)}
            disabled={disabled}
            label={undefined}
            comboboxProps={{ zIndex: 10800 }}
            styles={styles}
            style={{ flex: 1 }}
          />
        </ControlShell>
      );

    case 'item': {
      const name = typeof value === 'string' ? value : '';
      // Configured but not installed. This is allowed on purpose - you can name
      // an item you have not added yet and add it before the next restart - so
      // it is flagged, not blocked.
      const missing = !!name && !items[name];
      return (
        <ControlShell>
          {missing && (
            <Tooltip
              label={t(
                'controls.not_in_inventory',
                'No item by this name is installed. It will not exist in game until you add it to your inventory.',
              )}
              position="top"
              withArrow
              multiline
              w={280}
              zIndex={10500}
              styles={{
                tooltip: {
                  background: alpha(theme.colors.dark[7], 0.97),
                  border: `0.1vh solid ${alpha('#f59e0b', 0.4)}`,
                  color: 'rgba(255,255,255,0.8)',
                  fontFamily: 'Akrobat SemiBold',
                  fontSize: '1.2vh',
                  padding: '0.6vh 0.8vh',
                  lineHeight: 1.35,
                },
              }}
            >
              <Flex
                align="center" justify="center"
                style={{
                  aspectRatio: '1 / 1', height: '3.4vh',
                  background: alpha('#f59e0b', 0.12),
                  border: `0.1vh solid ${alpha('#f59e0b', 0.45)}`,
                  borderRadius: theme.radius.xs,
                  cursor: 'help', flexShrink: 0,
                }}
              >
                <AlertTriangle size="1.5vh" color="#f59e0b" />
              </Flex>
            </Tooltip>
          )}
          {name && (
            <Tooltip
              label={t('controls.give_yourself_one', 'Give yourself one')}
              position="top"
              withArrow
              zIndex={10500}
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
                onClick={async (e) => {
                  e.stopPropagation();
                  // Gated on the script being EDITED, and it says what happened.
                  //
                  // The old call went through dirk_lib's own give-item callback
                  // whichever script you were looking at, so it was checked
                  // against permission to edit dirk_lib rather than that script
                  // - and its answer was thrown away, so a refusal looked
                  // exactly like a button that did nothing.
                  const reply = await fetchNui<{ success?: boolean; _error?: string }>(
                    'GIVE_ITEM',
                    { resource: resource ?? 'dirk_lib', item: name, count: 1 },
                    { success: true },
                  ).catch(() => ({ success: false, _error: 'CallbackFailed' }));

                  if (reply?.success) {
                    notify('success', t('controls.gave_you_one', 'Gave you 1x {}').replace('{}', name));
                  } else {
                    notify('error', GIVE_FAILURES[reply?._error ?? ''] ?? t('controls.give_failed', 'Could not give you that item'));
                  }
                }}
                whileHover={{ background: alpha(color, 0.16), borderColor: alpha(color, 0.5) }}
                whileTap={{ scale: 0.94 }}
                style={{
                  aspectRatio: '1 / 1', height: '3.4vh',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent',
                  border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.55)}`,
                  borderRadius: theme.radius.xs,
                  cursor: 'pointer', color: 'rgba(255,255,255,0.55)', flexShrink: 0,
                }}
                aria-label={t('controls.give_yourself_one', 'Give yourself one')}
              >
                <PackagePlus size="1.5vh" />
              </motion.button>
            </Tooltip>
          )}
          <PickerButton onClick={onDrill} disabled={disabled} grow warn={missing}>
            <Flex align="center" gap="xs" style={{ minWidth: 0 }}>
              <ItemArt name={name} size="2.4vh" />
              <Text
                ff="monospace" size="xxs" truncate
                c={missing ? '#f59e0b' : name ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)'}
              >
                {name || t('controls.pick_an_item', 'pick an item')}
              </Text>
            </Flex>
            <ChevronRight size="1.5vh" color="rgba(255,255,255,0.35)" />
          </PickerButton>
        </ControlShell>
      );
    }

    case 'list': {
      const rows = Array.isArray(value) ? value : [];
      return (
        <ControlShell>
          <PickerButton onClick={onDrill} disabled={disabled} grow>
            <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.7)">
              {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
            </Text>
            <Flex align="center" gap="xxs" style={{ flexShrink: 0 }}>
              <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.05em" c={color}>{t('controls.edit', 'Edit')}</Text>
              <ChevronRight size="1.5vh" color={color} />
            </Flex>
          </PickerButton>
        </ControlShell>
      );
    }

    // A [min, max] pair, and the sliders that go with it.
    //
    // These were wired into the ROW editor only, so the same type at the top
    // level - `cellFishDensity`, `gridDensity` - fell through to the default
    // text box and rendered as one empty field.
    //
    // NOTE the position: `case 'string'` is a deliberate fall-through to the
    // default text box, so anything added between the two silently becomes
    // the control for every string in the panel. These belong ABOVE it.
    case 'range':
      return (
        // The standard width, so the MIN box lines up with the control in the
        // row above and below rather than starting two vh to the left.
        <ControlShell>
          <RangeControl
            value={value}
            min={entry?.min ?? column?.min}
            max={entry?.max ?? column?.max}
            step={entry?.step ?? column?.step}
            suffix={suffix}
            disabled={disabled}
            onChange={onChange}
          />
        </ControlShell>
      );

    case 'slider':
      return (
        <ControlShell width="30vh">
          <SliderControl
            value={value}
            min={entry?.min ?? column?.min}
            max={entry?.max ?? column?.max}
            bands={entry?.bandLabels ?? column?.bandLabels}
            disabled={disabled}
            onChange={onChange}
          />
        </ControlShell>
      );

    case 'string':
    default:
      return (
        <ControlShell>
          <TextInput
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.currentTarget.value)}
            disabled={disabled}
            styles={styles}
            style={{ flex: 1 }}
          />
        </ControlShell>
      );
  }
}

/** Wide types get their own full-width row instead of a right-hand control. */
/**
 * How much room a control needs.
 *
 *   inline    - a row. A toggle, a number, a dropdown.
 *   wide      - the full row width, and it FLOWS with the page scroll.
 *   workspace - a map, a canvas, an editor. It does not want to flow; it wants
 *               to FIT. Left to itself it either picks a magic height or grows
 *               past the bottom of the window.
 *
 * The third one had no name until now, so every workspace control guessed its
 * own number - 56vh here, 48vh there, nothing at all in a script's own
 * component - and a map ended up taller than the window with the page
 * scrolling behind it.
 */
export type ControlSize = 'inline' | 'wide' | 'workspace';

/**
 * The height a workspace control fills.
 *
 * Simply all of it. A workspace section replaces the scrolling stack with a
 * definite-height flex column, so the control fills its parent and needs no
 * arithmetic at all.
 *
 * It was briefly a `vh` figure, which was wrong twice over: `vh` measures the
 * VIEWPORT, and the panel is 84vh when windowed — so a control taking a slice
 * of the viewport overflowed a window it knew nothing about. Giving the
 * container a real height removes the sum rather than correcting it.
 */
export const PANE_HEIGHT = '100%';

/**
 * The floor a workspace control never goes below.
 *
 * `100%` only means anything when every parent up the chain has a definite
 * height, and the row a setting renders in does not - so a map asked for 100%
 * of `auto` and got ZERO. Blank, with no error, because the component had
 * loaded perfectly well and simply had nowhere to draw.
 *
 * The floor makes that unreachable: where the pane does give a height, 100%
 * wins; where it does not, the control is still a usable size.
 */
export const PANE_MIN_HEIGHT = '52vh';

export function controlSize(type: ControlType): ControlSize {
  // A map or a script's own editor claims the pane.
  if (type === 'zones' || type === 'custom') return 'workspace';
  return isWideType(type) ? 'wide' : 'inline';
}

export function isWideType(type: ControlType): boolean {
  return type === 'list' || type === 'zones' || type === 'palette'
    || type === 'controls' || type === 'keyvalue' || type === 'groups'
    || type === 'keybindMap' || type === 'mantineColor' || type === 'shade'
    || type === 'groupGrades' || type === 'refs' || type === 'weekdays' || type === 'positions' || type === 'pickList' || type === 'weightMap'
    // A script's own editor gets the full row width and renders inline in the
    // section, with the same scroll, rail and save bar as everything else.
    || type === 'custom'
    // the grid needs the row width to be worth looking at
    || type === 'icon';
}

/** Array of numeric control ids - the library's own multi picker. */
export function ControlsControl({
  value, onChange, disabled,
}: { value: unknown; onChange: (next: unknown) => void; disabled?: boolean }) {
  // Its own copy, because this one sits outside SettingControl - and a picker
  // that looks like a different product from the field above it is exactly
  // what the shared styles exist to prevent.
  const styles = useInputStyles();
  const ids = Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : [];
  return (
    <ControlMultiSelect
      styles={styles}
      value={ids}
      onChange={(next) => onChange(next)}
      disabled={disabled}
      label={undefined}
      comboboxProps={{ zIndex: 10800 }}
      style={{ width: '100%' }}
    />
  );
}
