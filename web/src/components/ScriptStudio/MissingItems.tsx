import { AlertTriangle, Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useItems, copyToClipboard } from 'dirk-cfx-react';
import { MOCK_ITEMS } from './mockData';
import { effectiveValue } from './store';
import type { SettingColumn, SettingEntry, StudioScript } from './types';
import { useChrome } from './studioLocale';
import { KitSelect } from './KitSelect';
import { Btn } from './studioKit';

const INVENTORY_FORMATS = [
  'ox_inventory', 'qb-inventory', 'qs-inventory', 'codem-inventory',
  'tgiann-inventory', 'bp_inventory', 'esx',
] as const;

/**
 * Configured items that do not exist in the server's inventory.
 *
 * dirk-cfx-react ships MissingItemsBanner already, but it fetches
 * `<scriptName>:getMissingItems` for the ONE resource it is mounted in - a hub
 * showing several scripts needs the audit per script, so this computes it from
 * the script being viewed. Same idea, hub-shaped: it should move into the
 * package as a per-resource variant when this ships.
 */
/** The audit on its own, so the header button and the panel agree. */
export function useMissingItems(script: StudioScript): string[] {
  // The REAL inventory, the same list the items catalogue reads. This used to
  // compare against MOCK_ITEMS - a hardcoded fixture - so on a live server it
  // reported items as missing that were installed, and could not have reported
  // a genuinely missing one.
  const items = useItems();

  return useMemo(() => {
    const configured = collectItemNames(script);
    const known = new Set(
      Object.keys(items).length > 0
        ? Object.values(items).map((item) => item.name)
        // A browser with no game to ask still needs something to check against.
        : MOCK_ITEMS.map((item) => item.name),
    );
    return [...configured].filter((name) => name && !known.has(name)).sort();
  }, [script, items]);
}

/**
 * Compact header button, a warn plate beside the account chip. Lives in the
 * panel header rather than the scroll, so the warning is always reachable
 * without eating a row of settings. Opens under itself like the account menu.
 */
export function MissingItemsButton({ script, open, onOpen }: {
  script: StudioScript;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const t = useChrome();
  const missing = useMissingItems(script);
  const ref = useRef<HTMLDivElement | null>(null);

  // Escape is the panel's: it closes this before it closes the Studio
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (ref.current?.contains(target)) return;
      // the format select's dropdown is portalled to <body>
      if (target.closest?.('.mantine-Select-dropdown, .mantine-Combobox-dropdown')) return;
      onOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, onOpen]);

  if (missing.length === 0) return null;

  return (
    <div className="ss-missW" ref={ref}>
      <div
        className={`pl ss-miss edge in${open ? ' open' : ''}`}
        style={{ '--i': 1, '--e': 'var(--warn)' } as CSSProperties}
        onClick={() => onOpen(!open)}
        aria-label={`${missing.length} items missing from your inventory`}
      >
        <div className="sk">
          <AlertTriangle className="ico" />
          <span className="V">{missing.length}</span>
          <span className="L">{t('missingItems.missing', 'Missing')}</span>
        </div>
      </div>
      {open && <MissingItemsPanel missing={missing} />}
    </div>
  );
}

function MissingItemsPanel({ missing }: { missing: string[] }) {
  const t = useChrome();
  const [format, setFormat] = useState<string>('ox_inventory');
  const [copied, setCopied] = useState(false);

  const snippet = buildSnippet(format, missing);

  const copy = () => {
    copyToClipboard(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="ss-mmenu">
      <div className="pl ss-amh edge in" style={{ '--i': 0, '--e': 'var(--warn)' } as CSSProperties}>
        <div className="sk">
          <div className="ss-av wt"><AlertTriangle /></div>
          <div className="tx">
            <div className="T">
              {(missing.length === 1
                ? t('missingItems.title_one', '1 item is not in your inventory')
                : t('missingItems.title', '{0} items are not in your inventory')).replace('{0}', String(missing.length))}
            </div>
            <div className="L">{t('missingItems.paste_the_snippet_into_your_inventory_s_', "Paste the snippet into your inventory's item list, then reload it.")}</div>
          </div>
        </div>
      </div>
      <div className="pl ss-akv in" style={{ '--i': 1 } as CSSProperties}>
        <div className="sk">
          <div className="hd">
            <span className="L">{t('missingItems.inventory', 'Your inventory')}</span>
            <KitSelect
              value={format}
              onChange={(v) => setFormat(v ?? 'ox_inventory')}
              data={INVENTORY_FORMATS.map((f) => ({ value: f, label: f }))}
              width="24vh"
              clearable={false}
              mono
            />
            <Btn sm icon={copied ? <Check /> : <Copy />} label={copied ? t('missingItems.copied', 'Copied') : t('missingItems.copy', 'Copy')} onClick={copy} />
          </div>
          <pre className="ss-msnip studio-scroll">{snippet}</pre>
        </div>
      </div>
    </div>
  );
}

/**
 * Every item name this script DECLARES, including inside list rows.
 *
 * Declared means `x-installItem` or `x-installItemList` - the same rule
 * dirk_lib's own installItems generator follows. It used to collect anything
 * whose rendered control was an item picker, and a picker is also what a row
 * column called `name` gets, so dirk_phone was told the job names
 * "realestate" and "ambulance" were missing inventory items.
 */
function collectItemNames(script: StudioScript): Set<string> {
  const names = new Set<string>();

  const fromColumns = (columns: SettingColumn[] | undefined, rows: unknown) => {
    if (!columns || !Array.isArray(rows)) return;
    for (const row of rows as Record<string, unknown>[]) {
      if (!row || typeof row !== 'object') continue;
      for (const column of columns) {
        if (column.installItem) {
          const value = row[column.key];
          if (typeof value === 'string' && value) names.add(value);
        } else if (column.type === 'rows') {
          fromColumns(column.columns, row[column.key]);
        }
      }
    }
  };

  for (const entry of script.entries) {
    const value = effectiveValue(script.resource, entry as SettingEntry);
    if (entry.installItem && typeof value === 'string' && value) names.add(value);
    if (entry.columns) fromColumns(entry.columns, value);
  }

  return names;
}

/** The same shapes dirk_lib's installItems generator writes. */
function buildSnippet(format: string, names: string[]): string {
  if (format === 'esx') {
    const rows = names.map((n) => `('${n}', '${titleise(n)}', 1, 0, 1)`).join(',\n  ');
    return `INSERT INTO items (name, label, weight, rare, can_remove) VALUES\n  ${rows};`;
  }

  if (format === 'ox_inventory') {
    return names.map((n) => `['${n}'] = {
    label = '${titleise(n)}',
    weight = 100,
    stack = true,
    close = true,
},`).join('\n');
  }

  // qb-flavoured inventories share a shape
  return names.map((n) => `['${n}'] = { name = '${n}', label = '${titleise(n)}', weight = 100, type = 'item', image = '${n}.png', unique = false, useable = false, shouldClose = true, description = '' },`).join('\n');
}

function titleise(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
