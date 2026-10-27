import { alpha, Flex, Loader, MultiSelect, Select, Text, TextInput, Tooltip, useMantineTheme } from '@mantine/core';
import { motion } from 'framer-motion';
import { AtSign, Bot, TriangleAlert } from 'lucide-react';
import { useStudio } from './store';
import { roleColor, useDiscordRoles } from './discordRoles';
import { useChrome } from './studioLocale';

/**
 * Pick Discord roles instead of pasting role ids.
 *
 * A role id is eighteen digits copied out of Discord's developer mode, and a
 * wrong one fails silently: the locked backstory nobody can pick, the VIP slot
 * nobody gets. Picking from the bot's own list makes that mistake impossible.
 *
 * With no bot set up the field still works - it falls back to typing ids, and
 * says so - because a server that does not use the bot should not lose a
 * setting over it. Ids that are not in the list (a deleted role) are kept and
 * shown as such rather than silently dropped.
 */
export function DiscordRoleControl({
  value, onChange, disabled, multiple,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  multiple?: boolean;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const { data, isLoading, isError } = useDiscordRoles();

  const ids: string[] = multiple
    ? (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [])
    : (typeof value === 'string' && value ? [value] : []);

  const inputStyles = {
    input: {
      background: alpha(theme.colors.dark[9], 0.6),
      border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.5)}`,
      color: 'rgba(255,255,255,0.85)',
      fontFamily: 'Akrobat SemiBold',
      minHeight: '3vh',
    },
  };

  if (isLoading) {
    return (
      <Flex align="center" gap="xs">
        <Loader size="1.4vh" color={color} />
        <Text ff="Akrobat SemiBold" size="xxs" c="rgba(255,255,255,0.4)">
          {t('discordRole.loading', 'Asking Discord…')}
        </Text>
      </Flex>
    );
  }

  const roles = data?.roles ?? [];
  const unavailable = isError || !data?.configured || roles.length === 0;

  // No bot: still editable, by id. The reason is a hover on an icon INSIDE the
  // box rather than a line under it - a second line pushed every row below it
  // down. Beside it, the way to fix it: straight to dirk_lib's Discord settings.
  if (unavailable) {
    const why = isError || data?.error
      ? t('discordRole.failed', 'Could not reach Discord - check the bot token and that the bot is in your server. Type role ids until then.')
      : !data?.configured
        ? t('discordRole.not_setup', 'No Discord bot set up, so roles are typed as ids. Set one up to pick them by name.')
        : t('discordRole.none', 'The bot sees no roles - type role ids instead.');
    return (
      <Flex align="center" gap="0.4vh" style={{ width: '30vh' }}>
        <TextInput
          value={ids.join(', ')}
          disabled={disabled}
          placeholder={t('discordRole.ids', 'Role id, role id…')}
          onChange={(e) => {
            const next = e.currentTarget.value.split(/[\s,]+/).filter(Boolean);
            onChange(multiple ? next : (next[0] ?? ''));
          }}
          rightSection={(
            <Tooltip label={why} multiline w="28vh" withArrow withinPortal zIndex={10500}>
              <TriangleAlert size="1.3vh" color="#E0B15F" style={{ cursor: 'help' }} />
            </Tooltip>
          )}
          rightSectionPointerEvents="all"
          styles={inputStyles}
          style={{ flex: 1, minWidth: 0 }}
        />
        {!isError && !data?.configured && (
          <Tooltip label={t('discordRole.setup', 'Set up a Discord bot')} withArrow withinPortal zIndex={10500}>
            <motion.button
              type="button"
              onClick={() => useStudio.setState({ goToRequest: { resource: 'dirk_lib', group: 'discord' } })}
              whileHover={{ background: alpha(color, 0.16) }}
              whileTap={{ scale: 0.95 }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '3vh', height: '3vh', flexShrink: 0,
                background: alpha(color, 0.08),
                border: `0.1vh solid ${alpha(color, 0.35)}`,
                borderRadius: theme.radius.xs,
                cursor: 'pointer',
              }}
            >
              <Bot size="1.4vh" color={color} />
            </motion.button>
          </Tooltip>
        )}
      </Flex>
    );
  }

  // Known roles, plus any saved id the bot no longer has - kept, and labelled.
  const known = new Set(roles.map((r) => r.id));
  const options = [
    ...roles.map((r) => ({ value: r.id, label: r.name })),
    ...ids.filter((id) => !known.has(id)).map((id) => ({
      value: id, label: t('discordRole.unknown', 'Unknown role {}').replace('{}', id),
    })),
  ];
  const colorOf = (id: string) => roleColor(roles.find((r) => r.id === id)?.color ?? 0);

  const renderOption = ({ option }: { option: { value: string; label: string } }) => (
    <Flex align="center" gap="0.6vh">
      <div style={{ width: '1vh', height: '1vh', borderRadius: '50%', background: colorOf(option.value), flexShrink: 0 }} />
      <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.85)">{option.label}</Text>
    </Flex>
  );

  const common = {
    data: options,
    disabled,
    searchable: true,
    renderOption,
    nothingFoundMessage: t('discordRole.no_match', 'No role by that name'),
    comboboxProps: { withinPortal: true, zIndex: 10400 },
    leftSection: <AtSign size="1.3vh" color="rgba(255,255,255,0.35)" />,
    leftSectionWidth: '2.4vh',
    styles: { input: { ...inputStyles.input, paddingLeft: '2.6vh' } },
    style: { width: '30vh' },
  };

  return multiple ? (
    <MultiSelect
      {...common}
      value={ids}
      onChange={(next) => onChange(next)}
      placeholder={ids.length ? undefined : t('discordRole.pickMany', 'Pick roles')}
      clearable
    />
  ) : (
    <Select
      {...common}
      value={ids[0] ?? null}
      onChange={(next) => onChange(next ?? '')}
      placeholder={t('discordRole.pick', 'Pick a role')}
      clearable
    />
  );
}
