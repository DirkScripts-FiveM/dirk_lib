import { alpha, Flex, Text, useMantineTheme } from '@mantine/core';
import { motion } from 'framer-motion';
import { CornerDownRight, SearchX } from 'lucide-react';
import { useMemo } from 'react';
import { Icon } from './Icon';
import { matchesSearch, rowMatches, useStudio } from './store';
import { sectionKey, settingKey, translate, useActiveLanguage, useBundles, useChrome } from './studioLocale';
import type { SettingEntry, StudioScript } from './types';

/**
 * One search, across every script.
 *
 * The search box only ever filtered the script you were already looking at, so
 * standing on Overview - which is where you land - and typing did nothing at
 * all. That is the one moment you are most likely to be searching: you know
 * the setting exists somewhere and you do not know which script owns it, which
 * is precisely the question the rail cannot answer.
 *
 * Results are grouped BY SCRIPT rather than merged, because "which script is
 * this one in" is half the answer. Clicking a result goes there.
 */
export function SearchResults({
  query, onOpen,
}: {
  query: string;
  /** take me to this setting: script, then section */
  /**
   * Take me there.
   *
   * `row` is what turns "the right section" into "the right thing": a result
   * named a scrapyard, a store, a fish — landing on the section it lives in
   * and leaving you to find it again is most of the work still to do.
   */
  onOpen: (resource: string, group: string, target?: { list: string; row: number }) => void;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const scripts = useStudio((s) => s.scripts);
  const language = useActiveLanguage();
  const bundles = useBundles();

  const hits = useMemo(() => {
    const needle = query.trim();
    if (!needle) return [];

    return scripts
      .map((script) => {
        const groups = new Map<string, { group: string; label: string; icon: string; entries: SettingEntry[] }>();

        for (const entry of script.entries) {
          const groupLabel = translate(
            bundles, language, script.resource,
            sectionKey(entry.group, 'label'),
            script.groups.find((g) => g.id === entry.group)?.label ?? entry.group,
          );
          if (!matchesSearch(entry, groupLabel, needle)) continue;

          // A setting whose section the panel does not show has nowhere to be
          // opened - the Access block lives on its own page. Listing it here
          // would offer a destination that does not exist.
          const known = script.groups.find((g) => g.id === entry.group);
          if (!known) continue;

          const bucket = groups.get(entry.group) ?? {
            group: entry.group, label: groupLabel, icon: known.icon, entries: [],
          };
          bucket.entries.push(entry);
          groups.set(entry.group, bucket);
        }

        return { script, groups: [...groups.values()] };
      })
      .filter((result) => result.groups.length > 0);
  }, [scripts, query, bundles, language]);

  const total = hits.reduce(
    (sum, hit) => sum + hit.groups.reduce((n, g) => n + g.entries.length, 0),
    0,
  );

  if (total === 0) {
    return (
      <Flex direction="column" align="center" justify="center" gap="xs" style={{ flex: 1 }}>
        <SearchX size="2.6vh" color="rgba(255,255,255,0.2)" />
        <Text ff="Akrobat Bold" size="sm" c="rgba(255,255,255,0.4)">
          {t('search.none', 'Nothing matches')} “{query}”
        </Text>
        <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.28)">
          {t('search.noneHint', 'Every script was searched, including the shared settings')}
        </Text>
      </Flex>
    );
  }

  return (
    <Flex
      direction="column" gap="md" p="md"
      className="studio-scroll"
      style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}
    >
      <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.35)">
        {total} {total === 1 ? t('search.result', 'result') : t('search.results', 'results')}
        {' '}{t('search.acrossScripts', 'across')} {hits.length}
        {' '}{hits.length === 1 ? t('search.script', 'script') : t('search.scripts', 'scripts')}
      </Text>

      {hits.map(({ script, groups }) => (
        <ScriptHits
          key={script.resource}
          script={script}
          groups={groups}
          query={query}
          color={color}
          onOpen={onOpen}
        />
      ))}
    </Flex>
  );
}

function ScriptHits({
  script, groups, query, color, onOpen,
}: {
  script: StudioScript;
  groups: { group: string; label: string; icon: string; entries: SettingEntry[] }[];
  query: string;
  color: string;
  onOpen: (resource: string, group: string, target?: { list: string; row: number }) => void;
}) {
  const theme = useMantineTheme();
  const language = useActiveLanguage();
  const bundles = useBundles();

  return (
    <Flex direction="column" gap="xs">
      <Flex align="center" gap="xs">
        <Icon name={script.icon} size="1.7vh" color={color} />
        <Text ff="Akrobat Bold" size="sm" c="rgba(255,255,255,0.9)" tt="uppercase" lts="0.06em">
          {script.label}
        </Text>
        <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.25)">{script.resource}</Text>
      </Flex>

      <Flex direction="column" gap="xxs">
        {groups.map((group) => (
          <Flex key={group.group} direction="column" gap="xxs">
            {group.entries.map((entry) => (
              <motion.button
                key={entry.path}
                type="button"
                onClick={() => {
                  // A row hit lands ON the row. `rowMatches` is the same
                  // function the in-script cards use, so both roads end in the
                  // same place rather than one of them stopping short.
                  const hit = rowMatches(entry, query)[0];
                  onOpen(
                    script.resource,
                    group.group,
                    hit ? { list: entry.path, row: hit.index } : undefined,
                  );
                }}
                whileHover={{ background: alpha(color, 0.1) }}
                whileTap={{ scale: 0.997 }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.8vh',
                  padding: '0.6vh 0.8vh',
                  background: alpha(theme.colors.dark[8], 0.5),
                  border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.35)}`,
                  borderRadius: theme.radius.xs,
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                }}
              >
                <Icon name={group.icon} size="1.4vh" color="rgba(255,255,255,0.3)" />

                <Flex direction="column" style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
                  <Text ff="Akrobat Bold" size="xs" c="rgba(255,255,255,0.88)" truncate>
                    {translate(
                      bundles, language, script.resource,
                      settingKey(entry.path, 'label'), entry.label,
                    )}
                  </Text>
                  <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.28)" truncate>
                    {group.label} · {entry.path}
                    {/* Name the ROW that matched, not just the list holding it
                        — "Stores" is not an answer to "where is Cypress". */}
                    {(() => {
                      const hit = rowMatches(entry, query)[0];
                      return hit ? ` · ${hit.title}` : '';
                    })()}
                  </Text>
                </Flex>

                <CornerDownRight size="1.3vh" color="rgba(255,255,255,0.25)" />
              </motion.button>
            ))}
          </Flex>
        ))}
      </Flex>

      {/* the query is what the reader is scanning for, so keep it visible */}
      <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.2)">
        {groups.reduce((n, g) => n + g.entries.length, 0)} matching “{query}”
      </Text>
    </Flex>
  );
}
