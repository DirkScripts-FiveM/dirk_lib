import { copyToClipboard, fetchNui, isEnvBrowser } from 'dirk-cfx-react';
import { AnimatePresence } from 'framer-motion';
import { Check, Clock, Copy, ExternalLink, LifeBuoy, Link as LinkIcon, RefreshCw, Send, Unlink } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { KitIcon, Segs } from '../Kit';
import { ConfirmModal } from './Dialog';
import { Btn, Chip } from './studioKit';
import { useChrome } from './studioLocale';
import { notify } from './Toasts';

/**
 * The linked account, top right of the Studio (Liam's 25/10 mock): this
 * server, linked to a DirkScripts account. The chip says who it's linked to
 * (their picture and name from dirkscripts.com); clicking it opens the details.
 *
 * The only place a server gets linked. Everything here is a request to
 * dirk_lib's server (src/linkedAccount/server.lua), which checks the viewer may
 * edit dirk_lib's settings every time and never sends the key or the poll
 * secret here - the panel shows a code for a human to approve on the website,
 * and what the server says about the link afterwards. Nothing else. Anyone who
 * may not see it gets no chip at all.
 */

type LinkError = 'expired' | 'revoked' | 'unreachable' | 'refused' | 'unlinkedLocally';

export type LinkStatus = {
  linked: boolean;
  account?: string;
  /** the account's picture on dirkscripts.com */
  avatar?: string;
  /** how many dirk scripts this server runs */
  scripts?: number;
  /** the site it is linked to */
  site?: string;
  serverName?: string;
  /** unix seconds */
  linkedAt?: number;
  linkedBy?: string;
  checkin?: { at: number; ok: boolean; support: boolean };
  bundle?: { at: number; ok: boolean; summary?: string; ticket?: number };
  pending?: { code: string; verifyUrl: string; expiresIn: number };
  error?: LinkError;
};

type Reply<T = LinkStatus> = { success: boolean; data?: T; _error?: string };

/** One of the linked account's open tickets, as the send picker lists it. */
type OpenTicket = {
  id: string;
  number?: number;
  subject: string;
  updatedAt?: string;
  script?: { name?: string; resource?: string };
};
type TicketsAnswer = { tickets?: OpenTicket[] | Record<string, never>; newTicketUrl?: string; error?: string };
type SendAnswer = { ok: boolean; summary?: string; ticket?: number; dropped?: number; error?: string; message?: string };

type Event = 'LINK_STATUS' | 'LINK_START' | 'LINK_CANCEL' | 'LINK_UNLINK' | 'LINK_TICKETS' | 'LINK_SEND';

const SITE = 'https://www.dirkscripts.com';

/** Enough to design against in a browser; obviously not a real server. */
let preview: LinkStatus = { linked: false, serverName: 'Browser preview' };
const previewTickets: OpenTicket[] = [
  { id: 'preview-1', number: 1042, subject: 'Crab pots vanish after a restart', updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), script: { name: 'Fishing Sim V2', resource: 'dirk_fishing' } },
  { id: 'preview-2', number: 1051, subject: 'Character select camera clips into the wall', updatedAt: new Date(Date.now() - 26 * 3600_000).toISOString(), script: { name: 'Multicharacter', resource: 'dirk_multichar' } },
];
function previewCall(event: Event): Reply<unknown> {
  const now = Math.floor(Date.now() / 1000);
  if (event === 'LINK_START') {
    preview = { linked: false, serverName: preview.serverName, pending: { code: 'DEV-000', verifyUrl: `${SITE}/link?code=DEV-000`, expiresIn: 600 } };
  } else if (event === 'LINK_CANCEL' || event === 'LINK_UNLINK') {
    preview = { linked: false, serverName: preview.serverName };
  } else if (event === 'LINK_STATUS' && preview.pending) {
    // approve itself on the next look so the linked state can be designed too
    preview = { linked: true, account: 'DirkScriptz', avatar: 'https://forum.cfx.re/user_avatar/forum.cfx.re/dirkscriptz/144/5563332_2.png', scripts: 12, site: SITE, serverName: preview.serverName, linkedAt: now, linkedBy: 'You', checkin: { at: now, ok: true, support: false } };
  } else if (event === 'LINK_TICKETS') {
    return { success: true, data: { tickets: previewTickets, newTicketUrl: `${SITE}/tickets?new=true` } };
  } else if (event === 'LINK_SEND') {
    const summary = '1 error, 2 warnings · dirk_lib 1.3.6 (out of date) · qbx_core · 1 script out of date';
    preview = { ...preview, bundle: { at: now, ok: true, summary, ticket: 1042 } };
    return { success: true, data: { ok: true, summary, ticket: 1042, dropped: 0 } };
  }
  return { success: true, data: preview };
}

