/**
 * The one-time setup wizard.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * The panel has shipped in thirteen languages for a while, and the setting that
 * picks one sits inside dirk_lib → Basic → Language. That is fine once you know
 * where it is, and useless before: a Japanese admin opened Script Studio, read
 * English, and had no reason to think anything else was on offer. The first
 * customer to ask about Japanese had been running the script for weeks without
 * finding it.
 *
 * So the panel asks, once, the first time an editor opens it — and while it has
 * their attention it asks for the other two things every server changes anyway:
 * the currency symbol prices are rendered with, and the colour the UI is built
 * from. Three settings that are annoying to hunt for and obvious to answer.
 *
 * ── step one cannot use words ───────────────────────────────────────────────
 *
 * Every other screen can be translated because the language is already known.
 * The first step runs BEFORE that, so any sentence it shows is a coin flip. It
 * is built from the only thing that reads correctly to everyone: each
 * language's name written in that language. The heading is the word "Language"
 * in a handful of scripts, which reads as deliberate rather than as
 * untranslated English.
 *
 * From step two on, the language IS known — it was staged, not saved — so the
 * rest of the wizard is in it. Picking 日本語 turns the next screen Japanese,
 * which is also the fastest possible proof the translation works.
 *
 * ── nothing is written until the end ────────────────────────────────────────
 *
 * Every step stages into the ordinary draft, so the panel behind the overlay
 * repaints as choices are made — the language, the currency and the theme all
 * feed the live preview that already existed. Finish commits once. Closing
 * without finishing writes nothing and asks again next time, which is the right
 * answer for a wizard nobody consented to.
 */
import { Flex, Text, TextInput, useMantineTheme, alpha } from '@mantine/core';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Languages, Palette } from 'lucide-react';
import { useMemo, useState } from 'react';
import { commitDraft, effectiveValue, setValue, useStudio } from './store';
import { MantineColorControl, ShadeControl } from './ThemeControls';
import { useChrome } from './studioLocale';
import { useInputStyles } from './Controls';
import type { SettingEntry } from './types';

/** "Language", in enough scripts that nobody reads it as untranslated English. */
const HEADING = ['Language', '言語', 'Sprache', 'Idioma', 'Langue', '语言'];

/**
 * Where a BCP-47 tag and our file name disagree about the same language.
 *
 * Norwegian is the one that bites: the browser says `nb-NO` (Bokmal) or `nn-NO`
 * (Nynorsk), and the file is `no`. Without this a Norwegian admin - one of the
 * languages a customer specifically asked for - is offered English.
 *
 * Chinese is matched by SCRIPT rather than region, because `zh-Hans` and
 * `zh-Hant` often arrive with no region at all.
 */
const ALIASES: Record<string, string> = {
  nb: 'no',
  nn: 'no',
  'zh-hans': 'zh-CN',
  'zh-hant': 'zh-TW',
};

/**
 * A sensible currency symbol for a language, and a better one for a region.
 *
 * There is no locale→currency mapping in `Intl` — it can format a currency you
 * name, but it will not tell you which one a place uses — so this is a table or
 * it is nothing. It only has to be a good first guess: the field beside it is a
 * text box, and anyone whose server runs on something else types it.
 *
 * Region wins where it is known, because a language spans currencies far more
 * often than it does not: `en` is dollars until the client says `en-GB`.
 */
const BY_LANGUAGE: Record<string, string> = {
  en: '$', de: '€', es: '€', fr: '€', it: '€', ja: '¥',
  lt: '€', nl: '€', no: 'kr', pl: 'zł', pt: '€',
  'zh-CN': '¥', 'zh-TW': 'NT$',
};

const BY_REGION: Record<string, string> = {
  GB: '£', BR: 'R$', CH: 'CHF', SE: 'kr', DK: 'kr', CZ: 'Kč',
  US: '$', CA: '$', AU: '$', NZ: '$', IN: '₹', RU: '₽', TR: '₺',
};

/** Symbols worth one click, rather than hunting for the character. */
const QUICK = ['$', '€', '£', '¥', 'zł', 'kr', 'R$', '₹'];

/**
 * Places that weigh things in pounds. Everywhere else is metric, so the list
 * of exceptions is shorter and more honest than a list of the rest.
 *
 * Distance follows weight here, which is a simplification: the UK really does
 * buy petrol in litres and drive in miles. It is a first guess on a screen with
 * both controls visible, not a claim about anybody's shopping.
 */
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

