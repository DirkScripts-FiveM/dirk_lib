import { alpha, Flex, Text, Textarea, useMantineTheme } from '@mantine/core';
import { copyToClipboard } from 'dirk-cfx-react';
import { Modal } from './Dialog';
import { AlertTriangle, Braces, Check, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { effectiveValue, setValue } from './store';
import { StudioButton } from './ui';
import type { StudioScript } from './types';
import { useChrome } from './studioLocale';
import { problemsForValues } from './validate';

/**
 * Paste a whole config in, or copy one out.
 *
 * Still goes through the draft rather than writing: an import stages every
 * changed path, so it lands in the save bar, the confirm and the change log
 * exactly like a hand edit. Anything the schema does not declare is reported
 * rather than silently written.
 */
export function JsonModal({
  script, canEdit, onClose,
}: {
  script: StudioScript;
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];

  const current = useMemo(() => buildObject(script), [script]);
  const [text, setText] = useState(() => JSON.stringify(current, null, 2));
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(0);

  const check = useMemo(() => validate(text, script), [text, script]);

  /**
   * The SAME checks the form applies, against what was pasted.
   *
   * Syntax and unknown paths were the only things this ever looked at, so a
   * string where a number belongs, a percentage of 400 or a misspelled enum
   * applied without a word - while the identical value typed into the form was
   * refused. Blocking here rather than warning, because the save bar already
   * blocks a save for exactly these problems: letting it in through this door
   * only moves the failure somewhere less obvious.
   */
  const problems = useMemo(() => {
    if (!check.ok) return [];
    const known = new Set(script.entries.map((entry) => entry.path));
    const flat = flatten(check.parsed as Record<string, unknown>, known);
    const values = new Map<string, unknown>(
      Object.entries(flat).filter(([path]) => known.has(path)),
    );
    return problemsForValues(script.resource, values);
  }, [check, script]);

  const copy = () => {
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const apply = () => {
    if (!check.ok || problems.length > 0) return;
    const known = new Set(script.entries.map((entry) => entry.path));
    const flat = flatten(check.parsed as Record<string, unknown>, known);
    let changed = 0;
    for (const entry of script.entries) {
      if (!(entry.path in flat)) continue;
      const next = flat[entry.path];
      if (JSON.stringify(next) === JSON.stringify(effectiveValue(script.resource, entry))) continue;
      setValue(script.resource, entry, next);
      changed += 1;
    }
    setApplied(changed);
    setTimeout(() => setApplied(0), 2400);
  };

  return (
    <Modal
      title={t('jsonModal.config_as_json', 'Config as JSON')}
      icon={Braces}
      iconColor={color}
      description={script.resource}
      badge={{ label: `${script.entries.length} SETTINGS`, color }}
      onClose={onClose}
      width="120vh"
      height="80vh"
      zIndex={10100}
    >
      <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
        <Flex direction="column" flex={1} p="sm" gap="xs" style={{ minHeight: 0 }}>
          <Textarea
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            spellCheck={false}
            autosize={false}
            styles={{
              root: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 },
              wrapper: { flex: 1, display: 'flex', minHeight: 0 },
              input: {
                flex: 1,
                height: '100%',
                background: alpha(theme.colors.dark[9], 0.75),
                border: `0.1vh solid ${alpha(check.ok ? theme.colors.dark[4] : '#E0776B', check.ok ? 0.55 : 0.6)}`,
                color: 'rgba(255,255,255,0.88)',
                fontFamily: 'monospace',
                fontSize: '1.3vh',
                lineHeight: 1.55,
                borderRadius: theme.radius.xs,
              },
            }}
            className="studio-scroll"
          />

          {/* what is wrong, or what will happen */}
          <Flex align="center" gap="xs" style={{ minHeight: '3vh' }}>
            {!check.ok ? (
              <>
                <AlertTriangle size="1.5vh" color="#E0776B" />
                <Text ff="Akrobat SemiBold" size="xs" c="#E0776B">{check.error}</Text>
              </>
            ) : problems.length > 0 ? (
              <>
                <AlertTriangle size="1.5vh" color="#E0776B" />
                <Text ff="Akrobat SemiBold" size="xs" c="#E0776B" style={{ flexShrink: 0 }}>
                  {problems.length} {problems.length === 1 ? 'value is' : 'values are'} not valid:
                </Text>
                <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.55)" truncate>
                  {problems.slice(0, 2).map((p) => `${p.label} — ${p.message}`).join(' · ')}
                  {problems.length > 2 ? ` +${problems.length - 2}` : ''}
                </Text>
              </>
            ) : check.unknown.length > 0 ? (
              <>
                <AlertTriangle size="1.5vh" color="#E0B15F" />
                <Text ff="Akrobat SemiBold" size="xs" c="#E0B15F">
                  {check.unknown.length} path{check.unknown.length === 1 ? '' : 's'} not in this schema and will be ignored:
                </Text>
                <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.45)" truncate>
                  {check.unknown.slice(0, 4).join(', ')}
                  {check.unknown.length > 4 ? ` +${check.unknown.length - 4}` : ''}
                </Text>
              </>
            ) : (
              <>
                <Check size="1.5vh" color={color} />
                <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.45)">
                  {t('jsonModal.valid_every_path_matches_this_script_s_s', 'Valid — every path matches this script\'s schema.')}
                </Text>
              </>
            )}
          </Flex>
        </Flex>

        <Flex
          align="center" justify="space-between" px="sm" py="xs"
          style={{ borderTop: `0.1vh solid ${alpha(theme.colors.dark[4], 0.4)}`, flexShrink: 0 }}
        >
          <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.3)">
            {applied > 0
              ? `${applied} setting${applied === 1 ? '' : 's'} staged — review and Save`
              : 'Importing stages the changes; nothing is written until you Save.'}
          </Text>
          <Flex gap="xs">
            <StudioButton label={copied ? 'Copied' : 'Copy'} icon={copied ? Check : Copy} onClick={copy} />
            <StudioButton label={t('jsonModal.reset_to_current', 'Reset to current')} onClick={() => setText(JSON.stringify(current, null, 2))} />
            <StudioButton
              label={t('jsonModal.stage_import', 'Stage import')}
              primary
              disabled={!canEdit || !check.ok || problems.length > 0}
              onClick={apply}
            />
          </Flex>
        </Flex>
      </Flex>
    </Modal>
  );
}