async function call<T = LinkStatus>(event: Event, data: Record<string, unknown> = {}): Promise<Reply<T>> {
  if (isEnvBrowser()) {
    // a beat of latency, so the loading states can be looked at too
    if (event === 'LINK_TICKETS' || event === 'LINK_SEND') await new Promise((r) => setTimeout(r, 600));
    return previewCall(event) as Reply<T>;
  }
  const reply = await fetchNui<Reply<T>>(event, data);
  return reply ?? { success: false, _error: 'NoAnswer' };
}

const openUrl = (url: string) => {
  const native = (window as unknown as { invokeNative?: (name: string, arg: string) => void }).invokeNative;
  if (native) native('openUrl', url);
  else window.open(url, '_blank');
};

type T = ReturnType<typeof useChrome>;

function ago(seconds: number | undefined, t: T): string {
  if (!seconds) return t('account.never', 'not yet');
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (diff < 60) return t('account.just_now', 'just now');
  if (diff < 3600) return t('account.min_ago', '{0} min ago').replace('{0}', String(Math.floor(diff / 60)));
  if (diff < 86400) return t('account.hours_ago', '{0} h ago').replace('{0}', String(Math.floor(diff / 3600)));
  return day(seconds);
}

const day = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * The link's status, asked of the server while the panel is open: every few
 * seconds while a code waits to be approved, otherwise now and then, so a
 * check-in (or an unlink from the website) shows without reopening.
 */
function useLinkStatus(live: boolean) {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [denied, setDenied] = useState(false);
  // the code's expiry, counted down here between polls
  const [deadline, setDeadline] = useState<number | null>(null);

  const apply = useCallback((reply: Reply) => {
    if (reply.success && reply.data) {
      setStatus(reply.data);
      setDenied(false);
      setDeadline(reply.data.pending ? Date.now() + reply.data.pending.expiresIn * 1000 : null);
    } else if (reply._error === 'NotAuthorized') {
      setDenied(true);
    }
  }, []);

  const refresh = useCallback(() => { call('LINK_STATUS').then(apply).catch(() => {}); }, [apply]);

  const waiting = !!status?.pending;
  useEffect(() => {
    if (!live) return undefined;
    refresh();
    const id = setInterval(refresh, waiting ? 3000 : 20000);
    return () => clearInterval(id);
  }, [live, refresh, waiting]);

  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadline || !live) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [deadline, live]);

  const secondsLeft = deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : 0;
  return { status, denied, apply, refresh, secondsLeft };
}

