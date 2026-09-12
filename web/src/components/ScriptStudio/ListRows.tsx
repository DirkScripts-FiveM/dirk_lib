import { alpha, Flex, Text, TextInput, useMantineTheme } from '@mantine/core';
import { ConfirmModal } from 'dirk-cfx-react';
import { AnimatePresence, motion } from 'framer-motion';
import { List, Package, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useStudio } from './store';
import { RowModal } from './RowModal';
import { useItems } from 'dirk-cfx-react';
import { ItemArt, singular, StudioButton } from './ui';
import type { SettingColumn, SettingEntry } from './types';
import { useChrome } from './studioLocale';
import { newRow } from './newRow';

type Row = Record<string, unknown>;

/**
 * Every row visible in the section, the way fishing's own list sections work -
 * you can see the whole set at a glance, add and delete inline, and click a row
 * to edit it in a modal. No drilling required just to read the list.
 */
export function ListRows({
  entry, rows, onChange, disabled, rowFilter, resource, fill,
}: {
  entry: SettingEntry;
  /** owning script, so a row editor can resolve cross-referencing fields */
  resource?: string;
  rows: Row[];
  onChange: (next: Row[]) => void;
  disabled?: boolean;
  /** panel-wide search, so a query narrows the rows as well as the sections */
  rowFilter?: string;
  /**
   * This list IS the page — a workspace with nothing else on it.
   *
   * Then the shape is a fixed one: search at the top, rows scrolling in the
   * middle, Add pinned to the bottom. Sizing the rows to their content instead
   * (which is right for an inline list) leaves the button floating wherever the
   * last row happened to end.
   */
  fill?: boolean;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];

  // Fishing ships 37 species and 24 hooks; mounting every row of every list at
  // once is what made switching scripts stall. Same page size fishing's own
  // list sections use.
  const PAGE = 200;
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  /** a row being composed, not yet in the list */
  const [creating, setCreating] = useState<Row | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  // Somewhere else asked for one of these rows - a validation problem naming
  // `fish[27].waterTypes` is only useful if it can put you in front of row 27.
  const rowRequest = useStudio((state) => state.openRowRequest);
  useEffect(() => {
    if (!rowRequest || rowRequest.path !== entry.path) return;
    if (!rows[rowRequest.index]) return;
    setEditing(rowRequest.index);
    useStudio.setState({ openRowRequest: null });
  }, [rowRequest, entry.path, rows.length]);

  const labelKey = entry.rowLabelKey ?? entry.columns?.[0]?.key ?? '';
  const items = useItems();

  // A column typed `item` is the obvious case. Failing that, a row whose key
  // column actually resolves to something in the inventory is an item too -
  // baitDig.randomItems stores its item in `name`, with nothing in the schema
  // marking it as one.
  const itemKey = entry.rowItemKey ?? (() => {
    const candidate = entry.columns?.find((column) =>
      (column.key === 'name' || column.key === 'item') && column.type === 'string');
    if (!candidate) return undefined;
    const hit = rows.some((row) => !!items[String(row[candidate.key] ?? '')]);
    return hit ? candidate.key : undefined;
  })();
  const columns = entry.columns ?? [];
  // the columns worth summarising on the card - skip the two already shown
  const summaryColumns = columns.filter((c) => c.key !== labelKey && c.key !== itemKey).slice(0, 4);

  const visible = useMemo(() => {
    const active = (rowFilter ?? query).trim();
    if (!active) return rows.map((_, i) => i);
    const needle = active.toLowerCase();
    return rows
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => Object.values(row).some((v) => String(v).toLowerCase().includes(needle)))
      .map(({ i }) => i);
  }, [rows, query, rowFilter]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE));
  const paged = visible.slice(page * PAGE, page * PAGE + PAGE);

  // a filter can shrink the list under the current page
  useEffect(() => { if (page >= pageCount) setPage(0); }, [pageCount, page]);

  const rowTitle = (row: Row, index: number) => String(row[labelKey] ?? `Entry ${index + 1}`);

  /**
   * A new row exists only once you save it.
   *
   * Adding used to append the blank template immediately and then open the
   * editor, so backing out left an empty row in the list - and in the staged
   * changes - that nobody asked for. It is held here until Save.
   */
  const addRow = () => {
    setCreating(newRow(entry.rowTemplate, entry.columns));
  };

  const deleteRow = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
    setConfirmDelete(null);
  };

  const saveRow = (index: number, next: Row) => {
    onChange(rows.map((row, i) => (i === index ? next : row)));
  };

  return (
    /* Fills a flexible parent, flows in an inline one.
     *
     * In a workspace the list is handed a definite height, and everything
     * after the rows - paging, and the Add button - was pushed past the
     * bottom edge. `flex: 1` does nothing in the inline case (there is no
     * free space to take), so one layout serves both without a fixed height
     * anywhere. */
    <Flex direction="column" gap="xxs" style={{ width: '100%', flex: 1, minHeight: 0 }}>
      {rows.length > 6 && (
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={t('listRows.filter', 'Filter %s').replace('%s', entry.label.toLowerCase())}
          leftSection={<Search size="1.4vh" color="rgba(255,255,255,0.35)" />}
          rightSection={query ? (
            <motion.button
              type="button"
              onClick={() => setQuery('')}
              whileTap={{ scale: 0.85 }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
              }}
              aria-label={t('listRows.clear_filter', 'Clear filter')}
            >
              <X size="1.3vh" color="rgba(255,255,255,0.45)" />
            </motion.button>
          ) : null}
          styles={{
            input: {
              background: alpha(theme.colors.dark[9], 0.7),
              border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.5)}`,
              color: 'rgba(255,255,255,0.85)',
              fontFamily: 'Akrobat SemiBold',
              fontSize: '1.3vh',
              height: '3vh',
              minHeight: '3vh',
              borderRadius: theme.radius.xs,
              // matches the icon well, so the caret is not sitting on the glass
              paddingLeft: '3.6vh',
              paddingRight: '3.2vh',
            },
            section: { width: '3.6vh' },
          }}
          mb="xxs"
          style={{ flexShrink: 0 }}
        />
      )}

      {/* Two behaviours, on purpose.
        *
        * INLINE (`0 1 auto`): sized by its rows, so a three-row list beside a
        * label does not claim a screenful, and the Add button sits directly
        * under the last row rather than marooned below a dead region.
        *
        * FILLING (`flex: 1`): the list is the page, so the rows take the height
        * and the footer stays on the bottom edge where you can always reach it.
        */}
      <Flex
        direction="column" gap="xxs"
        className="studio-scroll"
        style={{ flex: fill ? 1 : '0 1 auto', minHeight: 0, overflowY: 'auto' }}
      >
      {paged.map((index) => {
        const row = rows[index];
        return (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Flex
              align="center" gap="sm"
              px="sm" py="xs"
              style={{
                background: alpha(theme.colors.dark[9], 0.5),
                border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.4)}`,
                borderRadius: theme.radius.xs,
              }}
            >
              {itemKey && <ItemArt name={String(row[itemKey] ?? '')} />}

              <Flex direction="column" style={{ minWidth: '14vh', lineHeight: 1.15 }}>
                <Text ff="Akrobat Bold" size="xs" c="rgba(255,255,255,0.88)" truncate>
                  {rowTitle(row, index)}
                </Text>
                {itemKey && (
                  <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.3)" truncate>
                    {String(row[itemKey] ?? '')}
                  </Text>
                )}
              </Flex>

              {/* at-a-glance values so the list is readable without opening a row */}
              <Flex align="center" gap="xs" wrap="wrap" style={{ flex: 1, minWidth: 0 }}>
                {summaryColumns.map((column) => (
                  <Flex key={column.key} align="center" gap="0.4vh">
                    <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.3)">{column.label}</Text>
                    <Text ff="Akrobat Bold" size="xxs" c="rgba(255,255,255,0.7)">
                      {formatCell(row[column.key], column)}
                    </Text>
                  </Flex>
                ))}
              </Flex>

              <Flex align="center" gap="xxs" style={{ flexShrink: 0 }}>
                <RowIconButton icon={Pencil} label={t('listRows.edit', 'Edit')} onClick={() => setEditing(index)} disabled={disabled} />
                <RowIconButton icon={Trash2} label={t('listRows.delete', 'Delete')} danger onClick={() => setConfirmDelete(index)} disabled={disabled} />
              </Flex>
            </Flex>
          </motion.div>
        );
      })}

      {rows.length === 0 && (
        <Flex align="center" justify="center" gap="xs" py="md"
          style={{
            border: `0.1vh dashed ${alpha(theme.colors.dark[4], 0.5)}`,
            borderRadius: theme.radius.xs,
          }}
        >
          <List size="1.6vh" color="rgba(255,255,255,0.25)" />
          <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.3)">{t('listRows.nothing_here_yet', 'Nothing here yet')}</Text>
        </Flex>
      )}

      {visible.length === 0 && rows.length > 0 && (
        <Flex justify="center" py="sm">
          <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.3)">No entry matches "{query}"</Text>
        </Flex>
      )}

      </Flex>

      {pageCount > 1 && (
        <Flex align="center" justify="space-between" pt="xxs" style={{ flexShrink: 0 }}>
          <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.35)">
            {page * PAGE + 1}–{Math.min((page + 1) * PAGE, visible.length)} of {visible.length}
          </Text>
          <Flex gap="xxs">
            <StudioButton label={t('listRows.prev', 'Prev')} onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} />
            <StudioButton label={t('listRows.next', 'Next')} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} />
          </Flex>
        </Flex>
      )}

      {/* Pinned when the list owns the page: a rule above it so it reads as a
        * footer rather than as one more row that happens to be a button. */}
      <Flex
        pt="xxs"
        style={{
          flexShrink: 0,
          ...(fill ? {
            marginTop: '0.4vh',
            paddingTop: '0.9vh',
            borderTop: `0.1vh solid ${alpha(theme.colors.dark[4], 0.45)}`,
          } : {}),
        }}
      >
        <StudioButton label={t('listRows.add', 'Add {name}').replace('{name}', singular(entry.label))} icon={Plus} onClick={addRow} disabled={disabled} grow />
      </Flex>

      <AnimatePresence>
        {creating && (
          <RowModal
            entry={entry}
            resource={resource}
            row={creating}
            creating
            title={t('listRows.new_entry', 'New {}').replace('{}', singular(entry.label).toLowerCase())}
            disabled={disabled}
            onSave={(next) => {
              onChange([...rows, next]);
              setCreating(null);
            }}
            onDelete={() => setCreating(null)}
            onClose={() => setCreating(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editing !== null && rows[editing] && (
          <RowModal
            entry={entry}
            resource={resource}
            row={rows[editing]}
            title={rowTitle(rows[editing], editing)}
            disabled={disabled}
            onSave={(next) => { saveRow(editing, next); setEditing(null); }}
            onDelete={() => { setEditing(null); setConfirmDelete(editing); }}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDelete !== null && rows[confirmDelete] && (
          <ConfirmModal
            title={t('listRows.delete_title', 'Delete {name}').replace('{name}', singular(entry.label).toLowerCase())}
            description={t('listRows.delete_description', '"{row}" is removed from {list} when you save.')
              .replace('{row}', rowTitle(rows[confirmDelete], confirmDelete))
              .replace('{list}', entry.label)}
            confirmLabel={t('listRows.delete', 'Delete')}
            onConfirm={() => deleteRow(confirmDelete)}
            onClose={() => setConfirmDelete(null)}
            zIndex={10200}
          />
        )}
      </AnimatePresence>
    </Flex>
  );
}

function RowIconButton({
  icon: Icon, label, onClick, disabled, danger,
}: { icon: React.ElementType; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  const theme = useMantineTheme();
  const accent = danger ? '#ef4444' : theme.colors[theme.primaryColor][5];

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { background: alpha(accent, 0.16), borderColor: alpha(accent, 0.5) }}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      style={{
        aspectRatio: '1 / 1', height: '2.8vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent',
        border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.55)}`,
        borderRadius: theme.radius.xs,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: 'rgba(255,255,255,0.55)',
        opacity: disabled ? 0.5 : 1,
      }}
      aria-label={label}
    >
      <Icon size="1.4vh" />
    </motion.button>
  );
}

function formatCell(value: unknown, column: SettingColumn): string {
  if (value === null || value === undefined || value === '') return '-';
  // A secret is a credential - a Discord webhook URL lets anyone who reads it
  // post as that webhook. The editor masks it behind an eye toggle, but this
  // summary printed it in full on the list card, where it sat in every
  // screenshot and stream of the Delivery page. Saying it is set is the whole
  // of what the card needs to say.
  if (column.type === 'secret') return '••••••••';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (column.type === 'coords') {
    const c = value as { x?: number; y?: number };
    return typeof c.x === 'number' ? `${c.x.toFixed(0)}, ${c.y?.toFixed(0)}` : '-';
  }
  if (column.type === 'enum') {
    const match = column.options?.find((o) => o.value === value);
    return match?.label ?? String(value);
  }
  /**
   * Anything that is not a scalar gets COUNTED, not stringified.
   *
   * A store row was printing "Categories [object Object],[object Object]..."
   * across most of its width - `String(value)` on an array of objects, which
   * is never information. What the summary can honestly say about a nested
   * table is how many rows are in it.
   */
  if (Array.isArray(value)) {
    if (value.length === 0) return '-';
    // A pair of numbers is a range and reads perfectly well as one.
    if (value.length === 2 && value.every((v) => typeof v === 'number')) {
      return `${value[0]}–${value[1]}`;
    }
    if (value.every((v) => typeof v !== 'object' || v === null)) return value.join(', ');
    return `${value.length}`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    if (keys.length === 0) return '-';
    // Named things say their name; the rest just say they are set.
    const named = (value as Record<string, unknown>).label
      ?? (value as Record<string, unknown>).name;
    return typeof named === 'string' ? named : '…';
  }

  return column.suffix ? `${value}${column.suffix}` : String(value);
}

