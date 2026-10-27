import { alpha, Flex, Loader, Text, useMantineTheme } from '@mantine/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CustomControl, load, REASONS } from './CustomControl';
import { effectiveValue, setValue } from './store';
import { Icon } from './Icon';
import { notify } from './Toasts';
import { studioQueryClient } from './studioQuery';
import { translate, useActiveLanguage, useBundles } from './studioLocale';
import type { ScriptPage as ScriptPageDef, SettingEntry, SlottedSetting } from './types';

/**
 * A whole page supplied by the script that owns it.
 *
 * `x-component` covers a control standing in for one SETTING. Some of what the
 * per-script panels did was never a setting at all: fishing's Players screen
 * reads live server data, pages through it and acts on it. There is nothing in
 * the config for it to be, and inventing a fake entry just to have a mounting
 * point would put a setting in the schema that is not one.
 *
 * So a page is its own thing. dirk_lib supplies the frame, the theme, the
 * loader and a query client; the script supplies what goes in it, and keeps
 * every bit of knowledge about its own data.
 */
export function ScriptPage({
  resource, page, canEdit, onBack, full, setFull, entry, settings,
}: {
  resource: string;
  page: ScriptPageDef;
  canEdit: boolean;
  /**
   * The setting this page EDITS, when it declares `x-pages[].path`.
   *
   * Given one, the page is mounted through CustomControl rather than loaded
   * here: that is what already owns the row editor, the staging and the save
   * bar, so a page that is really a list gets all three for free instead of
   * building its own and drifting from the rest of the panel.
   */
  entry?: SettingEntry;
  /** the settings that belong to this page, for it to place as it likes */
  settings?: SlottedSetting[];
  /** handed on to the page, so a full-window one can close itself */
  onBack?: () => void;
  /** whether the page currently HAS the whole window */
  full?: boolean;
  /** ask for it, or give it back - a Designs tab does this on open/close */
  setFull?: (on: boolean) => void;
}) {
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  const language = useActiveLanguage();
  const bundles = useBundles();

  const [state, setState] = useState<
    | { state: 'loading' }
    | { state: 'ready'; Component: React.ComponentType<Record<string, unknown>> }
    | { state: 'failed'; reason: string }
  >({ state: 'loading' });

  useEffect(() => {
    // A page bound to a setting is mounted by CustomControl, which does its
    // own loading. Nothing to fetch here.
    if (entry) return;
    let live = true;
    setState({ state: 'loading' });
    load(resource, page.component)
      .then((Component) => {
        if (live) {
          setState({
            state: 'ready',
            Component: Component as unknown as React.ComponentType<Record<string, unknown>>,
          });
        }
      })
      .catch((error: Error) => {
        if (live) setState({ state: 'failed', reason: REASONS[error.message] ?? error.message });
      });
    return () => { live = false; };
  }, [resource, page.component, entry]);

  return (
    <Flex
      direction="column" flex={1}
      p={full ? 0 : 'md'}
      style={{ minHeight: 0, overflow: 'hidden' }}
    >
      {/* A full-window page IS the window. It brings its own title bar and its
          own way out, so a second heading above it - inside a panel header that
          is also naming it - reads as a page inside a page. */}
      {!full && (
      <Flex align="flex-start" gap="xs" mb="0.6vh" style={{ flexShrink: 0 }}>
        <Flex align="center" gap="xs" style={{ flexShrink: 0 }}>
          <Icon name={page.icon} size="1.9vh" color={color} />
          <Text ff="Akrobat Bold" size="md" c="rgba(255,255,255,0.92)" lts="0.01em">
            {translate(bundles, language, resource, `studio.pages.${page.id}.label`, page.label)}
          </Text>
        </Flex>
        {page.description && (
          <Text
            ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.35)"
            style={{ flex: 1, minWidth: 0, lineHeight: 1.9 }}
          >
            {translate(
              bundles, language, resource,
              `studio.pages.${page.id}.description`, page.description,
            )}
          </Text>
        )}
      </Flex>
      )}

      <Flex direction="column" flex={1} style={{ minHeight: 0 }}>
        {entry && (
          <CustomControl
            resource={resource}
            component={entry.component ?? page.component}
            entry={entry}
            value={effectiveValue(resource, entry)}
            canEdit={canEdit}
            bare
            settings={settings}
            onBack={onBack}
            full={full}
            setFull={setFull}
            onChange={(next) => setValue(resource, entry, next)}
          />
        )}

        {!entry && state.state === 'loading' && (
          <Flex align="center" justify="center" flex={1}>
            <Loader size="sm" color={color} />
          </Flex>
        )}

        {!entry && state.state === 'failed' && (
          <Flex
            direction="column" align="center" justify="center" gap="xs" flex={1} p="md"
            style={{
              background: alpha('#ef4444', 0.06),
              border: `0.1vh solid ${alpha('#ef4444', 0.3)}`,
              borderRadius: theme.radius.xs,
            }}
          >
            <AlertTriangle size="2.4vh" color="#ef4444" />
            <Text ff="Akrobat Bold" size="sm" c="#ef4444">
              {resource} could not supply this page
            </Text>
            <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.45)" ta="center">
              {state.reason}
            </Text>
            <Text ff="monospace" size="xxs" c="rgba(255,255,255,0.25)">
              {page.component}
            </Text>
          </Flex>
        )}

        {!entry && state.state === 'ready' && (
          // Its own provider, because a script page is the first thing here
          // that fetches on its own schedule - a player list is paged, cached
          // and refetched, none of which the settings tree needs.
          <QueryClientProvider client={studioQueryClient}>
            <state.Component
              resource={resource}
              canEdit={canEdit}
              notify={notify}
              onBack={onBack}
              full={full}
              setFull={setFull}
              t={(key: string, fallback: string) => translate(
                bundles, language, resource, key, fallback,
              )}
            />
          </QueryClientProvider>
        )}
      </Flex>
    </Flex>
  );
}
