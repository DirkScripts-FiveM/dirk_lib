import { alpha, Flex, NumberInput, RangeSlider, Slider, Text, TextInput, useMantineTheme } from '@mantine/core';
import { motion } from 'framer-motion';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useInputStyles } from './Controls';
import { useChrome } from './studioLocale';

const STRENGTH_COLORS = ['#22c55e', '#f59e0b', '#ef4444'];

/**
 * Which band a value falls in, and what colour that band is.
 *
 * The traffic lights are a JUDGEMENT — green is a gentle setting, red a harsh
 * one — which is true of a difficulty and nonsense for anything else. So a
 * field that names its own bands gets a neutral colour instead: a blip that is
 * "extra large" is not thereby a warning.
 *
 * @param bands  the field's own `x-bandLabels`, already translated
 * @param fallbackBands  dirk_lib's default three, already translated. These
 *        are the PANEL's words, not a script's, so they come from dirk_lib's
 *        own chrome bundle — they used to be English string literals right
 *        here, which made the one label on a slider the only untranslatable
 *        thing on the form.
 */
export function strengthMeta(
  value: number,
  max = 1,
  bands?: string[],
  neutral?: string,
  fallbackBands?: [string, string, string],
) {
  const pct = Math.min(Math.max(value / max, 0), 1);

  if (bands && bands.length > 0) {
    // Even slices across the range, and the top value lands in the LAST band
    // rather than falling off the end of the array.
    const i = Math.min(bands.length - 1, Math.floor(pct * bands.length));
    return { color: neutral ?? STRENGTH_COLORS[1], label: bands[i] };
  }

  const [weak, moderate, strong] = fallbackBands ?? ['Weak', 'Moderate', 'Strong'];
  if (pct < 0.34) return { color: STRENGTH_COLORS[0], label: weak };
  if (pct < 0.67) return { color: STRENGTH_COLORS[1], label: moderate };
  return { color: STRENGTH_COLORS[2], label: strong };
}

/**
 * A bounded 0..n value, shown the way fishing's StrengthSlider shows it: a
 * colour-graded slider, the band name, the exact number, and a ten segment bar
 * underneath. Used for biteChance, fightChance, strengthPerUnit, abundance -
 * everything the schema bounds to 0..1 or 0..2.
 */
export function SliderControl({
  value, min = 0, max = 1, onChange, disabled, bands,
}: {
  value: unknown;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  /** `x-bandLabels` — what this field calls its own steps, low to high. */
  bands?: string[];
}) {
  const theme = useMantineTheme();
  const t = useChrome();
  const current = typeof value === 'number' ? value : 0;
  const { color, label } = strengthMeta(
    current, max, bands, theme.colors[theme.primaryColor][5],
    [t('bands.weak', 'Weak'), t('bands.moderate', 'Moderate'), t('bands.strong', 'Strong')],
  );
  const pct = Math.min(Math.max(current / max, 0), 1);

  return (
    <Flex direction="column" gap="0.3vh" style={{ width: '100%' }}>
      <Flex justify="space-between" align="center">
        <Flex align="center" gap="xxs">
          <Flex
            px="0.6vh"
            style={{
              background: alpha(color, 0.12),
              border: `0.1vh solid ${alpha(color, 0.35)}`,
              borderRadius: theme.radius.xs,
            }}
          >
            <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.06em" c={color}>{label}</Text>
          </Flex>
          <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.4)">
            {current.toFixed(2)} / {max}
          </Text>
        </Flex>
      </Flex>

      <Slider
        value={current}
        onChange={onChange}
        disabled={disabled}
        min={min}
        max={max}
        step={0.01}
        label={null}
        styles={{
          bar: { background: color, transition: 'background 0.2s' },
          thumb: { borderColor: color, background: color, width: '1.2vh', height: '1.2vh' },
          track: { background: alpha(color, 0.12) },
        }}
      />

      <Flex gap="0.3vh" style={{ marginTop: '0.2vh' }}>
        {Array.from({ length: 10 }).map((_, i) => {
          const filled = i / 10 < pct;
          const segColor = i < 3 ? STRENGTH_COLORS[0] : i < 6 ? STRENGTH_COLORS[1] : STRENGTH_COLORS[2];
          return (
            <motion.div
              key={i}
              animate={{ background: filled ? segColor : alpha(segColor, 0.1) }}
              transition={{ duration: 0.15 }}
              style={{ flex: 1, height: '0.3vh', borderRadius: '1px' }}
            />
          );
        })}
      </Flex>
    </Flex>
  );
}