/** The account's picture, slanted with the plate; initials when there is none (or it fails to load). */
function Avatar({ src, name, big, kind }: { src?: string; name?: string; big?: boolean; kind: 'linked' | 'wait' | 'none' }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const cls = 'ss-av' + (big ? ' big' : '') + (kind === 'wait' ? ' wt' : kind === 'none' ? ' lk' : '');
  if (kind === 'wait') return <span className={cls}><Clock /></span>;
  if (kind === 'none') return <span className={cls}><LinkIcon /></span>;
  const initials = (name || '?').replace(/[^0-9A-Za-z]/g, '').slice(0, 2).toUpperCase() || '?';
  return (
    <span className={cls + (src && !broken ? ' pic' : '')}>
      {src && !broken
        ? <img src={src} alt="" onError={() => setBroken(true)} />
        : <span className="ini">{initials}</span>}
    </span>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="r"><span className="L">{label}</span><span className="v">{children}</span></div>
);

export function AccountChip({ live, open, onOpen }: {
  /** the panel is open: only then is the server asked */
  live: boolean;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const t = useChrome();
  const { status, denied, apply, refresh, secondsLeft } = useLinkStatus(live);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // a click anywhere else closes it (the unlink dialog is its own layer)
  useEffect(() => {
    if (!open || confirmUnlink) return undefined;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, confirmUnlink, onOpen]);

  useEffect(() => { if (!open) setSending(false); }, [open]);
  // closing the panel closes this too
  useEffect(() => { if (!live && open) onOpen(false); }, [live, open, onOpen]);

  if (denied || !status) return null;

  const act = (event: 'LINK_START' | 'LINK_CANCEL' | 'LINK_UNLINK') => {
    setBusy(event);
    call(event)
      .then((reply) => {
        apply(reply);
        if (event === 'LINK_UNLINK' && reply.success) notify('success', t('account.unlinked', 'Unlinked'));
        if (!reply.success && reply._error !== 'NotAuthorized') notify('error', t('account.no_answer', 'The server did not answer. Try again.'));
      })
      .catch(() => notify('error', t('account.no_answer', 'The server did not answer. Try again.')))
      .finally(() => setBusy(null));
  };

  const state: 'linked' | 'wait' | 'none' = status.linked ? 'linked' : status.pending ? 'wait' : 'none';
  const offline = state === 'linked' && status.checkin && !status.checkin.ok;
  const site = status.site || SITE;

  const errorLine: Record<LinkError, string> = {
    expired: t('account.err_expired', 'The last code ran out before it was approved. Start again whenever you are ready.'),
    revoked: t('account.err_revoked', 'This server was unlinked on the website, so it no longer checks in.'),
    unreachable: t('account.err_unreachable', 'Could not reach dirkscripts.com from this server. Check it has internet access and try again.'),
    refused: t('account.err_refused', 'dirkscripts.com refused the request. Try again in a minute.'),
    unlinkedLocally: t('account.err_unlinked_locally', 'Unlinked here, but dirkscripts.com could not be reached to revoke the key. Remove the server under Account → Linked servers on the website too.'),
  };

  const chip = state === 'linked' ? (
    <>
      <Avatar kind="linked" src={status.avatar} name={status.account} />
      <div className="tx">
        <div className="nm">{status.account || t('account.your_account', 'Your account')}</div>
        <div className="st2"><i />{offline ? t('account.offline', 'Linked · can\'t reach the site') : `${t('account.linked', 'Linked')} · ${status.serverName ?? ''}`}</div>
      </div>
    </>
  ) : state === 'wait' ? (
    <>
      <Avatar kind="wait" />
      <div className="tx">
        <div className="nm">{t('account.enter_code', 'Enter the code')}</div>
        <div className="st2"><i />{t('account.waiting_left', 'Waiting · {0} left').replace('{0}', mmss(secondsLeft))}</div>
      </div>
    </>
  ) : (
    <>
      <Avatar kind="none" />
      <div className="tx">
        <div className="nm">{t('account.link_account', 'Link account')}</div>
        <div className="st2"><i />{t('account.not_linked', 'Not linked')}</div>
      </div>
    </>
  );

  const code = status.pending?.code ?? '';

  return (
    <div className="ss-acctW" ref={ref}>
      <div
        className={`pl ss-acct ${state}${offline ? ' off' : ''}${open ? ' open' : ''} in`}
        style={{ '--i': 2 } as CSSProperties}
        onClick={() => onOpen(!open)}
      >
        <div className="sk">{chip}<KitIcon name="down" /></div>
      </div>

      {open && (
        <div className="ss-amenu">
          {state === 'linked' && (
            <>
              <div className="pl ss-amh edge wash in" style={{ '--i': 0 } as CSSProperties}>
                <div className="sk">
                  <Avatar kind="linked" big src={status.avatar} name={status.account} />
                  <div className="tx">
                    <div className="T">{status.account || t('account.your_account', 'Your account')}</div>
                    <div className="L">{t('account.dirkscripts_account', 'DirkScripts account')}</div>
                  </div>
                  <Chip tone="g">{t('account.linked', 'Linked')}</Chip>
                </div>
              </div>
              <div className="pl ss-akv in" style={{ '--i': 1 } as CSSProperties}>
                <div className="sk">
                  <Row label={t('account.server', 'Server')}>{status.serverName || '—'}</Row>
                  <Row label={t('account.since', 'Linked since')}>
                    {status.linkedAt ? day(status.linkedAt) : '—'}
                    {status.linkedBy && <small>{` · ${t('account.by', 'by')} ${status.linkedBy}`}</small>}
                  </Row>
                  <Row label={t('account.last_checkin', 'Last check-in')}>
                    {status.checkin ? ago(status.checkin.at, t) : t('account.checkin_soon', 'within a minute')}
                    {status.checkin && (status.checkin.ok
                      ? <Chip tone="g">{t('account.ok', 'OK')}</Chip>
                      : <Chip tone="r">{t('account.unreachable', 'Unreachable')}</Chip>)}
                  </Row>
                  {status.scripts != null && (
                    <Row label={t('account.scripts_here', 'DirkScripts here')}>{String(status.scripts)}</Row>
                  )}
                </div>
              </div>
              {sending ? (
                <SendBundle onDone={() => { setSending(false); refresh(); }} onCancel={() => setSending(false)} onRevoked={refresh} />
              ) : (
                <div className="pl ss-akv in" style={{ '--i': 2 } as CSSProperties}>
                  <div className="sk">
                    <div className="hd">
                      <LifeBuoy className="ico" />
                      <span className="L">{t('account.support_title', 'Support bundles')}</span>
                      {status.checkin?.support ? <Chip tone="g">{t('account.on', 'On')}</Chip> : <Chip>{t('account.off', 'Off')}</Chip>}
                    </div>
                    <div className="D">
                      {status.checkin?.support
                        ? t('account.support_on', 'When a ticket asks for one, this server sends a bundle (versions, bridges, problems found and recent console, with IPs, keys and tokens removed) within about a minute.')
                        : t('account.support_off', 'Support can\'t fetch one on their own. Switch it on under Account → Linked servers on dirkscripts.com, or send one yourself.')}
                    </div>
                    {status.bundle && (
                      <div className="D dim">
                        {`${t('account.last_bundle', 'Last bundle')}: ${ago(status.bundle.at, t)}${status.bundle.ticket ? ` · #${status.bundle.ticket}` : ''}${status.bundle.ok ? (status.bundle.summary ? ` · ${status.bundle.summary}` : '') : ` · ${t('account.not_delivered', 'not delivered')}`}`}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!sending && (
                <div className="ss-abtns in" style={{ '--i': 3 } as CSSProperties}>
                  <Btn icon={<Send />} label={t('account.send', 'Send a bundle')} onClick={() => setSending(true)} />
                  <Btn icon={<ExternalLink />} label="dirkscripts.com" onClick={() => openUrl(`${site}/account`)} />
                  <Btn icon={<Unlink />} tone="no" label={t('account.unlink', 'Unlink')} disabled={!!busy} onClick={() => setConfirmUnlink(true)} />
                </div>
              )}
            </>
          )}

          {state === 'wait' && status.pending && (
            <>
              <div className="pl ss-amh edge in" style={{ '--i': 0, '--e': 'var(--warn)' } as CSSProperties}>
                <div className="sk">
                  <Avatar kind="wait" big />
                  <div className="tx">
                    <div className="T">{t('account.almost', 'Almost there')}</div>
                    <div className="L">{t('account.approve_on_site', 'Approve it on dirkscripts.com')}</div>
                  </div>
                  <Chip tone="w">{t('account.waiting', 'Waiting')}</Chip>
                </div>
              </div>
              <div className="pl ss-akv in" style={{ '--i': 1 } as CSSProperties}>
                <div className="sk">
                  <div className="D">{t('account.step', 'Open the link while signed in to dirkscripts.com and approve the server. On another device, type this code at dirkscripts.com/link. This links by itself the moment you do.')}</div>
                  <div className="code">
                    {code.split('').map((c, i) => (c === '-' ? <i key={i} /> : <b key={i}><span>{c}</span></b>))}
                  </div>
                  <Segs n={20} frac={secondsLeft / 600} />
                  <div className="L ctr">{t('account.runs_out', 'Code runs out in {0}').replace('{0}', mmss(secondsLeft))}</div>
                </div>
              </div>
              <div className="ss-abtns in" style={{ '--i': 2 } as CSSProperties}>
                <Btn
                  icon={<Copy />}
                  label={t('account.copy_link', 'Copy link')}
                  onClick={() => { copyToClipboard(status.pending!.verifyUrl); notify('success', t('account.copied', 'Copied')); }}
                />
                <Btn icon={<ExternalLink />} tone="go" label={t('account.open_browser', 'Open in browser')} onClick={() => openUrl(status.pending!.verifyUrl)} />
                <Btn tone="no" label={t('account.cancel', 'Cancel')} disabled={!!busy} onClick={() => act('LINK_CANCEL')} />
              </div>
            </>
          )}

          {state === 'none' && (
            <>
              <div className="pl ss-amh edge in" style={{ '--i': 0, '--e': 'rgba(255,255,255,.35)' } as CSSProperties}>
                <div className="sk">
                  <Avatar kind="none" big />
                  <div className="tx">
                    <div className="T">{t('account.not_linked', 'Not linked')}</div>
                    <div className="L">{t('account.link_this', 'Link this server to DirkScripts')}</div>
                  </div>
                </div>
              </div>
              <div className="pl ss-akv in" style={{ '--i': 1 } as CSSProperties}>
                <div className="sk">
                  <div className="D">{t('account.what', 'Linking shows your picture and name up here, lists this server and its DirkScripts on your account so you hear about updates, and lets you send a support bundle to one of your tickets. Support can fetch one only if you switch that on for this server on the website.')}</div>
                  <div className="D dim">{t('account.who', 'Nothing about your players is sent. Only admins who can edit dirk_lib see this.')}</div>
                  {status.error && <div className="D warn">{errorLine[status.error] ?? status.error}</div>}
                </div>
              </div>
              <div className="ss-abtns in" style={{ '--i': 2 } as CSSProperties}>
                <Btn
                  icon={<LinkIcon />}
                  tone="go"
                  label={busy === 'LINK_START' ? t('account.starting', 'Asking for a code…') : t('account.link', 'Link to DirkScripts')}
                  disabled={!!busy}
                  onClick={() => act('LINK_START')}
                />
              </div>
            </>
          )}
        </div>
      )}

      <AnimatePresence>
        {confirmUnlink && (
          <ConfirmModal
            title={t('account.unlink_title', 'Unlink this server')}
            description={t('account.unlink_body', 'The server forgets its key and dirkscripts.com revokes it. It stops checking in and support can no longer fetch bundles from it. You can link it again any time.')}
            confirmLabel={t('account.unlink', 'Unlink')}
            onConfirm={() => { setConfirmUnlink(false); act('LINK_UNLINK'); }}
            onClose={() => setConfirmUnlink(false)}
            zIndex={10200}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

type SendError =
  | 'denied' | 'notLinked' | 'revoked' | 'unreachable' | 'refused' | 'notFound'
  | 'closed' | 'tooLarge' | 'tooSoon' | 'busy' | 'failed';

/**
 * "Send a bundle": pick one of the account's open tickets and this server
 * sends its bundle there. Works with the support switch off - the owner
 * choosing to send one is the point. The server only sends to a ticket it has
 * just listed, and the site checks the ticket is this account's and still open.
 */
function SendBundle({ onDone, onCancel, onRevoked }: { onDone: () => void; onCancel: () => void; onRevoked: () => void }) {
  const t = useChrome();
  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState<OpenTicket[] | null>(null);
  const [newTicketUrl, setNewTicketUrl] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    call<TicketsAnswer>('LINK_TICKETS')
      .then((reply) => {
        if (!reply.success || !reply.data) return setError(reply._error === 'NotAuthorized' ? 'denied' : 'failed');
        if (reply.data.error) return setError(reply.data.error as SendError);
        // Lua sends an empty list as {}
        const list = Array.isArray(reply.data.tickets) ? reply.data.tickets : [];
        setTickets(list);
        setNewTicketUrl(reply.data.newTicketUrl ?? null);
        setPicked((p) => (p && list.some((x) => x.id === p) ? p : list[0]?.id ?? null));
        return undefined;
      })
      .catch(() => setError('failed'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = () => {
    if (!picked) return;
    setSending(true);
    setError(null);
    call<SendAnswer>('LINK_SEND', { ticketId: picked })
      .then((reply) => {
        const answer = reply.data;
        if (!reply.success || !answer) return setError(reply._error === 'NotAuthorized' ? 'denied' : 'failed');
        if (!answer.ok) {
          setError((answer.error as SendError) ?? 'failed');
          if (answer.error === 'revoked') onRevoked();
          if (answer.error === 'notFound' || answer.error === 'closed') load();
          return undefined;
        }
        notify('success', `${t('account.sent', 'Support bundle sent')}${answer.ticket ? ` · #${answer.ticket}` : ''}`);
        onDone();
        return undefined;
      })
      .catch(() => setError('failed'))
      .finally(() => setSending(false));
  };

  const errorLine: Record<SendError, string> = {
    denied: t('account.send_denied', 'Only admins who can edit dirk_lib\'s own settings can send a bundle.'),
    notLinked: t('account.send_not_linked', 'This server isn\'t linked any more.'),
    revoked: t('account.err_revoked', 'This server was unlinked on the website, so it no longer checks in.'),
    unreachable: t('account.err_unreachable', 'Could not reach dirkscripts.com from this server. Check it has internet access and try again.'),
    refused: t('account.err_refused', 'dirkscripts.com refused the request. Try again in a minute.'),
    notFound: t('account.send_not_found', 'That ticket isn\'t open on your account any more. Pick another.'),
    closed: t('account.send_closed', 'That ticket is resolved or closed. Open a new one on dirkscripts.com and send it there.'),
    tooLarge: t('account.send_too_large', 'The bundle came out too large to send.'),
    tooSoon: t('account.send_too_soon', 'This server sent that ticket a bundle under a minute ago. Give it a minute.'),
    busy: t('account.send_busy', 'A bundle is already on its way.'),
    failed: t('account.send_failed', 'Could not build the bundle. The server console says why.'),
  };

  const chosen = tickets?.find((x) => x.id === picked);
  const since = (iso?: string) => (iso ? ago(Math.floor(Date.parse(iso) / 1000), t) : '');

  return (
    <>
      <div className="pl ss-akv in" style={{ '--i': 2 } as CSSProperties}>
        <div className="sk">
          <div className="hd">
            <Send className="ico" />
            <span className="L">{t('account.pick_ticket', 'Which ticket is it for?')}</span>
            <span className={'ss-arf' + (loading || sending ? ' off' : '')} onClick={loading || sending ? undefined : load} title={t('account.refresh', 'Refresh')}>
              <RefreshCw className={loading ? 'spin' : undefined} />
            </span>
          </div>
          {loading && !tickets ? (
            <div className="D dim">{t('account.loading_tickets', 'Asking dirkscripts.com for your open tickets…')}</div>
          ) : tickets && tickets.length === 0 ? (
            <div className="D">{t('account.no_tickets', 'You have no open tickets. Open one on dirkscripts.com, then send the bundle to it.')}</div>
          ) : tickets ? (
            <div className="ss-atks studio-scroll">
              {tickets.map((ticket) => {
                const sub = [ticket.script?.name, ticket.updatedAt ? `${t('account.updated', 'updated')} ${since(ticket.updatedAt)}` : ''].filter(Boolean).join(' · ');
                return (
                  <div key={ticket.id} className={'ss-atk' + (ticket.id === picked ? ' on' : '')} onClick={() => !sending && setPicked(ticket.id)}>
                    <span className="rd">{ticket.id === picked && <Check />}</span>
                    {ticket.number !== undefined && <span className="no">{`#${ticket.number}`}</span>}
                    <span className="tx">
                      <span className="t">{ticket.subject || t('account.no_subject', 'No subject')}</span>
                      {sub && <span className="s">{sub}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {error && <div className="D warn">{errorLine[error] ?? error}</div>}
        </div>
      </div>
      <div className="ss-abtns in" style={{ '--i': 3 } as CSSProperties}>
        <Btn label={t('account.cancel', 'Cancel')} disabled={sending} onClick={onCancel} />
        {tickets && tickets.length === 0 && newTicketUrl && (
          <Btn icon={<ExternalLink />} tone="go" label={t('account.open_ticket', 'Open a ticket')} onClick={() => openUrl(newTicketUrl)} />
        )}
        {!!tickets?.length && (
          <Btn
            icon={<Send />}
            tone="go"
            label={sending
              ? t('account.sending', 'Sending…')
              : t('account.send_to', 'Send to {0}').replace('{0}', chosen?.number !== undefined ? `#${chosen.number}` : t('account.this_ticket', 'this ticket'))}
            disabled={!picked || sending || loading}
            onClick={send}
          />
        )}
      </div>
    </>
  );
}