type Check =
  | { ok: true; parsed: unknown; unknown: string[] }
  | { ok: false; error: string; unknown: string[] };

function validate(text: string, script: StudioScript): Check {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: (error as Error).message, unknown: [] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Top level must be an object', unknown: [] };
  }

  const known = new Set(script.entries.map((entry) => entry.path));
  const unknown = Object.keys(flatten(parsed as Record<string, unknown>, known))
    .filter((path) => !known.has(path));

  return { ok: true, parsed, unknown };
}

/** entries -> nested object, so the JSON reads like the config file it mirrors */
function buildObject(script: StudioScript): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of script.entries) {
    const parts = entry.path.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i];
      if (typeof node[key] !== 'object' || node[key] === null || Array.isArray(node[key])) node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = effectiveValue(script.resource, entry);
  }
  return out;
}

/**
 * Nested object -> dot paths, split exactly where the SETTINGS are.
 *
 * The depth is decided by `known`, not guessed from shape. The old rule stopped
 * at any object holding no further objects, which cut one level too early for
 * something like `logger.loki.endpoint`: the tree collapsed to `logger.loki`,
 * that is not a setting path, and an untouched default config therefore
 * reported nine paths as "not in this schema and will be ignored". The same
 * mismatch meant Apply silently skipped those settings, because it looked them
 * up by their real path and the flattened map did not have one.
 */
function flatten(
  node: Record<string, unknown>,
  known: Set<string>,
  prefix = '',
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;

    // A setting stops the walk, whatever shape it holds - a coords pair and a
    // key/value map are single values however object-like they look.
    if (known.has(path)) {
      out[path] = value;
      continue;
    }

    // Not a setting itself, but settings may live below it.
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value as Record<string, unknown>, known, path, out);
      continue;
    }

    // A leaf that is not a setting: genuinely not in this schema.
    out[path] = value;
  }
  return out;
}