function clientTags(): string[] {
  if (typeof navigator === 'undefined') return [];
  return [...(navigator.languages ?? []), navigator.language].filter(Boolean);
}

/**
 * The client's own language, as a code we might actually have a file for.
 *
 * `navigator.language` is a BCP-47 tag (`ja`, `pt-BR`, `zh-Hant-TW`), and the
 * setting takes locale codes (`ja`, `pt`, `zh-TW`). Matched most-specific
 * first, and `null` when we ship nothing for it - an admin whose language we do
 * not have should see no suggestion at all rather than English dressed up as
 * one.
 */
function suggestFrom(codes: string[]): string | null {
  const tags = clientTags();

  for (const tag of tags) {
    const exact = codes.find((c) => c.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
  }
  // Script-qualified aliases before anything region-based: `zh-Hant-TW` should
  // resolve by its script, not by hoping the region happens to line up.
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    for (const [alias, code] of Object.entries(ALIASES)) {
      if ((lower === alias || lower.startsWith(`${alias}-`)) && codes.includes(code)) return code;
    }
  }
  for (const tag of tags) {
    const primary = tag.split('-')[0]?.toLowerCase();
    if (!primary) continue;
    // A region-specific tag prefers a region-specific file (zh-Hant-TW → zh-TW)
    // and settles for the bare language only if there is one.
    const regional = codes.find((c) => c.toLowerCase().startsWith(`${primary}-`)
      && tag.toLowerCase().includes(c.split('-')[1]!.toLowerCase()));
    if (regional) return regional;
    const bare = codes.find((c) => c.toLowerCase() === primary);
    if (bare) return bare;
  }
  return null;
}

/** The region the CLIENT is in, if it says — not the region of the language picked. */
function clientRegion(): string | null {
  for (const tag of clientTags()) {
    const region = tag.split('-').find((part) => /^[A-Za-z]{2}$/.test(part) && part === part.toUpperCase());
    if (region) return region.toUpperCase();
  }
  return null;
}

/** Imperial only where it is actually used; metric otherwise. */
function unitsFor(language: string): { weightUnit: 'kg' | 'lb'; distanceUnit: 'm' | 'ft' } {
  const region = clientRegion();
  const imperial = region
    ? IMPERIAL_REGIONS.has(region)
    // No region to go on. English is the only language we ship that is spoken
    // anywhere imperial, so it is the only one worth guessing imperial for.
    : language === 'en';
  return imperial
    ? { weightUnit: 'lb', distanceUnit: 'ft' }
    : { weightUnit: 'kg', distanceUnit: 'm' };
}

function currencyFor(language: string): string {
  const region = clientRegion();
  // Only let the region speak when it agrees the language is plausible - a
  // German admin on a `de-DE` client picking Japanese wants yen, not euros.
  if (region && BY_REGION[region] && clientTags().some((t) => t.toLowerCase().startsWith(language.split('-')[0]!.toLowerCase()))) {
    return BY_REGION[region]!;
  }
  return BY_LANGUAGE[language] ?? '$';
}

