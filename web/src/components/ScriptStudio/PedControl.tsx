import { alpha, Flex, Text, useMantineTheme } from '@mantine/core';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useChrome } from './studioLocale';
import { PickerDrawer } from './PickerDrawer';
import { PedArt } from './pedArt';

/**
 * The peds a store (or anything else) uses, shown as the peds themselves.
 *
 * A list of model names is a list of strings like `a_m_m_beach_01` - which
 * says nothing about who that is. Nobody picks a shopkeeper by reading an
 * identifier, so the chosen ped is shown as a picture, one at a time, with
 * arrows to step through the rest.
 *
 * The artwork is hosted, so it can be wrong or missing: every image falls back
 * to a silhouette rather than a broken box, and a model with no picture is
 * still perfectly usable.
 */

/**
 * The peds, and the picker that adds one.
 *
 * Self-contained on purpose: every other picker in the panel is opened by
 * whatever row owns the field, which means a new one has to be threaded
 * through the row modal, the nested row modal and the section body before it
 * works anywhere. A list that adds to itself needs none of that, and works the
 * same inside a store editor as it does on a settings page.
 */
export function PedsField({
  value, onChange, disabled, label,
}: {
  value: unknown;
  onChange: (next: string[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const t = useChrome();
  const [picking, setPicking] = useState(false);
  const models = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

  return (
    <>
      <PedListControl
        value={models}
        onChange={onChange}
        disabled={disabled}
        onAdd={() => setPicking(true)}
      />

      <AnimatePresence>
        {picking && (
          <PickerDrawer
            type="ped"
            label={label ?? t('ped.title', 'Ped model')}
            value=""
            disabled={disabled}
            onApply={(next) => {
              const model = String(next ?? '').trim();
              // Adding the same ped twice does nothing useful, and the
              // carousel would show it as two separate entries.
              if (!model || models.includes(model)) return;
              onChange([...models, model]);
            }}
            onClose={() => setPicking(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * ONE ped, picked the same way several are.
 *
 * The single-ped control was a plain text box — type the model name and hope —
 * while the multi one right beside it had the portrait, the catalogue and the
 * search. Same thing, twice, and only one of them usable.
 *
 * It reuses `PedListControl` with a list of one rather than drawing a second
 * portrait card: that component already hides its arrows below two entries, so
 * a single ped renders exactly as it should with nothing to keep in step.
 */
export function PedField({
  value, onChange, disabled, label,
}: {
  value: unknown;
  onChange: (next: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const t = useChrome();
  const [picking, setPicking] = useState(false);
  const model = typeof value === 'string' && value ? value : '';

  return (
    <>
      <PedListControl
        value={model ? [model] : []}
        // Replaced, never appended — there is only ever one. Cleared to an
        // empty string rather than dropped, so the field still exists and the
        // picker can put somebody back.
        onChange={(next) => onChange(next[0] ?? '')}
        disabled={disabled}
        onAdd={() => setPicking(true)}
        addLabel={model
          ? t('ped.change', 'Change ped')
          : t('ped.choose', 'Choose ped')}
      />

      <AnimatePresence>
        {picking && (
          <PickerDrawer
            type="ped"
            label={label ?? t('ped.title', 'Ped model')}
            value={model}
            disabled={disabled}
            onApply={(next) => onChange(String(next ?? '').trim())}
            onClose={() => setPicking(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export function PedListControl({
  value, onChange, disabled, onAdd, addLabel,
}: {
  value: unknown;
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** opens the picker; the list itself does not own it */
  onAdd: () => void;
  /**
   * What the button SAYS.
   *
   * "Add ped" is right for a shortlist and wrong for a field that holds one:
   * there is nothing to add to, only somebody to swap. The word is the whole
   * difference between "this yard can have several owners" and "this yard has
   * an owner", which is the thing the setting is trying to tell you.
   */
  addLabel?: string;
}) {
  const theme = useMantineTheme();
  const t = useChrome();
  const color = theme.colors[theme.primaryColor][5];

  const models = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  const current = models[Math.min(index, models.length - 1)];

  const step = (by: number) => {
    if (models.length < 2) return;
    setDirection(by);
    setIndex((prev) => (prev + by + models.length) % models.length);
  };

  const remove = (model: string) => {
    const next = models.filter((m) => m !== model);
    onChange(next);
    setIndex((prev) => Math.max(0, Math.min(prev, next.length - 1)));
  };

  return (
    <Flex direction="column" gap="0.6vh" style={{ width: '100%' }}>
      <Flex align="center" gap="xs">
        {models.length > 1 && (
          <StepButton onClick={() => step(-1)} label={t('ped.previous', 'Previous')}>
            <ChevronLeft size="1.4vh" color="rgba(255,255,255,0.5)" />
          </StepButton>
        )}

        <Flex
          align="center" gap="sm"
          px="sm" py="0.8vh"
          style={{
            flex: 1, minWidth: 0,
            background: alpha(theme.colors.dark[9], 0.45),
            border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.35)}`,
            borderRadius: theme.radius.xs,
            overflow: 'hidden',
          }}
        >
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={current ?? 'none'}
              custom={direction}
              variants={SLIDE}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              style={{ display: 'flex', alignItems: 'center', gap: '1vh', flex: 1, minWidth: 0 }}
            >
              <PedArt model={current ?? ''} size="11vh" />

              <Flex direction="column" style={{ minWidth: 0, lineHeight: 1.25 }}>
                <Text ff="Akrobat Bold" size="xs" c="rgba(255,255,255,0.88)" truncate>
                  {current ?? t('ped.none', 'No ped chosen')}
                </Text>
                <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.3)">
                  {models.length > 0
                    ? `${Math.min(index, models.length - 1) + 1} / ${models.length}`
                    : t('ped.addOne', 'Add one below')}
                </Text>
              </Flex>
            </motion.div>
          </AnimatePresence>

          {current && !disabled && (
            <motion.button
              type="button"
              onClick={() => remove(current)}
              whileHover={{ background: alpha('#ef4444', 0.15) }}
              whileTap={{ scale: 0.94 }}
              title={t('ped.remove', 'Remove this ped')}
              style={{
                width: '2.6vh', height: '2.6vh',
                display: 'grid', placeItems: 'center',
                background: 'transparent',
                border: `0.1vh solid ${alpha('#ef4444', 0.25)}`,
                borderRadius: theme.radius.xs,
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <Trash2 size="1.2vh" color="rgba(239,68,68,0.7)" />
            </motion.button>
          )}
        </Flex>

        {models.length > 1 && (
          <StepButton onClick={() => step(1)} label={t('ped.next', 'Next')}>
            <ChevronRight size="1.4vh" color="rgba(255,255,255,0.5)" />
          </StepButton>
        )}
      </Flex>

      {!disabled && (
        <motion.button
          type="button"
          onClick={onAdd}
          whileHover={{ background: alpha(color, 0.14) }}
          whileTap={{ scale: 0.99 }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6vh',
            height: '2.8vh',
            background: 'transparent',
            border: `0.1vh solid ${alpha(color, 0.35)}`,
            borderRadius: theme.radius.xs,
            cursor: 'pointer',
          }}
        >
          <Plus size="1.4vh" color={color} />
          <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.06em" c={color}>
            {addLabel ?? t('ped.add', 'Add ped')}
          </Text>
        </motion.button>
      )}
    </Flex>
  );
}

const SLIDE = {
  enter: (d: number) => ({ x: `${d * 30}%`, opacity: 0 }),
  center: { x: '0%', opacity: 1 },
  exit: (d: number) => ({ x: `${d * -30}%`, opacity: 0 }),
};

function StepButton({
  onClick, label, children,
}: { onClick: () => void; label: string; children: React.ReactNode }) {
  const theme = useMantineTheme();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      whileHover={{ background: alpha(theme.colors.dark[4], 0.4) }}
      whileTap={{ scale: 0.92 }}
      style={{
        width: '2.4vh', height: '2.4vh',
        display: 'grid', placeItems: 'center',
        background: 'transparent',
        border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.6)}`,
        borderRadius: theme.radius.xs,
        cursor: 'pointer', flexShrink: 0,
      }}
    >
      {children}
    </motion.button>
  );
}
