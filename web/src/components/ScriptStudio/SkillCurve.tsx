/**
 * What a levelling curve actually costs, drawn.
 *
 * Four numbers describe a skill — a starting level, a top level, the cost of
 * level 2, and a multiplier. None of them can be read. Nobody looks at
 * "modifier 1.4" and pictures how long it takes to reach level 10, and the one
 * thing an admin actually wants to know — is this a weekend or a month — is not
 * written down anywhere.
 *
 * So the block draws itself. Same arithmetic as `lib.skill` in Lua and
 * `createSkill` in cfx-react, which is the third copy of it and the reason it
 * is commented as loudly here: if these ever disagree, the panel lies about the
 * game.
 */
import { alpha, Flex, Text, useMantineTheme } from '@mantine/core';
import { useMemo } from 'react';
import { useChrome } from './studioLocale';

export type CurveShape = 'runescape' | 'linear' | 'quadratic' | 'softcap';

export type SkillSettings = {
  baseLevel: number;
  maxLevel: number;
  baseXP: number;
  modifier: number;
  curve?: CurveShape;
};

/**
 * Cumulative XP to BE this level.
 *
 * Must stay identical to `xpForLevel` in dirk_lib's `modules/skill/shared.lua`.
 * The gates run on the Lua; this only draws it.
 */
const CURVES: Record<CurveShape, (s: SkillSettings, level: number) => number> = {
  runescape: (s, level) => {
    let total = s.baseXP;
    for (let i = 2; i <= level - 1; i++) {
      total += Math.floor((i + 300 * 2 ** (i / 7)) / 4) * s.modifier;
    }
    return total;
  },
  linear: (s, level) => s.baseXP * (level - s.baseLevel) * s.modifier,
  quadratic: (s, level) => {
    const steps = level - s.baseLevel;
    return s.baseXP * steps * steps * s.modifier;
  },
  softcap: (s, level) => {
    const span = Math.max(1, s.maxLevel - s.baseLevel);
    let total = 0;
    for (let i = 1; i <= level - s.baseLevel; i++) {
      total += s.baseXP * (1 + (i / span) * 2) * s.modifier;
    }
    return total;
  },
};

export function xpForLevel(s: SkillSettings, level: number): number {
  if (level <= s.baseLevel) return 0;
  if (level === s.baseLevel + 1) return Math.floor(s.baseXP);
  return Math.floor((CURVES[s.curve ?? 'runescape'] ?? CURVES.runescape)(s, level));
}

/** 12,345 → "12.3k", 13,034,394 → "13M". A curve's numbers get silly. */
function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export function SkillCurve({ settings }: { settings: SkillSettings }) {
  const theme = useMantineTheme();
  const t = useChrome();
  const color = theme.colors[theme.primaryColor][5];

  const { points, ghost, marks, total, refTotal } = useMemo(() => {
    const top = Math.max(settings.baseLevel + 1, settings.maxLevel);

    const curve = (modifier: number) => {
      const s = { ...settings, modifier };
      const out: { level: number; xp: number }[] = [];
      for (let l = settings.baseLevel; l <= top; l++) out.push({ level: l, xp: xpForLevel(s, l) });
      return out;
    };

    const levels = curve(settings.modifier);
    // The SAME ladder at modifier 1, drawn behind as a ghost.
    const reference = curve(1);

    const totalXp = levels[levels.length - 1]?.xp ?? 0;
    const referenceTotal = reference[reference.length - 1]?.xp ?? 1;

    /*
      LINEAR, against a FIXED ceiling — and both of those are the fix.

      This was a log plot normalised to its own maximum, which is the one thing
      that cannot show a modifier: the modifier scales every level by the same
      amount, so dividing by the total cancels it out exactly. Dragging from
      0.1 to 3 — a thirtyfold change — moved the line about five percent. The
      chart was arithmetically incapable of showing the setting it sat under.

      Pinned instead to three times the default curve's total, which is the top
      of the modifier's own range. At 1 the curve fills a third of the box, at 3
      it fills it, at 0.1 it is a line along the floor. Linear because a
      thirtyfold difference IS thirty times as tall, and a log axis exists to
      hide exactly that.
    */
    // Headroom, so a steeper SHAPE is not clipped flat against the top. The
    // ghost is the same shape at modifier 1, so the comparison stays about the
    // setting you are dragging rather than the one you picked.
    const ceiling = Math.max(referenceTotal * 3, totalXp * 1.05);
    const plot = (list: { xp: number }[]) => list.map((entry, i) => {
      const x = (i / Math.max(1, list.length - 1)) * 100;
      const y = 100 - Math.min(100, (entry.xp / ceiling) * 100);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');

    const at = (l: number) => levels.find((e) => e.level === l);
    const picks = [
      at(Math.min(top, settings.baseLevel + 4)),
      at(Math.min(top, Math.round((settings.baseLevel + top) / 2))),
      at(top),
    ].filter(Boolean) as { level: number; xp: number }[];

    return {
      points: plot(levels),
      ghost: plot(reference),
      marks: picks,
      total: totalXp,
      refTotal: referenceTotal,
    };
  }, [settings]);

  // What the modifier is actually doing, in one number. This is the thing that
  // changes thirtyfold while the shape barely moves.
  const ratio = refTotal > 0 ? total / refTotal : 1;

  return (
    <Flex
      direction="column" gap="0.6vh" p="sm"
      style={{
        width: '100%',
        background: alpha(theme.colors.dark[9], 0.45),
        border: `0.1vh solid ${alpha(theme.colors.dark[5], 0.4)}`,
        borderRadius: theme.radius.xs,
      }}
    >
      <Flex justify="space-between" align="baseline">
        <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.08em" c="rgba(255,255,255,0.45)">
          {t('skillCurve.title', 'The climb')}
        </Text>
        <Flex gap="sm" align="baseline">
          <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.35)">
            {t('skillCurve.total', 'total to max')}: <span style={{ color }}>{short(total)}</span>
          </Text>
          <Text ff="Akrobat Bold" size="xxs" c={ratio > 1.02 ? '#f59e0b' : ratio < 0.98 ? '#22c55e' : 'rgba(255,255,255,0.35)'}>
            {ratio > 0.98 && ratio < 1.02
              ? t('skillCurve.default', 'default pace')
              : `${ratio.toFixed(ratio < 1 ? 2 : 1)}× ${ratio > 1 ? t('skillCurve.slower', 'slower') : t('skillCurve.faster', 'faster')}`}
          </Text>
        </Flex>
      </Flex>

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '13vh', display: 'block', overflow: 'visible' }}
      >
        {/* The default curve, behind. Without something to sit against, a
            curve on its own has no scale and every setting looks the same. */}
        <polyline
          points={ghost}
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        {/* Filled underneath, so the shape reads as an amount rather than a line. */}
        <polygon points={`0,100 ${points} 100,100`} fill={alpha(color, 0.12)} stroke="none" />
      </svg>

      <Flex gap="sm" wrap="wrap">
        {marks.map((mark) => (
          <Flex key={mark.level} direction="column" style={{ minWidth: '6vh' }}>
            <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.06em" c="rgba(255,255,255,0.35)">
              {t('skillCurve.level', 'Level')} {mark.level}
            </Text>
            <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.75)">{short(mark.xp)} XP</Text>
          </Flex>
        ))}
      </Flex>

      <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.28)">
        {t('skillCurve.hint', 'Dashed line is the default pace, for scale.')}
      </Text>
    </Flex>
  );
}