type StepId = 'language' | 'theme';

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const t = useChrome();
  const inputStyles = useInputStyles();
  const scripts = useStudio((s) => s.scripts);
  const [step, setStep] = useState<StepId>('language');
  const [saving, setSaving] = useState(false);
  /**
   * Whether a language was chosen ON THIS SCREEN, as opposed to inherited.
   *
   * Only used to stop suggesting once someone has answered: the suggestion is
   * help before a decision and noise after it.
   */
  const [picked, setPicked] = useState<string | null>(null);

  // The settings live on whichever script is the shared one — dirk_lib — rather
  // than being looked up by resource name, so a rename cannot break it.
  const shared = scripts.find((s) => s.shared);
  const entryFor = (path: string) => shared?.entries.find((e) => e.path === path);
  const language = entryFor('basic.language');
  const prompted = entryFor('basic.languagePrompted');
  const currency = entryFor('basic.currency');
  const weightUnit = entryFor('basic.weightUnit');
  const distanceUnit = entryFor('basic.distanceUnit');
  const primaryColor = entryFor('appearance.primaryColor');
  const primaryShade = entryFor('appearance.primaryShade');

  const options = useMemo(
    () => (language?.options ?? []).map((o) => ({ value: o.value, label: o.label })),
    [language?.options],
  );
  const suggested = useMemo(() => suggestFrom(options.map((o) => o.value)), [options]);

  // Nothing to ask with. Better to let the panel through than to hold an editor
  // behind an empty dialog.
  if (!shared || !language || !prompted || options.length === 0) {
    onDone();
    return null;
  }

  const resource = shared.resource;
  const currentLanguage = String(effectiveValue(resource, language) ?? 'en');
  const currentCurrency = String(currency ? effectiveValue(resource, currency) ?? '$' : '$');

  const ordered = suggested
    ? [...options].sort((a, b) => (a.value === suggested ? -1 : b.value === suggested ? 1 : 0))
    : options;

  /** Picking a language re-guesses everything else on this screen with it. */
  function pickLanguage(code: string) {
    setValue(resource, language as SettingEntry, code);
    if (currency) setValue(resource, currency as SettingEntry, currencyFor(code));
    const units = unitsFor(code);
    if (weightUnit) setValue(resource, weightUnit as SettingEntry, units.weightUnit);
    if (distanceUnit) setValue(resource, distanceUnit as SettingEntry, units.distanceUnit);
    setPicked(code);
  }

  async function finish() {
    if (saving) return;
    setSaving(true);
    // Closes the question whatever else was chosen. Without it an admin who
    // took the English default would leave no override row behind - the value
    // matches the default, so nothing is written - and be asked again forever.
    setValue(resource, prompted as SettingEntry, true);
    await commitDraft(resource);
    onDone();
  }

  const steps: { id: StepId; label: string; icon: React.ElementType }[] = [
    { id: 'language', label: t('setup.step_language', 'Language'), icon: Languages },
    { id: 'theme', label: t('setup.step_theme', 'Theme'), icon: Palette },
  ];
  const index = steps.findIndex((s) => s.id === step);

  return (
    <Flex
      align="center"
      justify="center"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        background: 'rgba(0,0,0,0.74)',
        backdropFilter: 'blur(0.6vh)',
        borderRadius: 'inherit',
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18 }}
        style={{ width: '88%', maxWidth: '104vh' }}
      >
        <Flex direction="column" gap="lg">
          <Stepper steps={steps} index={index} color={color} />

          {/* Fixed height so the buttons underneath do not jump between a step
            * of thirteen cards and a step of two controls. */}
          <Flex direction="column" justify="center" style={{ minHeight: '38vh' }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.16 }}
              >
                {step === 'language' ? (
                  <Flex direction="column" align="center" gap="lg">
                    <Flex direction="column" align="center" gap="xs">
                      <Languages size="3vh" color={color} />
                      <Text ff="Akrobat Bold" size="lg" c="rgba(255,255,255,0.92)" ta="center">
                        {HEADING.join('  ·  ')}
                      </Text>
                    </Flex>

                    <Flex wrap="wrap" justify="center" gap="xs" style={{ width: '100%' }}>
                      {ordered.map((option) => {
                        // What is CURRENTLY set, ticked from the start - so it
                        // is obvious what pressing Next without touching
                        // anything will leave you with. English is a real
                        // answer, not a failure to answer.
                        const on = option.value === currentLanguage;
                        const hint = !picked && !on && option.value === suggested;
                        return (
                          <motion.button
                            key={option.value}
                            type="button"
                            onClick={() => pickLanguage(option.value)}
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.97 }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.7vh',
                              padding: '1.1vh 1.7vh',
                              borderRadius: theme.radius.sm,
                              cursor: 'pointer',
                              background: on || hint ? alpha(color, on ? 0.2 : 0.12) : 'rgba(255,255,255,0.04)',
                              border: `0.1vh solid ${on ? alpha(color, 0.7) : hint ? alpha(color, 0.4) : 'rgba(255,255,255,0.08)'}`,
                            }}
                          >
                            {on && <Check size="1.4vh" color={color} />}
                            <Text
                              ff="Akrobat Bold"
                              size="sm"
                              c={on || hint ? color : 'rgba(255,255,255,0.86)'}
                            >
                              {option.label}
                            </Text>
                          </motion.button>
                        );
                      })}
                    </Flex>

                    {/* Currency sits with the language because that is the one
                      * moment anybody knows what it should be, and because the
                      * guess above is only ever a guess. */}
                    {currency && (
                      <Flex align="center" gap="sm" wrap="wrap" justify="center" style={{ width: '100%' }}>
                        <Text ff="Akrobat Bold" size="xs" c="rgba(255,255,255,0.55)">
                          {t('setup.currency', 'Currency symbol')}
                        </Text>
                        <TextInput
                          value={currentCurrency}
                          onChange={(e) => setValue(resource, currency as SettingEntry, e.currentTarget.value)}
                          size="xs"
                          maxLength={4}
                          styles={inputStyles}
                          style={{ width: '9vh' }}
                        />
                        <Flex gap="xxs" wrap="wrap">
                          {QUICK.map((symbol) => (
                            <motion.button
                              key={symbol}
                              type="button"
                              onClick={() => setValue(resource, currency as SettingEntry, symbol)}
                              whileTap={{ scale: 0.92 }}
                              style={{
                                padding: '0.5vh 1vh',
                                borderRadius: theme.radius.xs,
                                cursor: 'pointer',
                                background: currentCurrency === symbol
                                  ? alpha(color, 0.18) : 'rgba(255,255,255,0.04)',
                                border: `0.1vh solid ${currentCurrency === symbol
                                  ? alpha(color, 0.5) : 'rgba(255,255,255,0.08)'}`,
                              }}
                            >
                              <Text
                                ff="Akrobat Bold"
                                size="xs"
                                c={currentCurrency === symbol ? color : 'rgba(255,255,255,0.7)'}
                              >
                                {symbol}
                              </Text>
                            </motion.button>
                          ))}
                        </Flex>
                        <Text ff="Akrobat" size="xxs" c="rgba(255,255,255,0.32)">
                          {currentCurrency}1,250
                        </Text>
                      </Flex>
                    )}

                    {/* Units sit with the language for the same reason currency
                      * does: it is the one moment anyone knows the answer, and
                      * they are shared by every dirk script rather than set
                      * per script. */}
                    {(weightUnit || distanceUnit) && (
                      <Flex align="center" gap="lg" wrap="wrap" justify="center">
                        {weightUnit && (
                          <UnitPick
                            label={t('setup.weight', 'Weight')}
                            entry={weightUnit}
                            resource={resource}
                            color={color}
                            options={[
                              { value: 'kg', label: 'kg' },
                              { value: 'lb', label: 'lb' },
                            ]}
                          />
                        )}
                        {distanceUnit && (
                          <UnitPick
                            label={t('setup.distance', 'Distance')}
                            entry={distanceUnit}
                            resource={resource}
                            color={color}
                            options={[
                              { value: 'm', label: 'm' },
                              { value: 'ft', label: 'ft' },
                            ]}
                          />
                        )}
                      </Flex>
                    )}
                  </Flex>
                ) : (
                  <Flex direction="column" align="center" gap="lg" style={{ width: '100%' }}>
                    <Flex direction="column" align="center" gap="xs">
                      <Palette size="3vh" color={color} />
                      <Text ff="Akrobat Bold" size="lg" c="rgba(255,255,255,0.92)" ta="center">
                        {t('setup.theme_title', 'Theme')}
                      </Text>
                      <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.42)" ta="center">
                        {t('setup.theme_hint', 'Shared by every dirk script. The panel behind repaints as you choose.')}
                      </Text>
                    </Flex>

                    <Flex direction="column" gap="md" style={{ width: '100%' }}>
                      {primaryColor && (
                        <MantineColorControl
                          value={effectiveValue(resource, primaryColor)}
                          resource={resource}
                          path={primaryColor.path}
                          onChange={(next) => setValue(resource, primaryColor as SettingEntry, next)}
                        />
                      )}
                      {primaryShade && (
                        <ShadeControl
                          value={effectiveValue(resource, primaryShade)}
                          resource={resource}
                          path={primaryShade.path}
                          onChange={(next) => setValue(resource, primaryShade as SettingEntry, next)}
                        />
                      )}
                    </Flex>
                  </Flex>
                )}
              </motion.div>
            </AnimatePresence>
          </Flex>

          <Flex align="center" justify="space-between">
            <WizardButton
              label={t('setup.back', 'Back')}
              onClick={() => setStep('language')}
              disabled={index === 0 || saving}
              color={color}
            />
            <Text ff="Akrobat" size="xxs" c="rgba(255,255,255,0.3)">
              {`${index + 1} / ${steps.length}`}
            </Text>
            {step === 'theme' ? (
              <WizardButton
                label={saving ? t('setup.saving', 'Saving…') : t('setup.finish', 'Finish')}
                onClick={finish}
                disabled={saving}
                color={color}
                primary
              />
            ) : (
              <WizardButton
                label={t('setup.next', 'Next')}
                onClick={() => setStep('theme')}
                color={color}
                primary
              />
            )}
          </Flex>
        </Flex>
      </motion.div>
    </Flex>
  );
}

