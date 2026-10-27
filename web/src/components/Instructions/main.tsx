// Instructions overlay. Listens for the SendNuiMessage actions emitted by
// `lib.showInstructions` / `lib.hideInstructions` (Lua side: see
// src/ui/client/showInstructions.lua) and renders the cfx-react
// InstructionPanel in dirk_lib's always-loaded NUI.
//
// Lets any resource — UI or not — drive the bottom-right "do this in-world"
// card without needing its own React tree.
//
// The RESOURCE BAR variant (`bar` in the spec: what the player holds and how
// much is left - a watering can's litres, a bottle's ml) stacks a small card
// in the same style right on top of the instruction card. The card itself
// comes from dirk-cfx-react (no bar slot there), so this measures it and sits
// just above it.
import { useEffect, useState } from 'react';
import { InstructionPanel, type InstructionKey } from 'dirk-cfx-react';
import { fmtNum, Layer, Segs, useInputMode } from '../Kit';
import { useNuiEvent } from '../../hooks/useNuiEvent';
import { setUiTheme } from '../../stores/uiTheme';

type InstructionBar = {
  value: number;
  max: number;
  label?: string;
  unit?: string;
  warn?: boolean;
};

type InstructionSpec = {
  title: string;
  hint?: string;
  keys?: InstructionKey[];
  bar?: InstructionBar;
};

// the instruction card's height (px) while it's up: InstructionPanel portals it
// into body under [data-dirk-instruction-overlay]
function useCardHeight(active: boolean) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!active) return;
    let observer: ResizeObserver | undefined;
    let raf = 0;
    const attach = () => {
      const card = document.querySelector('[data-dirk-instruction-overlay] > div') as HTMLElement | null;
      if (!card) {
        raf = requestAnimationFrame(attach);
        return;
      }
      setHeight(card.getBoundingClientRect().height);
      observer = new ResizeObserver(() => setHeight(card.getBoundingClientRect().height));
      observer.observe(card);
    };
    attach();
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [active]);
  return height;
}

// the bar as its own plate over the column (the 19/10 look): label + value / max unit, 10 segments;
// `warn` turns it amber and pulses the segments
function InstructionBarCard({ bar, cardHeight }: { bar: InstructionBar; cardHeight: number }) {
  const k = bar.max > 0 ? Math.min(Math.max(bar.value / bar.max, 0), 1) : 0;
  return (
    <Layer style={{ zIndex: 10000 }}>
      <div className="ins" style={{ bottom: `calc(3vh + ${cardHeight}px + 0.7vh)` }}>
        <div className={'pl bar in' + (bar.warn ? ' warnb' : '')}>
          <div className="sk">
            <div className="barTop">
              <span className="L">{bar.label ?? ''}</span>
              <span className="V">
                {fmtNum(bar.value)}
                <small>/ {fmtNum(bar.max)}{bar.unit ? ` ${bar.unit}` : ''}</small>
              </span>
            </div>
            <Segs n={10} frac={k} />
          </div>
        </div>
      </div>
    </Layer>
  );
}

const Instructions: React.FC = () => {
  const [spec, setSpec] = useState<InstructionSpec | null>(null);
  const cardHeight = useCardHeight(!!spec);
  // the caps show the controller's buttons on a pad (a loose prop: older dirk-cfx-react builds don't take it)
  const inputMode = useInputMode();

  useNuiEvent<InstructionSpec>('DIRK_LIB_SHOW_INSTRUCTIONS', (data) => {
    // Whose colours this belongs to. `App` wraps this component in
    // <Themed>, so the whole thing — body and hooks included — renders
    // in the calling resource's palette.
    setUiTheme('instructions', (data as { theme?: never } | undefined)?.theme);

    if (!data || typeof data.title !== 'string') return;
    setSpec({ title: data.title, hint: data.hint, keys: data.keys, bar: data.bar });
  });

  useNuiEvent('DIRK_LIB_HIDE_INSTRUCTIONS', () => {
    setSpec(null);
  });

  return (
    <>
      <InstructionPanel
        visible={!!spec}
        title={spec?.title ?? ''}
        hint={spec?.hint}
        keys={spec?.keys}
        // Don't hide the rest of dirk_lib's NUI — the admin panel etc. should
        // stay visible if it's open. Caller-side concerns (releasing NUI focus,
        // hiding other UIs) are not this overlay's job.
        hideRestOfAdmin={false}
        {...({ inputMode } as object)}
      />
      {spec?.bar && cardHeight > 0 && <InstructionBarCard bar={spec.bar} cardHeight={cardHeight} />}
    </>
  );
};

export default Instructions;
