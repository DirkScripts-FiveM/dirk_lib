import { Portal } from '@mantine/core';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { create } from 'zustand';
import { accentVars, useAccent } from '../Kit';
import { useChrome } from './studioLocale';

/*
 * The Studio's dialogs in the lib kit: a slanted header plate over a flat body
 * plate, with no square box behind them. Same props as dirk-cfx-react's Modal /
 * ConfirmModal, so a file only swaps its import.
 *
 * While any is open the window blurs each of its own plates (`.modal`), which
 * keeps the slants: a backdrop-filter would not run in CEF, and blurring the
 * window as a whole shows its square bounds.
 */

const dialogs = create<{ open: number }>(() => ({ open: 0 }));
export const useDialogOpen = () => dialogs((s) => s.open > 0);
export const anyDialogOpen = () => dialogs.getState().open > 0;

function useCountOpen() {
  useEffect(() => {
    dialogs.setState((s) => ({ open: s.open + 1 }));
    return () => dialogs.setState((s) => ({ open: Math.max(0, s.open - 1) }));
  }, []);
}

export type ModalProps = {
  title: string;
  icon?: ElementType;
  iconColor?: string;
  description?: string;
  badge?: { label: string; color: string };
  onClose: () => void;
  width?: string;
  maxHeight?: string;
  height?: string;
  zIndex?: number;
  clickOutside?: boolean;
  children: ReactNode;
};

function Layer({ zIndex, onClose, clickOutside, dim, children }: { zIndex: number; onClose: () => void; clickOutside: boolean; dim?: boolean; children: ReactNode }) {
  const accent = useAccent();
  const downOnScrim = useRef(false);
  useCountOpen();
  return (
    <Portal>
      <motion.div
        className={'dk ss-dlgL' + (dim ? ' dim' : '')}
        style={{ ...accent, zIndex }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        onPointerDown={(e) => { downOnScrim.current = e.target === e.currentTarget; }}
        onClick={(e) => { if (clickOutside && e.target === e.currentTarget && downOnScrim.current) onClose(); }}
      >
        {children}
      </motion.div>
    </Portal>
  );
}

function Head({ title, icon: Icon, iconColor, description, badge, onClose }: Pick<ModalProps, 'title' | 'icon' | 'iconColor' | 'description' | 'badge' | 'onClose'>) {
  const t = useChrome();
  return (
    <div className="pl hd edge in">
      <div className="sk">
        {Icon && <span className="th"><Icon color={iconColor ?? 'var(--a)'} /></span>}
        <div className="tx">
          <div className="T">{title}</div>
          {description && <div className="D">{description}</div>}
        </div>
        {badge && <span className="ss-chip" style={chipVars(badge.color)}><b>{badge.label}</b></span>}
        <span className="cap dark" onClick={onClose} title={t('common.close', 'Close')}><b><X size="1.7vh" /></b></span>
      </div>
    </div>
  );
}

/** `--c` + its tints for a `.ss-chip` in any colour. */
export function chipVars(c: string) {
  const v = accentVars(c) as Record<string, string>;
  return { '--c': v['--a'], '--c18': v['--a18'], '--c60': v['--a60'] } as CSSProperties;
}

export function Modal({ title, icon, iconColor, description, badge, onClose, width = '52vh', maxHeight = '85vh', height, zIndex = 100, clickOutside = true, children }: ModalProps) {
  return (
    <Layer zIndex={zIndex} onClose={onClose} clickOutside={clickOutside}>
      <motion.div
        className="ss-dlg"
        style={{ width, maxHeight, height }}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <Head title={title} icon={icon} iconColor={iconColor} description={description} badge={badge} onClose={onClose} />
        <div className="body">{children}</div>
      </motion.div>
    </Layer>
  );
}

export type ConfirmModalProps = {
  title: string;
  description: string;
  confirmLabel?: string;
  /** If given, the confirm button waits until this exact text is typed */
  confirmText?: string;
  onConfirm: () => void;
  onClose: () => void;
  zIndex?: number;
};

export function ConfirmModal({ title, description, confirmLabel = 'Delete', confirmText, onConfirm, onClose, zIndex = 200 }: ConfirmModalProps) {
  const t = useChrome();
  const [typed, setTyped] = useState('');
  const can = !confirmText || typed === confirmText;
  const go = () => { if (!can) return; onConfirm(); onClose(); };
  return (
    <Layer zIndex={zIndex} onClose={onClose} clickOutside>
      <motion.div
        className="ss-dlg danger"
        style={{ width: '50vh' }}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }}
      >
        <Head title={title} onClose={onClose} />
        <div className="body" style={{ padding: '1.8vh 2.2vh', gap: '1.4vh' }}>
          <div className="D">{description}</div>
          {confirmText && (
            <div style={{ display: 'grid', gap: '.7vh' }}>
              <div className="L">{t('confirm.type', 'Type {0} to confirm').replace('{0}', confirmText)}</div>
              <input className={'in2' + (can ? ' ok' : '')} autoFocus value={typed} onChange={(e) => setTyped(e.currentTarget.value)} placeholder={confirmText} />
            </div>
          )}
        </div>
        <div className="btns">
          <div className="pl ss-btn" onClick={onClose}><div className="sk"><span className="act">{t('common.cancel', 'Cancel')}</span></div></div>
          <div className={'pl ss-btn no' + (can ? '' : ' off')} onClick={go}><div className="sk"><span className="act">{confirmLabel}</span></div></div>
        </div>
      </motion.div>
    </Layer>
  );
}