/** Two-or-three-way pick, sized to sit inline next to a label. */
function UnitPick({
  label, entry, resource, color, options,
}: {
  label: string;
  entry: SettingEntry;
  resource: string;
  color: string;
  options: { value: string; label: string }[];
}) {
  const theme = useMantineTheme();
  const current = String(effectiveValue(resource, entry) ?? '');
  return (
    <Flex align="center" gap="xs">
      <Text ff="Akrobat Bold" size="xs" c="rgba(255,255,255,0.55)">{label}</Text>
      <Flex gap="xxs">
        {options.map((option) => {
          const on = option.value === current;
          return (
            <motion.button
              key={option.value}
              type="button"
              onClick={() => setValue(resource, entry, option.value)}
              whileTap={{ scale: 0.92 }}
              style={{
                padding: '0.5vh 1.2vh',
                borderRadius: theme.radius.xs,
                cursor: 'pointer',
                background: on ? alpha(color, 0.18) : 'rgba(255,255,255,0.04)',
                border: `0.1vh solid ${on ? alpha(color, 0.5) : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              <Text ff="Akrobat Bold" size="xs" c={on ? color : 'rgba(255,255,255,0.7)'}>
                {option.label}
              </Text>
            </motion.button>
          );
        })}
      </Flex>
    </Flex>
  );
}

/** Numbered dots joined by a rail that fills as far as you have got. */
function Stepper({
  steps, index, color,
}: {
  steps: { id: string; label: string; icon: React.ElementType }[];
  index: number;
  color: string;
}) {
  return (
    <Flex align="center" justify="center" gap="xs">
      {steps.map((entry, i) => {
        const done = i < index;
        const on = i === index;
        const Icon = entry.icon;
        return (
          <Flex key={entry.id} align="center" gap="xs">
            <Flex align="center" gap="xs">
              <Flex
                align="center"
                justify="center"
                style={{
                  width: '2.8vh',
                  height: '2.8vh',
                  borderRadius: '50%',
                  background: done || on ? alpha(color, done ? 0.22 : 0.16) : 'rgba(255,255,255,0.05)',
                  border: `0.1vh solid ${done || on ? alpha(color, 0.6) : 'rgba(255,255,255,0.1)'}`,
                }}
              >
                {done
                  ? <Check size="1.3vh" color={color} />
                  : <Icon size="1.3vh" color={on ? color : 'rgba(255,255,255,0.35)'} />}
              </Flex>
              <Text
                ff="Akrobat Bold"
                size="xxs"
                tt="uppercase"
                lts="0.07em"
                c={done || on ? color : 'rgba(255,255,255,0.3)'}
              >
                {entry.label}
              </Text>
            </Flex>
            {i < steps.length - 1 && (
              <Flex
                style={{
                  width: '6vh',
                  height: '0.2vh',
                  borderRadius: '0.2vh',
                  background: done ? alpha(color, 0.5) : 'rgba(255,255,255,0.08)',
                }}
              />
            )}
          </Flex>
        );
      })}
    </Flex>
  );
}

function WizardButton({
  label, onClick, disabled, primary, color,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  color: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.03 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      style={{
        padding: '1vh 2.4vh',
        borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.3 : 1,
        background: primary ? alpha(color, 0.18) : 'rgba(255,255,255,0.04)',
        border: `0.1vh solid ${primary ? alpha(color, 0.55) : 'rgba(255,255,255,0.08)'}`,
        transition: 'opacity 120ms',
      }}
    >
      <Text ff="Akrobat Bold" size="xs" c={primary ? color : 'rgba(255,255,255,0.7)'}>
        {label}
      </Text>
    </motion.button>
  );
}
