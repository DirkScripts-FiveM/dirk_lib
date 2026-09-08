/**
 * "It's over here" — results the pane in front of you cannot show.
 *
 * ── the gap this fills ──────────────────────────────────────────────────────
 *
 * Searching inside a script filters the SCROLLING sections in place, which
 * works for ordinary settings and cannot work for a workspace — a map, a list
 * editor. Those are not in the scroll; they replace it, one at a time, opened
 * from the rail. So a match inside one had nowhere to appear: the rail lit up,
 * the pane showed nothing about it, and you had to click the section and then
 * find the tab yourself.
 *
 * The cross-script results list already knew how to link somewhere. It just
 * never rendered while the current script had any other match, which is most of
 * the time.
 *
 * So these are cards, above the filtered pane rather than instead of it. They
 * name the thing that matched — the yard, the store, the fish, by ITS name, not
 * the setting's — say which section and tab it is on, and take you there.
 */
import { alpha, Flex, Text, useMantineTheme } from '@mantine/core';
import { motion } from 'framer-motion';
import { CornerDownRight } from 'lucide-react';
import { Icon } from './Icon';
import { useChrome } from './studioLocale';

export type SearchLink = {
  /** the thing that matched, by its own name */
  title: string;
  /** where it lives: section, and the tab within the row when one matched */
  section: string;
  tab?: string;
  /** what matched INSIDE the row, when the hit was in a nested table */
  within?: string;
  icon: string;
  /** what clicking does */
  go: () => void;
};

export function SearchLinks({ links }: { links: SearchLink[] }) {
  const theme = useMantineTheme();
  const t = useChrome();
  const color = theme.colors[theme.primaryColor][5];

  if (links.length === 0) return null;

  return (
    <Flex direction="column" gap="xxs" mb="xs">
      <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.08em" c="rgba(255,255,255,0.3)">
        {t('searchLinks.elsewhere', 'Found elsewhere in this script')}
      </Text>

      {links.map((link, i) => (
        <motion.button
          key={`${link.section}:${link.title}:${i}`}
          type="button"
          onClick={link.go}
          whileHover={{ background: alpha(color, 0.12) }}
          whileTap={{ scale: 0.995 }}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.8vh',
            width: '100%', padding: '0.7vh 0.9vh',
            background: alpha(theme.colors.dark[9], 0.45),
            border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.45)}`,
            borderRadius: theme.radius.xs,
            cursor: 'pointer', textAlign: 'left',
          }}
        >
          <Icon name={link.icon} size="1.6vh" color={color} />

          <Flex direction="column" style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
            <Text ff="Akrobat Bold" size="xs" c="rgba(255,255,255,0.88)" truncate>
              {link.title}
            </Text>
            <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.35)" truncate>
              {link.tab ? `${link.section} › ${link.tab}` : link.section}
              {/* A nested hit names the parent row, so without this the card is
                  a name with no clue why it is a result. */}
              {link.within ? `  ·  ${link.within}` : ''}
            </Text>
          </Flex>

          <CornerDownRight size="1.4vh" color="rgba(255,255,255,0.3)" />
        </motion.button>
      ))}
    </Flex>
  );
}
