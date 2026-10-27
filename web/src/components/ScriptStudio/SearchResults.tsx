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
      <div className="ss-empty">
        <SearchX />
        <div className="T">{t('search.none', 'Nothing matches')} “{query}”</div>
        <div className="D">{t('search.noneHint', 'Every script was searched, including the shared settings')}</div>
      </div>
    );
  }

  return (
    <div className="ss-sres studio-scroll">
      <span className="L">
        {total} {total === 1 ? t('search.result', 'result') : t('search.results', 'results')}
        {' '}{t('search.acrossScripts', 'across')} {hits.length}
        {' '}{hits.length === 1 ? t('search.script', 'script') : t('search.scripts', 'scripts')}
      </span>

      {hits.map(({ script, groups }) => (
        <ScriptHits
          key={script.resource}
          script={script}
          groups={groups}
          query={query}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

/** The query, lit up where it appears in a result. */
function Lit({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<em>{text.slice(at, at + needle.length)}</em>{text.slice(at + needle.length)}</>;
}

function ScriptHits({
  script, groups, query, onOpen,
}: {
  script: StudioScript;
  groups: { group: string; label: string; icon: string; entries: SettingEntry[] }[];
  query: string;
  onOpen: (resource: string, group: string, target?: { list: string; row: number }) => void;
}) {
  const language = useActiveLanguage();
  const bundles = useBundles();
  const count = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div className="sg">
      <div className="pl sgh edge in">
        <div className="sk">
          <Icon name={script.icon} size="1.8vh" color="var(--a)" />
          <span className="act">{script.label}</span>
          <span className="cap dark"><b>{count}</b></span>
        </div>
      </div>

      {groups.map((group) => group.entries.map((entry, k) => {
        // Name the ROW that matched, not just the list holding it - "Stores"
        // is not an answer to "where is Cypress".
        const hit = rowMatches(entry, query)[0];
        return (
          <div
            key={entry.path}
            className="pl sr in"
            style={{ '--i': Math.min(k, 10) } as React.CSSProperties}
            onClick={() => {
              // A row hit lands ON the row. `rowMatches` is the same function
              // the in-script cards use, so both roads end in the same place
              // rather than one of them stopping short.
              onOpen(script.resource, group.group, hit ? { list: entry.path, row: hit.index } : undefined);
            }}
          >
            <div className="sk">
              <Icon name={group.icon} size="1.6vh" color="rgba(255,255,255,0.45)" />
              <div className="tx">
                <div className="t">
                  <Lit text={translate(bundles, language, script.resource, settingKey(entry.path, 'label'), entry.label)} query={query} />
                </div>
                <div className="p">{entry.path}{hit ? ` · ${hit.title}` : ''}</div>
              </div>
              <span className="crumb">{group.label}</span>
              <CornerDownRight className="ico" />
            </div>
          </div>
        );
      }))}
    </div>
  );
}
