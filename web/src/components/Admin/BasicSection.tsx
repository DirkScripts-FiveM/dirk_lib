import { alpha, Flex, Select, Switch, Text, TextInput, useMantineTheme } from "@mantine/core";
import { AdminPageTitle, locale, useFormActions, useFormField } from "dirk-cfx-react";
import { SlidersHorizontal } from "lucide-react";
import type { BasicSettings, ScriptConfig } from "../../stores/useScriptConfig";
import { useScriptConfig } from "../../stores/useScriptConfig";
import { InfoLabel } from "./InfoLabel";

// Must stay in step with schema.json's basic.language enum and the files in
// /locales - an option with no locale file silently renders English.
const LANGUAGE_OPTIONS = [
  { value: "en", label: "English (en)" },
  { value: "de", label: "Deutsch (de)" },
  { value: "es", label: "Español (es)" },
  { value: "fr", label: "Français (fr)" },
  { value: "it", label: "Italiano (it)" },
  { value: "ja", label: "日本語 (ja)" },
  { value: "lt", label: "Lietuvių (lt)" },
  { value: "nl", label: "Nederlands (nl)" },
  { value: "no", label: "Norsk (no)" },
  { value: "pl", label: "Polski (pl)" },
  { value: "pt", label: "Português (pt)" },
  { value: "zh-CN", label: "简体中文 (zh-CN)" },
  { value: "zh-TW", label: "繁體中文 (zh-TW)" },
];

function GroupLabel({ label }: { label: string }) {
  return (
    <Flex align="center" gap="xs" mt="xxs">
      <Text ff="Akrobat Bold" size="xxs" tt="uppercase" lts="0.07em" c="rgba(255,255,255,0.2)">
        {label}
      </Text>
      <div style={{ flex: 1, height: "0.05vh", background: "rgba(255,255,255,0.06)" }} />
    </Flex>
  );
}

// Styled toggle row matching dirk_fishing's BasicSection (label + description in
// a bordered card with a coloured track), so the debug toggle looks consistent
// across the two configurators.
function SwitchRow({ label, description, checked, onChange }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  return (
    <Flex
      justify="space-between" align="center" p="xs"
      style={{
        background: alpha(theme.colors.dark[5], 0.35),
        border: "0.1vh solid rgba(255,255,255,0.05)",
        borderRadius: theme.radius.xs,
      }}
    >
      <Flex direction="column" gap="xxs">
        <Text ff="Akrobat Bold" size="xs" c="rgba(255,255,255,0.75)">{locale(label)}</Text>
        {description && (
          <Text ff="Akrobat Bold" size="xxs" c="dimmed">{locale(description)}</Text>
        )}
      </Flex>
      <Switch
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        size="md"
        pr="xxs"
        styles={{
          track: {
            background: checked ? alpha(color, 0.4) : "rgba(255,255,255,0.08)",
            borderColor: checked ? alpha(color, 0.6) : "rgba(255,255,255,0.1)",
          },
        }}
      />
    </Flex>
  );
}

export default function BasicSection() {
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];

  const formConfig = useFormField<ScriptConfig>("basic") as BasicSettings | undefined;
  const storeConfig = useScriptConfig((s) => s.basic);
  const config = (formConfig ?? storeConfig) as BasicSettings;
  const { setValue } = useFormActions<ScriptConfig>();

  const set = <K extends keyof BasicSettings>(key: K, val: BasicSettings[K]) =>
    setValue("basic", { ...config, [key]: val });

  return (
    <Flex direction="column" gap="xs" p="sm" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <AdminPageTitle icon={SlidersHorizontal} title={locale("dirk_lib_basic_title")} color={color} />

      <SwitchRow
        label="dirk_lib_advanced_debug_label"
        description="dirk_lib_advanced_debug_desc"
        checked={config.debug}
        onChange={(v) => set("debug", v)}
      />

      <GroupLabel label={locale("dirk_lib_branding_identity_group")} />
      <TextInput
        label={<InfoLabel label={locale("dirk_lib_branding_name_label")} tooltip={locale("dirk_lib_branding_name_tooltip")} />}
        size="xs"
        value={config.serverName}
        onChange={(e) => set("serverName", e.currentTarget.value)}
      />

      <GroupLabel label={locale("dirk_lib_localization_strings_group")} />
      <Select
        label={<InfoLabel label={locale("dirk_lib_localization_language_label")} tooltip={locale("dirk_lib_localization_language_tooltip")} />}
        size="xs"
        value={config.language}
        data={LANGUAGE_OPTIONS}
        allowDeselect={false}
        searchable
        onChange={(v) => v && set("language", v)}
      />
      <TextInput
        label={<InfoLabel label={locale("dirk_lib_localization_symbol_label")} tooltip={locale("dirk_lib_localization_symbol_tooltip")} />}
        size="xs"
        value={config.currency}
        onChange={(e) => set("currency", e.currentTarget.value)}
      />

    </Flex>
  );
}