/** A two-number bound - weight limits, depth range, crush circle count. */
export function RangeControl({
  value, onChange, disabled, suffix, min, max, step,
}: {
  value: unknown;
  onChange: (next: number[]) => void;
  disabled?: boolean;
  suffix?: string;
  /** bounds from the schema's `items`, when it declares any */
  min?: number;
  max?: number;
  /** smallest allowed change - 1 when the pair must be whole numbers */
  step?: number;
}) {
  const styles = useInputStyles();
  const theme = useMantineTheme();
  const sliderColor = theme.colors[theme.primaryColor][5];
  const pair = Array.isArray(value) ? value : [0, 0];
  const [low, high] = [Number(pair[0] ?? 0), Number(pair[1] ?? 0)];

  /**
   * A pair that cannot be nonsense.
   *
   * The schema's rules caught a backwards pair on SAVE, which is late: the
   * field accepted a depth of -10 and said nothing until the save bar refused,
   * and the two numbers could cross over in the meantime. Both bounds are
   * held here as you type - the schema still has the last word, this just
   * stops you writing something it will reject.
   */
  const clamp = (n: number) => {
    let out = Number.isFinite(n) ? n : 0;
    // Snap BEFORE bounding, so a stepped range cannot land between steps and
    // then be nudged off the end by the clamp.
    if (step && step > 0) out = Math.round(out / step) * step;
    if (typeof min === 'number') out = Math.max(min, out);
    if (typeof max === 'number') out = Math.min(max, out);
    return out;
  };

  // The edited side wins and pushes the other, rather than being silently
  // refused: dragging a minimum past the maximum usually means you want both.
  const setLow = (next: number) => {
    const value = clamp(next);
    onChange([value, Math.max(value, high)]);
  };
  const setHigh = (next: number) => {
    const value = clamp(next);
    onChange([Math.min(low, value), value]);
  };

  /**
   * A slider needs somewhere to slide BETWEEN.
   *
   * Two number boxes are the honest control for an open-ended pair - there is
   * no track to draw when the maximum is "whatever you type". Given real
   * limits, though, a pair of numbers is a range you should be able to see and
   * grab, so the boxes keep the exact values and the track shows the shape.
   */
  const slidable = typeof min === 'number' && typeof max === 'number' && max > min;

  return (
    <Flex direction="column" gap="0.4vh" style={{ width: '100%' }}>
      {slidable && (
        <Flex direction="column" gap="0.2vh">
          <Flex justify="space-between" align="baseline">
            <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.25)">
              {min}{suffix ? ` ${suffix}` : ''}
            </Text>
            {/* The pair itself, where you are already looking. Two number
                boxes underneath said the same thing a second time. */}
            <Text ff="Akrobat Bold" size="xs" c={sliderColor}>
              {low}{suffix ? ` ${suffix}` : ''} – {high}{suffix ? ` ${suffix}` : ''}
            </Text>
            <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.25)">
              {max}{suffix ? ` ${suffix}` : ''}
            </Text>
          </Flex>
          <RangeSlider
            value={[low, high]}
            onChange={([nextLow, nextHigh]) => onChange([clamp(nextLow), clamp(nextHigh)])}
            disabled={disabled}
            min={min}
            max={max}
            step={step ?? ((max - min) / 100 < 1 ? 0.01 : 1)}
            minRange={0}
            label={null}
            styles={{
              bar: { background: sliderColor },
              thumb: {
                borderColor: sliderColor, background: sliderColor,
                width: '1.2vh', height: '1.2vh',
              },
              track: { background: alpha(sliderColor, 0.12) },
            }}
          />
        </Flex>
      )}

      {/* Only when there is nothing to drag. An open-ended pair has no track
          to draw, and then typing is the only way to set it. */}
      {!slidable && (
      <Flex align="center" gap="xs" style={{ width: '100%' }}>
      <Flex direction="column" gap="0.2vh" style={{ flex: 1 }}>
        <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.1em" c="rgba(255,255,255,0.35)">Min</Text>
        <NumberInput
          value={low}
          onChange={(v) => setLow(Number(v) || 0)}
          min={min}
          max={max}
          clampBehavior="strict"
          disabled={disabled}
          decimalScale={2}
          hideControls
          suffix={suffix ? ` ${suffix}` : undefined}
          styles={styles}
        />
      </Flex>
      <Flex direction="column" gap="0.2vh" style={{ flex: 1 }}>
        <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.1em" c="rgba(255,255,255,0.35)">Max</Text>
        <NumberInput
          value={high}
          onChange={(v) => setHigh(Number(v) || 0)}
          min={min}
          max={max}
          clampBehavior="strict"
          disabled={disabled}
          decimalScale={2}
          hideControls
          suffix={suffix ? ` ${suffix}` : undefined}
          styles={styles}
        />
      </Flex>
      </Flex>
      )}
    </Flex>
  );
}

