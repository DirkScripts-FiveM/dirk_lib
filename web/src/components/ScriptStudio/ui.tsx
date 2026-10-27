import { alpha, Flex, useMantineTheme } from '@mantine/core';
import { getItemImageUrl } from 'dirk-cfx-react';
import { Package } from 'lucide-react';
import { useEffect, useState } from 'react';
import { chipVars } from './Dialog';

/**
 * Shared pressables so every surface in the hub agrees on button styling -
 * the lib kit's slanted plate (studio.css `.ss-btn`): white for the one that
 * goes ahead, red text for the one you cannot take back.
 */
export function StudioButton({
  label, onClick, primary, disabled, danger, icon: Icon, grow,
}: {
  label: string;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  danger?: boolean;
  icon?: React.ElementType;
  grow?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={'pl ss-btn sb' + (primary ? ' go' : '') + (danger ? ' no' : '') + (disabled ? ' off' : '') + (grow ? ' grow' : '')}
    >
      <span className="sk">
        {Icon && <Icon />}
        <span className="act">{label}</span>
      </span>
    </button>
  );
}

/**
 * `size="control"` matches StudioButton's height, for the case where a chip
 * sits in a row of buttons - a status pill next to a button it does not line
 * up with reads as a mistake, and the button often only appears
 * conditionally, so the row changes height as you use it.
 */
export function Chip({
  label, color, dot, icon: Icon, size = 'inline',
}: {
  label: string;
  color: string;
  dot?: boolean;
  icon?: React.ElementType;
  size?: 'inline' | 'control';
}) {
  return (
    <span className={'ss-chip' + (size === 'control' ? ' ctl' : '')} style={chipVars(color)}>
      <b>
        {dot && <i className="dt" />}
        {Icon && <Icon />}
        {label}
      </b>
    </span>
  );
}


/**
 * An item's inventory image, the way fishing's own list sections show it.
 *
 * The URL comes from dirk_lib's resolved inventory path, so it is whatever that
 * server actually serves. An item can be configured but not installed - exactly
 * what the missing-items audit reports - so a failed load falls back to the
 * placeholder rather than a broken image.
 */
export function ItemArt({ name, size = '3.2vh' }: { name?: string; size?: string }) {
  const theme = useMantineTheme();
  const [failed, setFailed] = useState(false);
  const src = name ? getItemImageUrl(name) : '';

  useEffect(() => { setFailed(false); }, [src]);

  return (
    <Flex
      align="center" justify="center"
      w={size} h={size}
      style={{
        background: alpha(theme.colors.dark[6], 0.55),
        border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.45)}`,
        borderRadius: '0.3vh',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ maxWidth: '82%', maxHeight: '82%', objectFit: 'contain' }}
        />
      ) : (
        <Package size="1.6vh" color="rgba(255,255,255,0.4)" />
      )}
    </Flex>
  );
}

/**
 * "Categories" -> "Category", for the Add button under a list.
 *
 * Dropping a trailing `s` is right often enough to look deliberate and wrong
 * often enough to look broken - "Add Categorie" was on screen. Shared so the
 * four places that name a single row all get the same answer.
 */
export function singular(label: string): string {
  if (/ies$/i.test(label)) return `${label.slice(0, -3)}y`;
  if (/(ch|sh|ss|x|z)es$/i.test(label)) return label.slice(0, -2);
  if (/s$/i.test(label) && !/ss$/i.test(label)) return label.slice(0, -1);
  return label;
}

/**
 * Which column, if any, holds an INVENTORY ITEM - and which holds an icon.
 *
 * Two things wanted this and each had written its own version, which then
 * disagreed: the store-category list drew a category's own fish icon while the
 * editor that opened from it drew a missing-item box for "Rods", because one
 * of them checked whether the name was really an installed item and the other
 * just saw a column called `name`.
 *
 * The rule:
 *   - a column DECLARED type `item` is one, no argument;
 *   - a column merely NAMED `name` or `item` only counts if the value is an
 *     item the server actually has - the guess has to pay its way;
 *   - and a declared icon beats the guess outright, because the row said what
 *     it wanted drawn.
 */
export function rowIdentity(
  children: { key: string; type: string }[],
  rows: Record<string, unknown>[],
  items: Record<string, unknown>,
): { itemKey?: string; iconKey?: string } {
  const iconKey = children.find((child) => child.type === 'icon')?.key
    ?? (children.some((child) => child.key === 'icon') ? 'icon' : undefined);

  const declared = children.find((child) => child.type === 'item')?.key;
  const guessed = children.find((child) => (child.key === 'name' || child.key === 'item')
    && rows.some((row) => !!items[String(row[child.key] ?? '')]))?.key;

  return { iconKey, itemKey: declared ?? (iconKey ? undefined : guessed) };
}

/**
 * Is this field switched off by one of its siblings?
 *
 * Three editors open a row - the list's, the nested table's, and the map's -
 * and each had its own answer to this, which is to say two of them had none:
 * a zone's permit price stayed fully editable on a zone requiring no permit,
 * and said nothing about why changing it did nothing.
 *
 * `self.` is the row this field is in, which is the only thing a row editor
 * can see; a bare path means the same here.
 */
export function fieldGatedOff(
  column: { key: string; enabledWhen?: { path: string; equals?: unknown } },
  row: Record<string, unknown>,
): boolean {
  const rule = column.enabledWhen;
  if (!rule) return false;
  const key = rule.path.startsWith('self.') ? rule.path.slice(5) : rule.path;
  // A field cannot gate itself, and a rule that says so is a mistake in the
  // schema rather than a field that should vanish.
  if (key === column.key) return false;
  const other = row[key];
  return rule.equals === undefined ? !other : other !== rule.equals;
}
