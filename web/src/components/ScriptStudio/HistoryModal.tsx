import { alpha, Flex, Select, Text, TextInput, useMantineTheme } from '@mantine/core';
import { Modal } from './Dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight, History, Search, Undo2, User } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query';
import { fetchNui, isEnvBrowser } from 'dirk-cfx-react';
import { studioQueryClient } from './studioQuery';
import { MOCK_HISTORY, type HistoryChange, type HistoryEntry } from './mockHistory';
import { StudioButton } from './ui';
import { useChrome } from './studioLocale';

/** One page of the change log, as the server hands it over. */
type HistoryPage = {
  items?: HistoryEntry[];
  /** what pre-1.2.81 builds called it */
  entries?: HistoryEntry[];
  total?: number;
  nextOffset?: number | null;
};

/**
 * Who changed what, when - and the way back.
 *
 * Two kinds of revert, deliberately distinct:
 *   - one change    -> stage that single path back to its previous value
 *   - a whole save  -> stage every path in that save back
 * Neither writes on its own: both stage into the same draft as a manual edit,
 * so an admin still reviews and presses Save. A revert is a normal change, and
 * it gets its own history entry when saved.
 */
/**
 * The change log for one script, as a plain panel.
 *
 * Split out of the modal so the Logs page can show the same thing as a tab -
 * config edits and game events are both "what happened here", and having them
 * in two separate places meant looking twice.
 */
export function HistoryPanel(props: {
  resource: string;
  canEdit: boolean;
  onRevert?: (changes: { path: string; value: unknown }[]) => void;
  onStats?: (stats: { saves: number; changes: number }) => void;
  footer?: React.ReactNode;
}) {
  return (
    <QueryClientProvider client={studioQueryClient}>
      <HistoryPanelInner {...props} />
    </QueryClientProvider>
  );
}

/**
 * How the server should order the log. Ordering happens THERE, so it holds
 * across pages rather than just re-arranging the page you can see.
 */
const SORTS: { value: string; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'changes', label: 'Most changes' },
  { value: 'admin', label: 'By admin' },
];

const PAGE = 25;

