import { fetchNui, isEnvBrowser } from 'dirk-cfx-react';
import { Modal } from './Dialog';
import { ScrollText } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { SectionHeading } from './Frame';
import { Chip, Empty, Search } from './studioKit';
import { useStudio } from './store';
import { compareVersions, useRemoteChangelog } from './publicInfo';
import { useChrome } from './studioLocale';
import './kitpages.css';

/**
 * What changed, for the version actually installed.
 *
 * Every script already ships a CHANGELOG.md, and the server can read any file
 * inside any resource - the same route scriptConfig already uses for
 * schema.json. So this needs no endpoint and no network: it is the changelog
 * for the exact build on this server, not whatever happens to be newest.
 *
 * The file is markdown, but only four things are ever drawn from it - a
 * release heading, a section heading, a bullet, and bold inside a bullet.
 * Parsed here rather than rendered as markup, so a changelog is text this
 * panel lays out and never HTML it executes.
 */

type Bullet = { bold?: string; text: string };
type Section = { heading: string; bullets: Bullet[] };
type Release = { version: string; date: string; sections: Section[] };

/**
 * `# UPDATE 1.2.78 | 17/07/2026`, and the ones that drift from it.
 *
 * multichar writes `# Update 1.5.0 12/05/2026` with no pipe, which is exactly
 * the sort of thing a strict parser would drop silently - so the separator is
 * optional and the case is ignored.
 */
const RELEASE = /^#\s+update\s+v?([0-9][\w.-]*)\s*\|?\s*(.*)$/i;
const SECTION = /^##\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;

function parse(text: string): Release[] {
  const releases: Release[] = [];
  let release: Release | undefined;
  let section: Section | undefined;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === '---') continue;

    const head = RELEASE.exec(line);
    if (head) {
      release = { version: head[1]!, date: (head[2] ?? '').trim(), sections: [] };
      releases.push(release);
      section = undefined;
      continue;
    }
    if (!release) continue;

    const heading = SECTION.exec(line);
    if (heading) {
      section = { heading: heading[1]!.trim(), bullets: [] };
      release.sections.push(section);
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      if (!section) {
        // A changelog that goes straight to bullets still has entries worth
        // showing; they just belong to no named section.
        section = { heading: '', bullets: [] };
        release.sections.push(section);
      }
      const body = bullet[1]!;
      // `**Lead sentence.** the rest` - the lead is the point, the rest is why.
      const lead = /^\*\*(.+?)\*\*\s*(.*)$/.exec(body);
      section.bullets.push(lead
        ? { bold: lead[1]!.trim(), text: lead[2]!.trim() }
        : { text: body.replace(/\*\*/g, '') });
      continue;
    }

    // A continuation line under the last bullet.
    if (section?.bullets.length) {
      const last = section.bullets[section.bullets.length - 1]!;
      last.text = `${last.text} ${line.replace(/\*\*/g, '')}`.trim();
    }
  }

  return releases;
}

/**
 * Stand-in for a script that ships no changelog, and for the browser preview.
 *
 * Several releases rather than one, because the thing being designed is a
 * list: one entry tells you nothing about how a wall of them reads.
 */
const MOCK = `# UPDATE 1.2.80 | 25/08/2026

## New
- **Script Studio.** Every dirk script now shares one settings panel - one search, one save bar, one change history. Your per-script panels still open exactly as they did.
- **What's new, in the panel.** Each script gets a changelog tab showing every release, with the version this server is running marked.

## Fixes
- **Booleans that default to false no longer log as changes.** Saving anything at all recorded "debug: default to false" alongside whatever you actually edited, on every script.
- **Emptying a list no longer loses its shape.** A list whose columns come from its default rows had none left once cleared, so the row editor opened blank and could not be used to add one back.
- **Item pickers show real images.** The picker drew a parcel icon for every row while promising real ones underneath.

---

# UPDATE 1.2.79 | 19/08/2026

## Improvements
- **The item picker no longer stalls.** Every item in the inventory was mounted the moment it opened; only what is on screen is now drawn.
- **Coordinate fields have Goto and Set on the row.** They used to open a modal to do anything at all, including going to look at the place.

## Fixes
- **Callback timers no longer linger.** Every request scheduled a five-minute timeout that was never cancelled once the callback answered.

---

# UPDATE 1.2.78 | 17/07/2026

## Fixes - devix-inventory bridge
- **Usable items register through devix-core's UsableItem**, so the handler receives the exact slot and metadata of the item being used. (Reported by _i23.)
- **Item metadata writes by slot**, replacing a serial-based write that only worked for weapons.
`;

export function ChangelogPage({ resource }: { resource: string }) {
  return (
    <div className="ss-cl">
      <ChangelogBody resource={resource} heading />
    </div>
  );
}

/**
 * The changelog itself, without deciding where it sits.
 *
 * The same list is wanted in two places - its own tab in the rail, and a modal
 * opened from an announcement that says "read the changelog" - and they should
 * not be two implementations that drift.
 */
