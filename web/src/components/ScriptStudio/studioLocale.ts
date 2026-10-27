import { useCallback } from 'react';
import { fetchNui, isEnvBrowser } from 'dirk-cfx-react';
import { useStudio } from './store';

/**
 * Setting labels belong to the SCRIPT, not to dirk_lib.
 *
 * The hub renders every script's settings, but the words describing them ship
 * with the script that owns them - otherwise adding a setting to fishing would
 * need a dirk_lib locale update, and dirk_lib's locale file would slowly become
 * a dumping ground for every product.
 *
 * Resolution order for any string:
 *   1. the script's own bundle for the active language
 *   2. the script's own bundle for English
 *   3. the schema's text (already English)
 *
 * So a script works with no translations at all, and translating is purely
 * additive. dirk_lib's own locales cover only the panel's chrome - Save,
 * Discard, "Search these settings...".
 *
 * Keys are DERIVED from the setting path, so nothing needs annotating:
 *   basic.debug          -> settings.basic.debug.label / .description
 *   <group id>           -> sections.<id>.label / .description
 */

export type LocaleBundle = Record<string, string>;
/** resource -> language -> key -> text */
export type LocaleBundles = Record<string, Record<string, LocaleBundle>>;

export function settingKey(path: string, field: 'label' | 'description'): string {
  return `settings.${path}.${field}`;
}

export function sectionKey(groupId: string, field: 'label' | 'description'): string {
  return `sections.${groupId}.${field}`;
}

/**
 * The language the panel is showing. Comes from dirk_lib's own
 * `appearance.language` setting, read through the draft so switching it
 * re-renders every label immediately - no reopen, exactly like the old panel.
 */
/**
 * The same read, outside React - validation runs as a plain function over the
 * store and cannot call a hook.
 */
export function activeLanguage(): string {
  return pickLanguage(useStudio.getState());
}

export function useActiveLanguage(): string {
  return useStudio(pickLanguage);
}

function pickLanguage(state: ReturnType<typeof useStudio.getState>): string {
  return ((state) => {
    const lib = state.scripts.find((script) => script.shared);
    if (!lib) return 'en';
    const entry = lib.entries.find((item) => item.path.endsWith('.language'));
    if (!entry) return 'en';
    const staged = state.draft[lib.resource]?.[entry.path];
    const value = staged
      ? (staged.kind === 'reset' ? entry.default : staged.value)
      : entry.value;
    return typeof value === 'string' ? value : 'en';
  })(state);
}

export function useBundles(): LocaleBundles {
  return useStudio((state) => state.locales);
}

/** Resolve one string, falling back through language -> English -> schema. */
export function translate(
  bundles: LocaleBundles,
  language: string,
  resource: string,
  key: string,
  fallback: string,
): string {
  const forResource = bundles[resource];
  if (!forResource) return fallback;
  return forResource[language]?.[key]
    ?? forResource.en?.[key]
    ?? fallback;
}

/**
 * Pull the bundles for one language into the store.
 *
 * Nothing was doing this: the panel resolved every label through
 * `state.locales`, which never moved off its browser mock, so switching the
 * language setting re-rendered everything in exactly the same English.
 *
 * English is fetched alongside anything else, because it is the fallback the
 * whole resolution chain leans on. Already-loaded languages are skipped - the
 * bundles are immutable for the life of the resource.
 *
 * ONE call for every language still missing, and only for the scripts missing
 * it. It was a call per language, one after the other, each re-reading every
 * script's file - so a German panel paid two round trips in a row, and one
 * restarted script (forgetLocales) re-fetched everyone's.
 */
const inFlight = new Set<string>();

export async function loadLocales(language: string) {
  if (isEnvBrowser()) return;

  const state = useStudio.getState();
  const wanted = language === 'en' ? ['en'] : [language, 'en'];

  const resources = state.scripts
    .map((script) => script.resource)
    .filter((resource) => wanted.some((lang) =>
      !state.locales[resource]?.[lang] && !inFlight.has(`${resource}:${lang}`)));
  if (resources.length === 0) return;

  const languages = wanted.filter((lang) =>
    resources.some((resource) => !state.locales[resource]?.[lang]));
  // The effect that calls this re-runs as the script list changes; an ask
  // already on its way is not asked again.
  const keys = resources.flatMap((resource) => languages.map((lang) => `${resource}:${lang}`));
  for (const key of keys) inFlight.add(key);

  const byLanguage = await fetchNui<Record<string, Record<string, LocaleBundle>>>(
    'GET_STUDIO_LOCALES',
    { languages, resources },
    {},
  ).catch(() => ({} as Record<string, Record<string, LocaleBundle>>));

  for (const key of keys) inFlight.delete(key);

  useStudio.setState((current) => {
    const next: LocaleBundles = { ...current.locales };
    for (const lang of languages) {
      for (const [resource, bundle] of Object.entries(byLanguage?.[lang] ?? {})) {
        next[resource] = { ...next[resource], [lang]: bundle };
      }
      // A language with no file anywhere still gets marked as attempted, so a
      // missing translation is not re-fetched on every render.
      for (const resource of resources) {
        if (!next[resource]?.[lang]) {
          next[resource] = { ...next[resource], [lang]: {} };
        }
      }
    }
    return { locales: next };
  });
}

/**
 * Drop one script's bundles when that resource restarts. "Immutable for the
 * life of the resource" ends there: a script that gained or fixed a locale
 * file kept the empty bundle the panel recorded before, and showed English
 * until the player reconnected (dirk_containers, 30/09). The next loadLocales
 * (it runs when the script list reloads) fetches it again.
 */
export function forgetLocales(resource: string) {
  useStudio.setState((current) => {
    if (!current.locales[resource]) return {};
    const next: LocaleBundles = { ...current.locales };
    delete next[resource];
    return { locales: next };
  });
}

/**
 * A translator for the panel's OWN strings.
 *
 * Setting labels belong to the script that owns them; the panel's furniture
 * belongs to dirk_lib. Components kept inlining that furniture in English,
 * which is why the overview page and the theme hints stayed English while the
 * settings around them translated. Keys are prefixed `studio.` so the panel's
 * strings are obvious in the bundle.
 */
export function useChrome() {
  const language = useActiveLanguage();
  const bundles = useBundles();
  // stable while the language and bundles are, so it can sit in a memo's deps
  return useCallback(
    (key: string, fallback: string) => translate(bundles, language, 'dirk_lib', `studio.${key}`, fallback),
    [bundles, language],
  );
}
