import { alpha, Flex, Text, TextInput, useMantineTheme } from '@mantine/core';
import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import * as lucide from 'lucide-react';
import { useMemo, useState } from 'react';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { AnyIcon, parseFaIcon } from './Icon';
import { useChrome } from './studioLocale';

/**
 * Pick a lucide icon by looking at it.
 *
 * An icon field was a text box, so setting one meant knowing that the icon
 * called "fuel" exists and is spelled that way. Nobody knows that. They know
 * what a fuel pump looks like.
 *
 * The whole set is already in the bundle - icons resolve by name from it - so
 * showing them costs nothing beyond the rendering, and only what matches the
 * search is ever rendered.
 */

/**
 * Font Awesome's solid set, by the name it answers to.
 *
 * A script that already draws Font Awesome cannot be handed a lucide name -
 * the value here is what its own UI renders, so writing "fuel" into a field
 * fishing passes to Font Awesome just breaks the icon. The set is a property
 * of the FIELD, declared by the schema, not something to infer.
 */
const FA_ICONS: string[] = [...new Set(
  Object.values(fas).map((icon) => (icon as { iconName?: string }).iconName).filter(Boolean) as string[],
)].sort();

export type IconSet = 'lucide' | 'fontawesome' | 'both';

/** kebab-case names, derived from lucide's own exports rather than a list. */
const ALL_ICONS: string[] = (() => {
  const seen = new Set<string>();
  for (const key of Object.keys(lucide)) {
    // Components are PascalCase; skip the `LucideFoo` and `FooIcon` aliases so
    // each icon appears once.
    if (!/^[A-Z]/.test(key)) continue;
    if (key.startsWith('Lucide') || key.endsWith('Icon')) continue;
    if (key === 'Icon' || key === 'createLucideIcon') continue;
    seen.add(key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase());
  }
  return [...seen].sort();
})();

/**
 * One catalogue entry, carrying the value it STORES alongside the name it is
 * searched by.
 *
 * `both` is why this exists. The set used to be a property of the field alone,
 * so the picker could convert a name to a value with one rule. Offering two
 * sets at once means each icon has to carry its own - and it already can: a
 * Font Awesome value is `fa-solid fa-fish` and a lucide one is a bare
 * `fish`, which `parseFaIcon` tells apart with no extra field to store and
 * nothing to migrate. `AnyIcon` renders either, so everything downstream of
 * the picker already worked.
 */
type Entry = { value: string; name: string; set: 'lucide' | 'fontawesome' };

const LUCIDE_ENTRIES: Entry[] = ALL_ICONS.map((name) => ({ value: name, name, set: 'lucide' }));
const FA_ENTRIES: Entry[] = FA_ICONS.map((name) => ({
  value: `fa-solid fa-${name}`, name, set: 'fontawesome',
}));

/** Which set a stored value belongs to, read from the value itself. */
function setOfValue(value: string): 'lucide' | 'fontawesome' {
  return parseFaIcon(value) ? 'fontawesome' : 'lucide';
}

/**
 * No cap.
 *
 * Capping the list assumed you know what to search for. Nobody knows the name
 * of an icon they have not seen - browsing IS how you pick one, the same way
 * it is for blip sprites - and a hundred and twenty of fifteen hundred meant
 * the answer was usually not on screen and there was no way to reach it.
 */