function HistoryPanelInner({
  resource, canEdit, onRevert, onStats, footer,
}: {
  resource: string;
  canEdit: boolean;
  /** stage a path back to a previous value */
  onRevert?: (changes: { path: string; value: unknown }[]) => void;
  /** lets a host render counts in its own chrome */
  onStats?: (stats: { saves: number; changes: number }) => void;
  footer?: React.ReactNode;
}) {
  const t = useChrome();
  const theme = useMantineTheme();

  const [query, setQuery] = useState('');
  const [pathFilter, setPathFilter] = useState('');
  const [adminFilter, setAdminFilter] = useState('');
  const [sort, setSort] = useState<string>('newest');
  const [expanded, setExpanded] = useState<number | null>(0);

  // Typing stays instant; the fetch waits for the deferred value, so a
  // keystroke does not become a round trip.
  const search = useDeferredValue(query);
  const path = useDeferredValue(pathFilter);
  const admin = useDeferredValue(adminFilter);

  // Filtering, ordering and paging all happen on the SERVER, and react-query
  // caches each page - going back to a filter you already used costs nothing.
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['scriptConfigHistory', resource, { search, path, admin, sort }],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const offset = pageParam as number;
      if (isEnvBrowser()) {
        const all = MOCK_HISTORY[resource] ?? [];
        return {
          items: all.slice(offset, offset + PAGE),
          total: all.length,
          nextOffset: offset + PAGE < all.length ? offset + PAGE : null,
        };
      }
      const reply = await fetchNui<HistoryPage>('GET_SCRIPT_STUDIO_HISTORY', {
        resource, offset, limit: PAGE, query: search, path, admin, sort,
      }, { items: [], total: 0, nextOffset: null });
      // The server calls them `items`. Reading only `entries` is why a real
      // change log always came back empty however much was in it.
      return {
        items: reply?.items ?? reply?.entries ?? [],
        total: reply?.total ?? 0,
        nextOffset: reply?.nextOffset ?? null,
      };
    },
    getNextPageParam: (last) => last.nextOffset ?? undefined,
  });

  const entries = useMemo(
    () => (data?.pages ?? []).flatMap((page) => page.items),
    [data],
  );
  const total = data?.pages?.[0]?.total ?? 0;
  const totalChanges = entries.reduce((sum, entry) => sum + entry.changes.length, 0);

  useEffect(() => {
    onStats?.({ saves: total, changes: totalChanges });
  }, [total, totalChanges, onStats]);

  const filtering = !!(search || path || admin);

  return (
    <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
      {/* filters */}
      <Flex
        gap="xs" p="sm"
        style={{ borderBottom: `0.1vh solid ${alpha(theme.colors.dark[4], 0.4)}`, flexShrink: 0 }}
      >
        <FilterInput
          value={query} onChange={setQuery}
          placeholder={t('historyModal.search_values_paths_or_admins', 'Search values, paths or admins')} icon={Search} grow
        />
        <FilterInput value={pathFilter} onChange={setPathFilter} placeholder={t('historyModal.filter_by_path', 'Filter by path')} width="24vh" />
        <FilterInput value={adminFilter} onChange={setAdminFilter} placeholder={t('historyModal.filter_by_admin', 'Filter by admin')} icon={User} width="20vh" />
        <Select
          data={SORTS}
          value={sort}
          onChange={(next) => setSort(next ?? 'newest')}
          allowDeselect={false}
          comboboxProps={{ zIndex: 10800 }}
          styles={{
            input: {
              background: alpha(theme.colors.dark[9], 0.75),
              border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.55)}`,
              color: 'rgba(255,255,255,0.9)',
              fontFamily: 'Akrobat SemiBold',
              fontSize: '1.4vh',
              height: '3.4vh',
              minHeight: '3.4vh',
              width: '19vh',
            },
            dropdown: { background: theme.colors.dark[8], border: `0.1vh solid ${theme.colors.dark[6]}` },
          }}
        />
      </Flex>

      {/* entries */}
      <Flex direction="column" gap="xs" p="sm" className="studio-scroll" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {entries.map((entry, index) => (
          <EntryCard
            key={`${entry.at_unix}-${index}`}
            entry={entry}
            open={expanded === index}
            canEdit={canEdit}
            onToggle={() => setExpanded(expanded === index ? null : index)}
            onRevertAll={() => onRevert?.(entry.changes.map((change) => ({ path: change.path, value: change.old })))}
            onRevertOne={(change) => onRevert?.([{ path: change.path, value: change.old }])}
          />
        ))}

        {hasNextPage && (
          <Flex justify="center" py="xs">
            <StudioButton
              label={isFetchingNextPage ? 'Loading...' : 'Load more'}
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            />
          </Flex>
        )}

        {entries.length === 0 && (
          <Flex direction="column" align="center" justify="center" gap="xs" py="xl">
            <History size="3vh" color="rgba(255,255,255,0.18)" />
            <Text ff="Akrobat Bold" size="sm" c="rgba(255,255,255,0.4)">
              {isLoading ? 'Reading the change log\u2026'
                : isError ? 'Could not read the change log'
                  : filtering ? 'No change matches those filters'
                    : 'Nothing has been changed yet'}
            </Text>
          </Flex>
        )}
      </Flex>

      <Flex
        align="center" justify="space-between" px="sm" py="xs"
        style={{ borderTop: `0.1vh solid ${alpha(theme.colors.dark[4], 0.4)}`, flexShrink: 0 }}
      >
        <Flex align="center" gap="sm">
          <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.3)">
            {t('historyModal.reverting_stages_the_change_review_it_th', 'Reverting stages the change - review it, then Save like any other edit.')}
          </Text>
          {total > 0 && (
            <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.25)">
              {entries.length} of {total}
            </Text>
          )}
        </Flex>
        {footer}
      </Flex>
    </Flex>
  );
}

/** The same panel, in the modal the header's history button opens. */
export function HistoryModal({
  resource, canEdit, onRevert, onClose,
}: {
  resource: string;
  canEdit: boolean;
  onRevert: (changes: { path: string; value: unknown }[]) => void;
  onClose: () => void;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const [stats, setStats] = useState({ saves: 0, changes: 0 });

  // stable, or the panel's stats effect would loop
  const onStats = useCallback((next: { saves: number; changes: number }) => setStats(next), []);

  return (
    <Modal
      title={t('historyModal.change_history', 'Change history')}
      icon={History}
      iconColor={color}
      description={`Every saved change to ${resource}`}
      badge={{ label: `${stats.saves} SAVES · ${stats.changes} CHANGES`, color }}
      onClose={onClose}
      width="128vh"
      height="76vh"
      zIndex={10100}
    >
      <HistoryPanel
        resource={resource}
        canEdit={canEdit}
        onRevert={onRevert}
        onStats={onStats}
        footer={<StudioButton label={t('historyModal.close', 'Close')} onClick={onClose} />}
      />
    </Modal>
  );
}

function EntryCard({
  entry, open, canEdit, onToggle, onRevertAll, onRevertOne,
}: {
  entry: HistoryEntry;
  open: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onRevertAll: () => void;
  onRevertOne: (change: HistoryChange) => void;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const isConsole = entry.admin?.name === 'console';

  return (
    <Flex
      direction="column"
      style={{
        background: alpha(theme.colors.dark[8], 0.5),
        border: `0.1vh solid ${alpha(theme.colors.dark[5], open ? 0.6 : 0.35)}`,
        borderRadius: theme.radius.xs,
        overflow: 'hidden',
        // A flex column SHRINKS its children before it scrolls, so past a
        // certain number of saves every row squashed instead of the list
        // getting longer. The rows are a fixed size; the container scrolls.
        flexShrink: 0,
      }}
    >
      <Flex
        align="center" gap="sm" px="sm" py="xs"
        onClick={onToggle}
        style={{ cursor: 'pointer' }}
      >
        {open ? <ChevronDown size="1.5vh" color={color} /> : <ChevronRight size="1.5vh" color="rgba(255,255,255,0.35)" />}

        <Flex
          align="center" justify="center" w="3vh" h="3vh"
          style={{
            background: alpha(isConsole ? '#E0B15F' : color, 0.14),
            border: `0.1vh solid ${alpha(isConsole ? '#E0B15F' : color, 0.4)}`,
            borderRadius: '0.3vh', flexShrink: 0,
          }}
        >
          <User size="1.4vh" color={isConsole ? '#E0B15F' : color} />
        </Flex>

        <Flex direction="column" style={{ minWidth: '18vh', lineHeight: 1.15 }}>
          <Text ff="Akrobat Bold" size="xs" c="rgba(255,255,255,0.88)">
            {entry.admin?.name ?? 'unknown'}
          </Text>
          <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.3)">
            {entry.at_utc}
          </Text>
        </Flex>

        <Flex align="center" gap="xs" style={{ flex: 1, minWidth: 0 }}>
          <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.5)">
            {entry.changes.length} {entry.changes.length === 1 ? 'change' : 'changes'}
          </Text>
          {!open && (
            <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.28)" truncate>
              {entry.changes.map((c) => c.path).join(', ')}
            </Text>
          )}
        </Flex>

        <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.25)" style={{ flexShrink: 0 }}>
          v{entry.expected_version} → v{entry.applied_version}
        </Text>
      </Flex>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
            style={{ overflow: 'hidden' }}
          >
            <Flex direction="column" gap="xxs" px="sm" pb="xs">
              {entry.changes.map((change) => (
                <Flex
                  key={change.path}
                  align="center" gap="sm"
                  px="xs" py="0.5vh"
                  style={{
                    background: alpha(theme.colors.dark[9], 0.5),
                    border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.3)}`,
                    borderRadius: '0.3vh',
                  }}
                >
                  <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.6)" style={{ minWidth: '26vh' }}>
                    {change.path}
                  </Text>

                  <Flex align="center" gap="xs" style={{ flex: 1, minWidth: 0 }}>
                    <ValueChip value={change.old} tone="old" />
                    <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.3)">→</Text>
                    <ValueChip value={change.new} tone="new" />
                  </Flex>

                  <motion.button
                    type="button"
                    onClick={() => onRevertOne(change)}
                    disabled={!canEdit}
                    whileHover={canEdit ? { background: alpha(color, 0.16), borderColor: alpha(color, 0.5) } : undefined}
                    whileTap={canEdit ? { scale: 0.96 } : undefined}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.4vh',
                      height: '2.6vh', paddingInline: '0.8vh',
                      background: 'transparent',
                      border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.55)}`,
                      borderRadius: '0.3vh',
                      cursor: canEdit ? 'pointer' : 'not-allowed',
                      opacity: canEdit ? 1 : 0.45,
                      color: 'rgba(255,255,255,0.6)',
                      flexShrink: 0,
                    }}
                  >
                    <Undo2 size="1.2vh" />
                    <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.05em" c="inherit">{t('historyModal.revert', 'Revert')}</Text>
                  </motion.button>
                </Flex>
              ))}

              <Flex justify="flex-end" pt="xxs">
                <StudioButton
                  label={`Revert all ${entry.changes.length}`}
                  icon={Undo2}
                  onClick={onRevertAll}
                  disabled={!canEdit}
                />
              </Flex>
            </Flex>
          </motion.div>
        )}
      </AnimatePresence>
    </Flex>
  );
}

function ValueChip({ value, tone }: { value: unknown; tone: 'old' | 'new' }) {
  const theme = useMantineTheme();
  const accent = tone === 'new' ? theme.colors[theme.primaryColor][5] : '#E0776B';
  const text = formatValue(value);

  return (
    <Flex
      px="0.6vh" py="0.1vh"
      style={{
        background: alpha(accent, 0.1),
        border: `0.1vh solid ${alpha(accent, 0.3)}`,
        borderRadius: '0.3vh',
        maxWidth: '24vh',
        overflow: 'hidden',
      }}
    >
      <Text ff="monospace" size="xxs" c={accent} truncate>{text}</Text>
    </Flex>
  );
}

function FilterInput({
  value, onChange, placeholder, icon: Icon, width, grow,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  icon?: React.ElementType;
  width?: string;
  grow?: boolean;
}) {
  const theme = useMantineTheme();
  return (
    <TextInput
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      placeholder={placeholder}
      leftSection={Icon ? <Icon size="1.4vh" color="rgba(255,255,255,0.35)" /> : undefined}
      styles={{
        input: {
          background: alpha(theme.colors.dark[9], 0.7),
          border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.5)}`,
          color: 'rgba(255,255,255,0.85)',
          fontFamily: 'Akrobat SemiBold',
          fontSize: '1.3vh',
          height: '3.2vh',
          minHeight: '3.2vh',
          borderRadius: theme.radius.xs,
        },
        section: { width: '2.6vh' },
      }}
      style={{ width, flex: grow ? 1 : undefined }}
    />
  );
}

function formatValue(value: unknown): string {
  // A change to a setting that had never been overridden carries no previous
  // value at all, so "none" would read as "it was empty" when it was actually
  // whatever the script ships.
  if (value === undefined) return 'default';
  if (value === null) return 'none';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (value === '') return 'empty';
  return String(value);
}
