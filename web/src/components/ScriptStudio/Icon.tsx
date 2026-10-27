import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconProp } from '@fortawesome/fontawesome-svg-core';
import * as lucide from 'lucide-react';
import { SlidersHorizontal } from 'lucide-react';

/**
 * Any lucide icon, by its kebab-case name.
 *
 * This used to be a hand-written map inside main.tsx, listing fishing's icons
 * and dirk_loading's by name — so adding a section to any script meant editing
 * dirk_lib, which is the per-script knowledge this whole design exists to keep
 * out. A schema can now name any icon lucide ships and it just works.
 *
 * The cost is importing the whole set rather than the two dozen we happened to
 * use. That is a real number, and it buys the rule: nothing about a script
 * lives in the library.
 */
const CACHE = new Map<string, React.ElementType>();

/** `map-pin` -> `MapPin`, which is how lucide names its exports. */
function pascal(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function resolveIcon(name: string): React.ElementType {
  const cached = CACHE.get(name);
  if (cached) return cached;

  const registry = lucide as unknown as Record<string, React.ElementType | undefined>;
  // Accept what a schema author is likely to write: the kebab name lucide
  // documents, or the PascalCase export, or the `Icon`-suffixed alias.
  const found = registry[pascal(name)]
    ?? registry[name]
    ?? registry[`${pascal(name)}Icon`]
    ?? SlidersHorizontal;

  CACHE.set(name, found);
  return found;
}

/**
 * The lucide icon a name refers to, or nothing - for callers with a fallback
 * of their own that should win over resolveIcon's generic one.
 */
export function findIcon(name: string): React.ElementType | undefined {
  const registry = lucide as unknown as Record<string, React.ElementType | undefined>;
  return registry[pascal(name)] ?? registry[name] ?? registry[`${pascal(name)}Icon`];
}

export function Icon({ name, size, color }: { name: string; size: string; color: string }) {
  const Cmp = resolveIcon(name);
  return <Cmp size={size} color={color} />;
}

/**
 * An icon named by a schema, from EITHER set.
 *
 * Scripts predate this panel, and the ones that already had a config UI named
 * their icons the way that UI drew them - fishing's store categories carry
 * Font Awesome classes ("fas fa-fish") because fishing's own store screen
 * draws Font Awesome. Rewriting those values to lucide names would change what
 * the game renders, so the panel reads both instead: an `fa-` class goes to
 * Font Awesome, anything else to lucide.
 */
export function AnyIcon({ name, size, color }: { name: string; size: string; color: string }) {
  const fa = parseFaIcon(name);
  if (fa) {
    return (
      <FontAwesomeIcon
        icon={fa as IconProp}
        color={color}
        style={{ width: size, height: size }}
      />
    );
  }
  return <Icon name={name} size={size} color={color} />;
}

/** `"fa-solid fa-fish"` -> `["fas", "fish"]`, or null when it is not one. */
export function parseFaIcon(name: string): [string, string] | null {
  if (!name || !/fa-/.test(name)) return null;

  // Font Awesome names its styles two ways - the short `fas` and the long
  // `fa-solid` - and the long one is itself an `fa-` token. Reading the glyph
  // as "the first fa- word" therefore turned `fa-solid fa-fish` into the icon
  // named "solid", which does not exist, and every category drew a blank.
  const STYLES = {
    'fa-solid': 'fas', fas: 'fas',
    'fa-regular': 'far', far: 'far',
    'fa-brands': 'fab', fab: 'fab',
    'fa-light': 'fal', fal: 'fal',
    'fa-duotone': 'fad', fad: 'fad',
  } as Record<string, string>;

  const parts = name.trim().toLowerCase().split(/\s+/);
  const style = parts.map((part) => STYLES[part]).find(Boolean) ?? 'fas';
  const glyph = parts.find((part) => part.startsWith('fa-') && !STYLES[part])?.slice(3);
  return glyph ? [style, glyph] : null;
}
