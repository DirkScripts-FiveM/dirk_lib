import { Box, Flex, Text, alpha, useMantineTheme } from '@mantine/core';
import { LayoutTemplate } from 'lucide-react';
import portableJson from './fixtures/loadingPortable.json';
import { useChrome } from './studioLocale';

/**
 * Design and component tiles for the hub.
 *
 * These USED to render live: dirk_loading emits a portable manifest (plain JSON
 * with images and locale strings pre-resolved) and `dirk-ui-studio/runtime`
 * turned it back into something real. That is still the right design and the
 * fixture below is still the right data.
 *
 * It is stubbed for now because the runtime lives in a PRIVATE repo, and
 * dirk_lib is public and released from a public build. Carrying the dependency
 * meant every build of the library needed credentials for a package that only
 * one unreachable page uses — `designs` is set nowhere except the browser mock,
 * so nothing in game can even open this page until dirk_loading and
 * dirk_multichar ship their design editors.
 *
 * Putting it back is one import and one component: restore the
 * `dirk-ui-studio/runtime` import, hand `fromPortable(portable, renderIcon)` to
 * a `DesignSurface`, and delete the placeholder. Nothing else here changes, and
 * the shape of what this file exports is deliberately unchanged so DesignPage
 * needs no edit either way.
 */

/** the Studio's own canvas colour — dirk-ui-studio src/editor/ui.tsx */
export const CANVAS = '#080a08';

// ── The fixture, read directly ──────────────────────────────────────────────
// Only the fields the page actually draws. Typed locally rather than pulled
// from the runtime package, which is the whole point of the stub.

export type StudioDesign = {
  id: string;
  name: string;
  description?: string;
  elements?: unknown[];
  pages?: unknown[];
};

export type StudioComponent = {
  id: string;
  name: string;
  description?: string;
  category?: string;
};

type Portable = { designs?: StudioDesign[]; components?: StudioComponent[] };
const portable = portableJson as unknown as Portable;

/** Kept as an export so DesignPage's imports are unchanged. Unused by the stub. */
export const loadingManifest = null;

export const loadingDesigns: StudioDesign[] = portable.designs ?? [];
export const loadingComponents: StudioComponent[] = portable.components ?? [];

export const componentPreview = (component: StudioComponent): StudioDesign => ({
  id: component.id,
  name: component.name,
  description: component.description,
});

/**
 * A framed placeholder in place of the rendered design.
 *
 * Deliberately not a broken image or an empty box: it keeps the tile's exact
 * geometry so the grid stays honest, and says plainly that the preview is off
 * rather than looking like a design that failed to load.
 */
export function LiveThumb({
  design,
  ratio = 16 / 9,
}: {
  design: StudioDesign;
  /** kept for signature compatibility with the live version */
  manifest?: unknown;
  /** width ÷ height of the frame; designs and components both use 16:9 */
  ratio?: number;
}) {
  const t = useChrome();
  const theme = useMantineTheme();
  const accent = theme.colors[theme.primaryColor][5];

  return (
    <Box
      style={{
        aspectRatio: String(ratio),
        width: '100%',
        background: CANVAS,
        borderRadius: '0.6vh',
        overflow: 'hidden',
      }}
    >
      <Flex
        h="100%"
        w="100%"
        direction="column"
        align="center"
        justify="center"
        gap="0.6vh"
      >
        <LayoutTemplate size="2.4vh" color={alpha(accent, 0.45)} />
        <Text size="1.2vh" c={alpha('#fff', 0.35)} ta="center" px="1vh">
          {design?.name ?? t('designPreview', 'Preview')}
        </Text>
      </Flex>
    </Box>
  );
}