/** A set of loose values - water types, payment methods, categories. */
export function TagsControl({
  value, onChange, disabled, numeric,
}: {
  value: unknown;
  onChange: (next: unknown[]) => void;
  disabled?: boolean;
  numeric?: boolean;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const styles = useInputStyles(true);
  const [draft, setDraft] = useState('');
  const items = Array.isArray(value) ? value : [];

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...items, numeric ? Number(trimmed) || 0 : trimmed]);
    setDraft('');
  };

  return (
    <Flex direction="column" gap="xs" style={{ width: '100%' }}>
      <Flex gap="0.4vh" wrap="wrap">
        {items.map((item, index) => (
          <Flex
            key={index}
            align="center" gap="0.4vh"
            px="0.7vh" py="0.2vh"
            style={{
              background: alpha(color, 0.12),
              border: `0.1vh solid ${alpha(color, 0.35)}`,
              borderRadius: '1vh',
            }}
          >
            <Text ff="Akrobat SemiBold" size="xxs" c={color}>{String(item)}</Text>
            {!disabled && (
              <motion.button
                type="button"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                whileTap={{ scale: 0.9 }}
                style={{ display: 'flex', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: alpha(color, 0.7) }}
                aria-label={`Remove ${String(item)}`}
              >
                <X size="1.1vh" />
              </motion.button>
            )}
          </Flex>
        ))}
        {items.length === 0 && (
          <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.3)">{t('richControls.none_set', 'None set')}</Text>
        )}
      </Flex>

      {!disabled && (
        <Flex gap="xs">
          <TextInput
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder={numeric ? 'Add a number' : 'Add a value'}
            styles={styles}
            style={{ flex: 1 }}
          />
          <motion.button
            type="button"
            onClick={add}
            whileTap={{ scale: 0.96 }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              aspectRatio: '1 / 1', height: '3vh',
              background: alpha(color, 0.14),
              border: `0.1vh solid ${alpha(color, 0.4)}`,
              borderRadius: theme.radius.xs,
              cursor: 'pointer',
            }}
            aria-label={t('richControls.add', 'Add')}
          >
            <Plus size="1.4vh" color={color} />
          </motion.button>
        </Flex>
      )}
    </Flex>
  );
}
