import { alpha, Flex, Text, useMantineTheme } from '@mantine/core';
import { ConfirmModal, Modal } from 'dirk-cfx-react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity, Gift, Info, Layers, Leaf, List, Package, Plus, Trash2, TriangleAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { RowFields } from './RowFields';
import { PickerDrawer } from './PickerDrawer';
import { ItemArt, StudioButton } from './ui';
import { validateRow } from './rowValidation';
import type { SettingColumn, SettingEntry } from './types';
import { useChrome } from './studioLocale';

type Row = Record<string, unknown>;

const TAB_ICONS: Record<string, React.ElementType> = {
  general: Info, stats: Activity, ecology: Leaf, gutting: Gift,
  rewards: Gift, stock: Package, locations: Layers,
};

/**
 * The row editor, laid out the way fishing's own fish modal is: tabs across the
 * top, the item's image under them, then the fields for that tab. Tabs come
 * from `rowTabs` when the schema declares them and are derived otherwise -
 * scalars in General, each nested table in a tab of its own.
 */
export function RowModal({
  entry, row, title, onSave, onDelete, onClose, disabled, resource, creating,
}: {
  entry: SettingEntry;
  /** the owning script, so cross-referencing fields can resolve their options */
  resource?: string;
  row: Row;
  title: string;
  onSave: (next: Row) => void;
  onDelete: () => void;
  /** this row does not exist yet, so there is nothing to delete */
  creating?: boolean;
  onClose: () => void;
  disabled?: boolean;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const [draft, setDraft] = useState<Row>(() => JSON.parse(JSON.stringify(row)));
  /**
   * What the picker is editing, and where its answer goes.
   *
   * A blip's colour and sprite live INSIDE a `blip` object on the row, so
   * "write it to draft[column.key]" was wrong for exactly the fields most
   * likely to want a picker - and since nothing was passing a drill handler
   * down to a nested field either, clicking one simply did nothing.
   */
  const [picker, setPicker] = useState<
    { column: SettingColumn; value: unknown; apply: (next: unknown) => void } | null
  >(null);

  const columns = entry.columns ?? [];

  const tabs = useMemo(() => {
    if (entry.rowTabs?.length) {
      return entry.rowTabs
        .map((tab) => ({
          ...tab,
          columns: tab.keys
            .map((key) => columns.find((c) => c.key === key))
            .filter(Boolean) as SettingColumn[],
        }))
        .filter((tab) => tab.columns.length > 0);
    }

    // derived: everything flat in General, each nested table its own tab
    const nested = columns.filter((c) => c.type === 'rows');
    const flat = columns.filter((c) => c.type !== 'rows');
    const out = [];
    if (flat.length) out.push({ id: 'general', label: 'General', icon: 'general', columns: flat });
    for (const column of nested) {
      out.push({ id: column.key, label: column.label, icon: column.key.toLowerCase(), columns: [column] });
    }
    return out;
  }, [entry.rowTabs, columns]);

  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? 'general');
  const currentTab = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  // The item comes FIRST, directly under its own picture.
  //
  // Which item a row is is the thing everything else on the form describes, and
  // it is what the image above is showing - so having it turn up wherever the
  // schema happened to declare it, often at the very bottom, read as an
  // afterthought. Only the position moves; the field is the same one.
  const current = useMemo(() => {
    // The item if the row IS one, otherwise whatever names it. A store has no
    // item, and its name arriving somewhere in the middle of the form reads
    // as an afterthought - it is the thing every other field describes.
    // Unless the schema said what comes first. Hoisting the name is a guess
    // about which field matters most, and a guess should lose to a statement:
    // a store's `id` is the thing every other script refers to it by, so
    // that schema asks for id first and gets it.
    const key = entry.rowOrdered ? undefined : (entry.rowItemKey ?? entry.rowLabelKey);
    if (!currentTab || !key) return currentTab;
    if (!currentTab.columns.some((c) => c.key === key)) return currentTab;
    return {
      ...currentTab,
      columns: [
        ...currentTab.columns.filter((c) => c.key === key),
        ...currentTab.columns.filter((c) => c.key !== key),
      ],
    };
  }, [currentTab, entry.rowItemKey, entry.rowLabelKey]);

  const itemName = entry.rowItemKey ? String(draft[entry.rowItemKey] ?? '') : '';

  const setField = (key: string, value: unknown) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  /**
   * What is wrong with this row, if anything.
   *
   * Checked against EVERY column, not just the ones on the tab you are
   * looking at - a row is saved whole, so a problem hiding on the other tab
   * still stops the save, and the message says which tab to look on.
   */
  const problems = useMemo(() => validateRow(columns, draft, t), [columns, draft]);
  const problemFor = (key: string) => problems.find((p) => p.key === key)?.message;

  /**
   * Has anything actually been typed?
   *
   * Compared against the row as it opened, so closing a modal you only looked
   * at asks nothing - the warning has to be rare to be worth reading.
   */
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(row),
    [draft, row],
  );
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const askClose = () => {
    if (dirty) { setConfirmDiscard(true); return; }
    onClose();
  };

  const tabOf = (key: string) =>
    tabs.find((tab) => tab.columns.some((c) => c.key === key));

  return (
    <>
      <Modal
        title={title}
        icon={List}
        iconColor={color}
        // No subtitle. This carried the LIST's label, so editing "Cypress
        // Flats" was subtitled "Yards" — a word with nothing to say, sitting
        // where a description should be. You already know which list you
        // opened; you clicked the row in it.

        onClose={askClose}
        width="78vh"
        height="76vh"
        zIndex={10100}
      >
        <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
          {/* tabs */}
          {tabs.length > 1 && (
            <Flex
              gap="0.3vh" p="0.4vh" mx="sm" mt="sm"
              style={{
                background: alpha(theme.colors.dark[9], 0.7),
                border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.4)}`,
                borderRadius: theme.radius.xs,
                flexShrink: 0,
              }}
            >
              {tabs.map((tab) => {
                const on = tab.id === current?.id;
                const TabIcon = TAB_ICONS[tab.icon] ?? Info;
                return (
                  <motion.button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    whileTap={{ scale: 0.98 }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5vh',
                      padding: '0.5vh 1vh',
                      background: on ? alpha(color, 0.16) : 'transparent',
                      border: 'none',
                      borderRadius: theme.radius.xs,
                      cursor: 'pointer',
                    }}
                  >
                    <TabIcon size="1.3vh" color={on ? color : 'rgba(255,255,255,0.4)'} />
                    <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.06em" c={on ? color : 'rgba(255,255,255,0.55)'}>
                      {tab.label}
                    </Text>
                  </motion.button>
                );
              })}
            </Flex>
          )}

          {/* the item this row is, shown the way fishing shows it */}
          {itemName && (
            <Flex justify="center" pt="xs" style={{ flexShrink: 0 }}>
              {/* ItemArt, not a bare Image: an item can be configured but not
                  installed - which is the whole point of the missing-items
                  audit - and fallbackSrc pointed at a file that does not exist,
                  so those rows showed a broken-image box. */}
              <ItemArt name={itemName} size="12vh" />
            </Flex>
          )}

          <RowFields
            columns={current?.columns ?? []}
            draft={draft}
            resource={resource}
            path={entry.path}
            itemName={itemName}
            disabled={disabled}
            problemFor={problemFor}
            setField={setField}
            onPick={setPicker}
          />

          <Flex
            align="center" justify="space-between" px="sm" py="xs"
            style={{ borderTop: `0.1vh solid ${alpha(theme.colors.dark[4], 0.4)}`, flexShrink: 0 }}
          >
            {!creating && (
              <StudioButton label={t('rowModal.delete', 'Delete')} danger icon={Trash2} onClick={onDelete} disabled={disabled} />
            )}
            <Flex align="center" gap="xs">
              {/* Says WHAT is wrong before you press anything, rather than a
                  disabled button with no explanation. Clicking jumps to the
                  tab holding the offending field. */}
              {problems.length > 0 && (
                <motion.button
                  type="button"
                  onClick={() => {
                    const tab = tabOf(problems[0].key);
                    if (tab) setActiveTab(tab.id);
                  }}
                  whileTap={{ scale: 0.99 }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5vh',
                    background: 'transparent', border: 'none',
                    cursor: 'pointer', padding: 0, maxWidth: '34vh',
                  }}
                >
                  <TriangleAlert size="1.3vh" color="#E0B15F" style={{ flexShrink: 0 }} />
                  <Text ff="Akrobat SemiBold" size="xxs" c="#E0B15F" truncate>
                    {problems.length === 1
                      ? problems[0].message
                      : t('rowModal.n_problems', '{} things need fixing').replace('{}', String(problems.length))}
                  </Text>
                </motion.button>
              )}
              <StudioButton label={t('rowModal.cancel', 'Cancel')} onClick={askClose} />
              <StudioButton
                label={t('rowModal.save_entry', 'Save entry')}
                primary
                onClick={() => onSave(draft)}
                disabled={disabled || problems.length > 0}
              />
            </Flex>
          </Flex>
        </Flex>
      </Modal>

      <AnimatePresence>
        {picker && (
          <PickerDrawer
            type={picker.column.type}
            label={picker.column.label}
            iconSet={picker.column.iconSet}
            value={picker.value}
            disabled={disabled}
            onApply={(v) => picker.apply(v)}
            onClose={() => setPicker(null)}
          />
        )}

        {/* Cancel throws the edit away, so it says so once rather than
            silently. Only when something was actually changed. */}
        {confirmDiscard && (
          <ConfirmModal
            title={t('rowModal.discard_changes', 'Discard changes?')}
            description={t(
              'rowModal.discard_body',
              'You have unsaved changes to this entry. Closing now throws them away.',
            )}
            confirmLabel={t('rowModal.discard', 'Discard')}
            onConfirm={() => { setConfirmDiscard(false); onClose(); }}
            onClose={() => setConfirmDiscard(false)}
            zIndex={10300}
          />
        )}
      </AnimatePresence>
    </>
  );
}

