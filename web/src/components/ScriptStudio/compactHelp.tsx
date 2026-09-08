/**
 * "Put the description on a hover icon in here."
 *
 * A setting row lays its help text out inline, up to 82vh wide. Down the middle
 * of a full pane that reads well. In a COLUMN half that width it does not: the
 * levelling-style paragraph wrapped to a dozen lines and left the dropdown it
 * describes floating in the middle of them, and every row was a different
 * height for no reason a reader cares about.
 *
 * Context rather than a prop, because the rows are rendered by a callback
 * several components up — threading a flag through `renderRow` would change a
 * signature every caller shares, to say something only one layout means.
 */
import { createContext, useContext } from 'react';

const CompactHelpContext = createContext(false);

/** Rows inside this show their description on hover instead of inline. */
export function CompactHelp({ children }: { children: React.ReactNode }) {
  return (
    <CompactHelpContext.Provider value>
      {children}
    </CompactHelpContext.Provider>
  );
}

export function useCompactHelp(): boolean {
  return useContext(CompactHelpContext);
}
