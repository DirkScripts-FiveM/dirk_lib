import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Plus, Search as SearchIcon, X } from 'lucide-react';
import { accentVars, Cap, fmtNum, Ico, Key, KitIcon, KStrip, md, Segs, useAccent } from '../Kit';

/*
 * The kit a script's own Studio screens draw with (contract v7).
 *
 * A custom control renders inside the panel's `.dk.ss` tree, so every kit
 * class (`pl`, `sk`, `edge`, `cap`, `kp`, `L` / `D` / `V` / `T`, `in`) already
 * works there. These are the pieces that are more than a class: a search box,
 * a filter strip, a toolbar, a card wall, a chip, a button - generic shapes,
 * named for what they are, so fishing, phone or any other script lands in the
 * panel's look without copying it. What only one script knows (a rarity, a
 * depth band) stays in that script, in its own sheet via `useSheet`.
 *
 * Handed over as `window.__dirkStudio.kit` (and 'dirk-studio-kit').
 */

/** `#rrggbb` at an alpha, for a tint CEF 103 cannot mix itself (no color-mix). */
export function hexA(hex: string, a: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * A script's own CSS, put in the page once.
 *
 * A remote component is a JS module, and the browser does not load a CSS file
 * a module was built next to. The sheet is keyed by id, so a remount (or two
 * screens from one script) never stacks copies, and a rebuilt module replaces
 * the old text.
 */
export function useSheet(id: string, css: string) {
  useEffect(() => {
    const key = `dirk-studio-sheet-${id}`;
    let node = document.getElementById(key) as HTMLStyleElement | null;
    if (!node) {
      node = document.createElement('style');
      node.id = key;
      document.head.appendChild(node);
    }
    if (node.textContent !== css) node.textContent = css;
  }, [id, css]);
}

/** A slanted label: a rarity, a requirement, a status. `color` fills it with any colour. */
export function Chip({ tone, color, children, className }: {
  tone?: 'a' | 'w' | 'g' | 'r';
  color?: string;
  children: ReactNode;
  className?: string;
}) {
  const cls = 'chip' + (tone ? ` ${tone}` : '') + (color ? ' c' : '') + (className ? ` ${className}` : '');
  return (
    <span className={cls} style={color ? ({ '--c': color } as CSSProperties) : undefined}>
      <b>{children}</b>
    </span>
  );
}

/** The panel's search box. */
export function Search({ value, onChange, placeholder }: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="ss-lf">
      <SearchIcon />
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.currentTarget.value)} />
      {value && (
        <span className="cap dark" onClick={(e) => { e.preventDefault(); onChange(''); }}>
          <b><X /></b>
        </span>
      )}
    </label>
  );
}

export type FilterOption<T extends string> = { id: T; label: string; count?: number };

/** Mutually exclusive filters, as a strip of keys - the on one white. */
export function Filters<T extends string>({ value, options, onChange }: {
  value: T;
  options: FilterOption<T>[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="kstrip">
      {options.map((o) => (
        <span key={o.id} className={'pl kp sm' + (o.id === value ? ' on' : '')} onClick={() => onChange(o.id)}>
          <span className="sk">
            <span className="act">{o.label}</span>
            {o.count != null && <span className={'cap' + (o.id === value ? '' : ' dark')}><b>{o.count}</b></span>}
          </span>
        </span>
      ))}
    </div>
  );
}

/** A kit button. `go` is the white one, `no` the red one. */
export function Btn({ icon, label, tone, sm, onClick, disabled, title }: {
  icon?: ReactNode;
  label?: ReactNode;
  tone?: 'go' | 'no';
  sm?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  title?: string;
}) {
  const cls = 'pl ss-btn' + (tone ? ` ${tone}` : '') + (sm ? ' sm' : '') + (disabled ? ' off' : '');
  return (
    <span className={cls} title={title} onClick={disabled ? undefined : onClick}>
      <span className="sk">{icon}{label != null && <span className="act">{label}</span>}</span>
    </span>
  );
}

/** Search, filters, a count and Add: the row above every wall. */
export function Toolbar({ query, onQuery, placeholder, filters, count, onAdd, addLabel, canEdit = true }: {
  query: string;
  onQuery: (next: string) => void;
  placeholder?: string;
  filters?: ReactNode;
  count?: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  canEdit?: boolean;
}) {
  return (
    <div className="ss-ctool in">
      <Search value={query} onChange={onQuery} placeholder={placeholder} />
      {filters}
      {count != null && <span className="L">{count}</span>}
      {onAdd && (
        <span className={'pl kp sm' + (canEdit ? '' : ' off')} onClick={canEdit ? onAdd : undefined}>
          <span className="sk"><span className="cap"><b><Plus /></b></span><span className="act">{addLabel}</span></span>
        </span>
      )}
    </div>
  );
}

/** A scrolling grid of cards, `cols` across. */
export function Wall({ cols = 4, children, className }: { cols?: number; children: ReactNode; className?: string }) {
  return (
    <div className={'ss-wall studio-scroll' + (className ? ` ${className}` : '')} style={{ '--cols': cols } as CSSProperties}>
      {children}
    </div>
  );
}

/** Nothing to show, said plainly. */
export function Empty({ text, icon }: { text: string; icon?: ReactNode }) {
  return (
    <div className="ss-empty sm">
      {icon}
      <span className="D">{text}</span>
    </div>
  );
}

/** What `window.__dirkStudio.kit` holds. */
export const studioKit = {
  // the lib kit itself
  Segs, Key, Cap, KStrip, Ico, KitIcon, accentVars, useAccent, fmtNum, md,
  // the Studio's shapes
  Chip, Search, Filters, Btn, Toolbar, Wall, Empty,
  useSheet, hexA,
};