export function IconPicker({
  value, onChange, disabled, set = 'lucide',
}: {
  value: unknown;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** which icon set this field's value belongs to - schema `x-iconSet` */
  set?: IconSet;
}) {
  const theme = useMantineTheme();
  const t = useChrome();
  const color = theme.colors[theme.primaryColor][5];
  const [query, setQuery] = useState('');

  const stored = typeof value === 'string' ? value : '';

  // On a `both` field the tab starts on the set the current value came from, so
  // opening a picker on a Font Awesome icon does not look like it has nothing
  // selected.
  const [tab, setTab] = useState<'lucide' | 'fontawesome'>(() => setOfValue(stored));

  const catalogue = useMemo(() => {
    if (set === 'fontawesome') return FA_ENTRIES;
    if (set === 'lucide') return LUCIDE_ENTRIES;
    return tab === 'fontawesome' ? FA_ENTRIES : LUCIDE_ENTRIES;
  }, [set, tab]);

  const current = useMemo(
    () => catalogue.find((entry) => entry.value === stored)?.name ?? '',
    [catalogue, stored],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      // With no search, lead with whatever is already set so it is visible
      // rather than buried alphabetically.
      const rest = catalogue.filter((entry) => entry.value !== stored);
      const active = catalogue.find((entry) => entry.value === stored);
      return active ? [active, ...rest] : rest;
    }
    return catalogue.filter((entry) => entry.name.includes(needle));
  }, [query, stored, catalogue]);

  return (
    <Flex direction="column" gap="xs" style={{ width: '100%', flex: 1, minHeight: 0 }}>
      <Flex align="center" gap="xs">
        <Flex
          align="center" justify="center"
          w="3.6vh" h="3.6vh"
          style={{
            background: alpha(theme.colors.dark[9], 0.7),
            border: `0.1vh solid ${alpha(color, 0.4)}`,
            borderRadius: theme.radius.xs,
            flexShrink: 0,
          }}
        >
          <AnyIcon name={stored || 'help-circle'} size="2vh" color={color} />
        </Flex>

        <TextInput
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={t('iconPicker.search', 'Search icons…')}
          leftSection={<Search size="1.5vh" color="rgba(255,255,255,0.35)" />}
          disabled={disabled}
          styles={{
            input: {
              background: alpha(theme.colors.dark[9], 0.75),
              border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.55)}`,
              color: 'rgba(255,255,255,0.9)',
              fontFamily: 'Akrobat SemiBold',
              fontSize: '1.4vh',
              height: '3.6vh',
              minHeight: '3.6vh',
              // clears the icon's own well, or the caret starts under it
              paddingLeft: '3.6vh',
            },
            section: { width: '3vh' },
          }}
          style={{ flex: 1 }}
        />

        <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.3)" style={{ flexShrink: 0 }}>
          {current || t('iconPicker.none', 'none')}
        </Text>
      </Flex>

      {/* Only where the field takes either. One set stays a plain grid — a
          switcher with nothing to switch to is just chrome. */}
      {set === 'both' && (
        <Flex gap="0.3vh" style={{ flexShrink: 0 }}>
          {([
            ['lucide', t('iconPicker.lucide', 'Lucide')],
            ['fontawesome', t('iconPicker.fontAwesome', 'Font Awesome')],
          ] as const).map(([id, label]) => {
            const active = tab === id;
            return (
              <motion.button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                whileTap={{ scale: 0.98 }}
                style={{
                  flex: 1,
                  padding: '0.5vh 0.8vh',
                  background: active ? alpha(color, 0.16) : alpha(theme.colors.dark[9], 0.5),
                  border: `0.1vh solid ${active ? alpha(color, 0.5) : alpha(theme.colors.dark[5], 0.35)}`,
                  borderRadius: theme.radius.xs,
                  cursor: 'pointer',
                }}
              >
                <Text
                  ff="Akrobat SemiBold"
                  size="xs"
                  c={active ? color : 'rgba(255,255,255,0.45)'}
                >
                  {label}
                </Text>
              </motion.button>
            );
          })}
        </Flex>
      )}

      <Flex
        gap="0.3vh" wrap="wrap" p="0.4vh"
        className="studio-scroll"
        style={{
          background: alpha(theme.colors.dark[9], 0.4),
          border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.35)}`,
          borderRadius: theme.radius.xs,
          flex: 1,
          minHeight: 0,
          alignContent: 'flex-start',
          overflowY: 'auto',
        }}
      >
        {shown.map((entry) => {
          const { value: entryValue, name } = entry;
          const active = entryValue === stored;
          return (
            <motion.button
              key={entryValue}
              type="button"
              title={name}
              onClick={() => !disabled && onChange(entryValue)}
              whileTap={disabled ? undefined : { scale: 0.9 }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                aspectRatio: '1 / 1', height: '3vh',
                background: active ? alpha(color, 0.18) : 'transparent',
                border: `0.1vh solid ${active ? alpha(color, 0.55) : 'transparent'}`,
                borderRadius: theme.radius.xs,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.4 : 1,
              }}
              aria-label={name}
            >
              <AnyIcon
                name={entryValue}
                size="1.7vh"
                color={active ? color : 'rgba(255,255,255,0.6)'}
              />
            </motion.button>
          );
        })}

        {shown.length === 0 && (
          <Flex align="center" justify="center" style={{ width: '100%', padding: '1.4vh' }}>
            <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.3)">
              {t('iconPicker.noMatch', 'No icon matches that')}
            </Text>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