export function ChangelogBody({ resource, heading }: { resource: string; heading?: boolean }) {
  const t = useChrome();

  const script = useStudio((s) => s.scripts.find((entry) => entry.resource === resource));
  const [state, setState] = useState<{ text: string; version?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  /** what this server is actually running, for the "you are here" marker */
  const installedVersion = script?.version;

  // REMOTE first, the shipped file as the fallback.
  //
  // The question this page mostly answers is "should I update", and the file
  // inside the resource cannot answer it - it describes the build you already
  // have. It also cannot be read at all when a script forgot to put
  // CHANGELOG.md in `escrow_ignore`, which is invisible in development and
  // broken for every paying customer.
  const remote = useRemoteChangelog(resource);

  useEffect(() => {
    let live = true;
    setError(null);

    if (isEnvBrowser()) {
      setState({ text: MOCK, version: '1.2.80' });
      return () => { live = false; };
    }

    // Still loading the remote copy - say nothing yet rather than flashing the
    // local one and replacing it a moment later.
    if (remote.isLoading) return () => { live = false; };

    if (remote.data) {
      setState({ text: remote.data, version: installedVersion });
      return () => { live = false; };
    }

    fetchNui<{ ok?: boolean; text?: string; version?: string; _error?: string }>(
      'GET_CHANGELOG',
      { resource },
      { ok: true, text: MOCK, version: '1.2.80' },
    )
      .then((reply) => {
        if (!live) return;
        if (reply?.ok && reply.text) setState({ text: reply.text, version: reply.version });
        else setError(reply?._error ?? 'NoChangelog');
      })
      .catch(() => { if (live) setError('CallbackFailed'); });

    return () => { live = false; };
  }, [resource, remote.isLoading, remote.data, installedVersion]);

  const releases = useMemo(() => (state ? parse(state.text) : []), [state]);

  // Search the whole file, then keep a release only if something in it matched.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return releases;
    return releases
      .map((release) => ({
        ...release,
        sections: release.sections
          .map((section) => ({
            ...section,
            bullets: section.bullets.filter((b) => (
              `${b.bold ?? ''} ${b.text}`.toLowerCase().includes(needle)
            )),
          }))
          .filter((section) => section.bullets.length > 0),
      }))
      .filter((release) => release.sections.length > 0 || release.version.includes(needle));
  }, [releases, query]);

  const installed = script?.version;
  const sub = t('changelog.subtitle', 'Every release of this script, newest first.')
    + (installed ? ` ${t('changelog.running', 'You are running')} v${installed}.` : '');

  return (
    <>
      <div className="ss-clh">
        {heading
          ? <SectionHeading icon="scroll-text" label={t('changelog.title', "What's new")} description={sub} style={{ margin: 0, minWidth: 0, flex: 1 }} />
          : <span className="D sub">{sub}</span>}
        <Search value={query} onChange={setQuery} placeholder={t('changelog.search', 'Search the changelog…')} />
      </div>

      {error && (
        <Empty text={error === 'NoChangelog'
          ? t('changelog.none', 'This script does not ship a changelog.')
          : t('changelog.failed', 'The changelog could not be read.')} />
      )}
      {!state && !error && <Empty text={t('changelog.loading', 'Reading…')} />}

      <div className="ss-cll studio-scroll">
        {shown.map((release, index) => {
          // The version on this server, called out - the point of reading a
          // changelog in the panel rather than on the store page.
          const current = !!installed && release.version === installed;
          // Newer than the build on this server. Only visible at all because
          // the list comes from the repo rather than from the resource - a
          // shipped changelog cannot contain a release that came after it.
          const ahead = !!installed && !current
            && compareVersions(release.version, installed) > 0;
          return (
            <div
              key={`${release.version}-${index}`}
              className={'ss-clr in' + (current ? ' cur' : '')}
              style={{ '--i': Math.min(index, 8) } as CSSProperties}
            >
              <div className="hd">
                <span className="pl ver"><span className="sk V">v{release.version}</span></span>
                {release.date && <span className="dt">{release.date}</span>}
                {ahead && <Chip tone="w">{t('changelog.notInstalled', 'Not installed')}</Chip>}
                {current && <Chip tone="a">{t('changelog.installed', 'Installed')}</Chip>}
              </div>

              {release.sections.map((section, si) => (
                <div key={`${section.heading}-${si}`} className="sec">
                  {section.heading && <div className="L">{section.heading}</div>}
                  {section.bullets.map((bullet, bi) => (
                    <div key={bi} className="bl">
                      <i />
                      <span className="D">
                        {bullet.bold && <b>{bullet.bold}{/^[,.;:)]/.test(bullet.text) ? '' : ' '}</b>}
                        {bullet.text}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}

        {state && shown.length === 0 && <Empty text={t('changelog.noMatch', 'Nothing in the changelog matches that.')} />}
      </div>
    </>
  );
}

/**
 * The same changelog, over whatever you were looking at.
 *
 * An announcement that says "read the changelog" should not take you out of
 * the page you are on to answer a question you asked in passing.
 */
export function ChangelogModal({ resource, onClose }: { resource: string; onClose: () => void }) {
  const t = useChrome();
  return (
    <Modal
      title={t('changelog.title', "What's new")}
      icon={ScrollText}
      description={resource}
      onClose={onClose}
      width="86vh"
      height="64vh"
      zIndex={10100}
    >
      <div className="ss-cl in-modal">
        <ChangelogBody resource={resource} />
      </div>
    </Modal>
  );
}
