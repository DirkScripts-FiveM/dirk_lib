import { alpha, Flex, Loader, Text, useMantineTheme } from '@mantine/core';
import { ConfirmModal, copyToClipboard, fetchNui, isEnvBrowser } from 'dirk-cfx-react';
import { AnimatePresence } from 'framer-motion';
import {
  Check, CircleAlert, Clock, Copy, ExternalLink, LifeBuoy, Link as LinkIcon, Lock, RefreshCw, Send, Server, Ticket, Unlink, User,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useChrome } from './studioLocale';
import { notify } from './Toasts';
import { Chip, StudioButton } from './ui';

/**
 * Linked account: this server, linked to a DirkScripts account.
 *
 * The only place a server gets linked. Everything on this page is a request to
 * dirk_lib's server (src/linkedAccount/server.lua), which checks the viewer may
 * edit dirk_lib's settings every time and never sends the key or the poll
 * secret here - the page shows a code for a human to approve on the website,
 * and what the server says about the link afterwards. Nothing else.
 */

type LinkError = 'expired' | 'revoked' | 'unreachable' | 'refused' | 'unlinkedLocally';

export type LinkStatus = {
  linked: boolean;
  account?: string;
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
export type OpenTicket = {
  id: string;
  number?: number;
  subject: string;
  updatedAt?: string;
  script?: { name?: string; resource?: string };
};
type TicketsAnswer = { tickets?: OpenTicket[] | Record<string, never>; newTicketUrl?: string; error?: string };
type SendAnswer = { ok: boolean; summary?: string; ticket?: number; dropped?: number; error?: string; message?: string };

type Event = 'LINK_STATUS' | 'LINK_START' | 'LINK_CANCEL' | 'LINK_UNLINK';

/** Enough to design against in a browser; obviously not a real server. */
let preview: LinkStatus = { linked: false, serverName: 'Browser preview' };
const previewTickets: OpenTicket[] = [
  { id: 'preview-1', number: 1042, subject: 'Crab pots vanish after a restart', updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), script: { name: 'Fishing Sim V2', resource: 'dirk_fishing' } },
  { id: 'preview-2', number: 1051, subject: 'Character select camera clips into the wall', updatedAt: new Date(Date.now() - 26 * 3600_000).toISOString(), script: { name: 'Multicharacter', resource: 'dirk_multichar' } },
];
function previewCall(event: string): Reply<unknown> {
  const now = Math.floor(Date.now() / 1000);
  if (event === 'LINK_START') {
    preview = { linked: false, serverName: preview.serverName, pending: { code: 'DEV-000', verifyUrl: 'https://www.dirkscripts.com/link?code=DEV-000', expiresIn: 600 } };
  } else if (event === 'LINK_CANCEL') {
    preview = { linked: false, serverName: preview.serverName };
  } else if (event === 'LINK_UNLINK') {
    preview = { linked: false, serverName: preview.serverName };
  } else if (event === 'LINK_STATUS' && preview.pending) {
    // approve itself after a few seconds so the linked screen can be looked at too
    preview = { linked: true, account: 'DirkScriptz', serverName: preview.serverName, linkedAt: now, linkedBy: 'You', checkin: { at: now, ok: true, support: false } };
  } else if (event === 'LINK_TICKETS') {
    return { success: true, data: { tickets: previewTickets, newTicketUrl: 'https://www.dirkscripts.com/tickets?new=true' } };
  } else if (event === 'LINK_SEND') {
    const summary = '1 error, 2 warnings · dirk_lib 1.3.6 (out of date) · qbx_core · 1 script out of date';
    preview = { ...preview, bundle: { at: now, ok: true, summary, ticket: 1042 } };
    return { success: true, data: { ok: true, summary, ticket: 1042, dropped: 0 } };
  }
  return { success: true, data: preview };
}

async function call<T = LinkStatus>(event: Event | 'LINK_TICKETS' | 'LINK_SEND', data: Record<string, unknown> = {}): Promise<Reply<T>> {
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

function ago(seconds: number | undefined, t: ReturnType<typeof useChrome>): string {
  if (!seconds) return t('linkPage.never', 'not yet');
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (diff < 60) return t('linkPage.justNow', 'just now');
  if (diff < 3600) return `${Math.floor(diff / 60)} ${t('linkPage.minAgo', 'min ago')}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ${t('linkPage.hoursAgo', 'h ago')}`;
  return new Date(seconds * 1000).toLocaleDateString();
}

export function LinkedAccountPage() {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];

  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  // the code's expiry, counted down locally between polls
  const [deadline, setDeadline] = useState<number | null>(null);
  const [, tick] = useState(0);

  const apply = useCallback((reply: Reply) => {
    if (reply.success && reply.data) {
      setStatus(reply.data);
      setDenied(false);
      setFailed(false);
      setDeadline(reply.data.pending ? Date.now() + reply.data.pending.expiresIn * 1000 : null);
    } else if (reply._error === 'NotAuthorized') {
      setDenied(true);
    } else {
      setFailed(true);
    }
  }, []);

  const refresh = useCallback(() => {
    call('LINK_STATUS').then(apply).catch(() => setFailed(true));
  }, [apply]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll quickly while a code is waiting to be approved; slowly otherwise, so a
  // check-in (or an unlink from the website) shows without reopening the page.
  const waiting = !!status?.pending;
  useEffect(() => {
    const id = setInterval(refresh, waiting ? 3000 : 20000);
    return () => clearInterval(id);
  }, [refresh, waiting]);

  useEffect(() => {
    if (!deadline) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const act = (event: 'LINK_START' | 'LINK_CANCEL' | 'LINK_UNLINK') => {
    setBusy(event);
    call(event)
      .then((reply) => {
        apply(reply);
        if (event === 'LINK_UNLINK' && reply.success) notify('success', t('linkPage.unlinked', 'Unlinked'));
      })
      .catch(() => setFailed(true))
      .finally(() => setBusy(null));
  };

  const secondsLeft = deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : 0;

  const errorLine: Record<LinkError, string> = {
    expired: t('linkPage.err_expired', 'The last code expired before it was approved. Start again whenever you are ready.'),
    revoked: t('linkPage.err_revoked', 'This server was unlinked from the website, so it no longer checks in.'),
    unreachable: t('linkPage.err_unreachable', 'Could not reach dirkscripts.com from this server. Check it has internet access and try again.'),
    refused: t('linkPage.err_refused', 'dirkscripts.com refused the request. Try again in a minute.'),
    unlinkedLocally: t('linkPage.err_unlinkedLocally', 'Unlinked here, but dirkscripts.com could not be reached to revoke the key. Remove the server from Account → Linked servers on the website too.'),
  };

  return (
    <Flex direction="column" gap="lg" p="md" className="studio-scroll" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <Block
        icon={LinkIcon}
        title={t('linkPage.title', 'DirkScripts account')}
        description={t('linkPage.subtitle', 'Link this server to your account on dirkscripts.com. Optional, and you can unlink any time.')}
        action={status?.linked
          ? <Chip label={t('linkPage.linked', 'Linked')} color="#22c55e" dot size="control" />
          : status?.pending
            ? <Chip label={t('linkPage.waiting', 'Waiting for approval')} color={color} dot size="control" />
            : status ? <Chip label={t('linkPage.notLinked', 'Not linked')} color="rgba(255,255,255,0.45)" size="control" /> : null}
      >
        {denied ? (
          <Notice icon={Lock} tone="rgba(255,255,255,0.55)">
            {t('linkPage.denied', 'Only admins who can edit dirk_lib\'s own settings can see or change the linked account.')}
          </Notice>
        ) : !status && !failed ? (
          <Flex align="center" gap="xs"><Loader size="xs" color={color} /><Muted>{t('linkPage.loading', 'Asking the server…')}</Muted></Flex>
        ) : failed && !status ? (
          <Notice icon={CircleAlert} tone="#f59e0b">{t('linkPage.noAnswer', 'The server did not answer. Close and reopen /dirk_config to try again.')}</Notice>
        ) : status?.linked ? (
          <Card>
            <Flex direction="column" gap="xs">
              <Row icon={User} label={t('linkPage.account', 'Account')} value={status.account || t('linkPage.unknownAccount', 'Your DirkScripts account')} />
              <Row icon={Server} label={t('linkPage.server', 'Server')} value={status.serverName || '—'} />
              <Row
                icon={Clock}
                label={t('linkPage.since', 'Linked since')}
                value={`${status.linkedAt ? new Date(status.linkedAt * 1000).toLocaleString() : '—'}${status.linkedBy ? ` · ${t('linkPage.by', 'by')} ${status.linkedBy}` : ''}`}
              />
              <Row
                icon={Check}
                label={t('linkPage.lastCheckin', 'Last check-in')}
                value={status.checkin
                  ? `${ago(status.checkin.at, t)}${status.checkin.ok ? '' : ` · ${t('linkPage.checkinFailed', 'could not reach dirkscripts.com')}`}`
                  : t('linkPage.checkinSoon', 'within a minute')}
              />
            </Flex>
            <Flex justify="flex-end" mt="sm">
              <StudioButton
                label={t('linkPage.unlink', 'Unlink')}
                icon={Unlink}
                danger
                disabled={!!busy}
                onClick={() => setConfirmUnlink(true)}
              />
            </Flex>
          </Card>
        ) : status?.pending ? (
          <Card>
            <Flex direction="column" gap="sm" align="flex-start">
              <Muted>{t('linkPage.step', 'Open this link while signed in to dirkscripts.com and approve the server. The code is only for typing in on another device.')}</Muted>
              <Flex align="center" gap="md">
                <Text ff="monospace" fw={700} c="rgba(255,255,255,0.95)" style={{ fontSize: '4.4vh', letterSpacing: '0.5vh', lineHeight: 1 }}>
                  {status.pending.code}
                </Text>
                <Flex direction="column" gap="0.3vh">
                  <Flex align="center" gap="xs"><Loader size="xs" color={color} /><Muted>{t('linkPage.waitingHint', 'Waiting for you to approve it…')}</Muted></Flex>
                  <Muted>{`${t('linkPage.expiresIn', 'Expires in')} ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}</Muted>
                </Flex>
              </Flex>
              <CopyUrl url={status.pending.verifyUrl} />
              <Flex gap="xs">
                <StudioButton label={t('linkPage.openBrowser', 'Open in browser')} icon={ExternalLink} primary onClick={() => openUrl(status.pending!.verifyUrl)} />
                <StudioButton label={t('linkPage.cancel', 'Cancel')} disabled={!!busy} onClick={() => act('LINK_CANCEL')} />
              </Flex>
            </Flex>
          </Card>
        ) : (
          <Card>
            <Flex direction="column" gap="sm" align="flex-start">
              <Muted>{t('linkPage.what', 'Linking lets you publish your designs to the DirkScripts shelf, and send a support bundle (versions, bridges, problems found and recent console, with IPs, keys and tokens removed) to one of your tickets from here. Our support can also fetch one for your tickets if you switch that on for this server on the website. Nothing is sent otherwise.')}</Muted>
              <StudioButton
                label={busy === 'LINK_START' ? t('linkPage.starting', 'Asking for a code…') : t('linkPage.link', 'Link to DirkScripts')}
                icon={LinkIcon}
                primary
                disabled={!!busy}
                onClick={() => act('LINK_START')}
              />
            </Flex>
          </Card>
        )}

        {!denied && status?.error && !status.pending && (
          <Notice icon={CircleAlert} tone="#f59e0b">{errorLine[status.error] ?? status.error}</Notice>
        )}
      </Block>

      {status?.linked && (
        <Block
          icon={LifeBuoy}
          title={t('linkPage.supportTitle', 'Support bundles')}
          description={t('linkPage.supportSubtitle', 'Switched on or off for this server in Account → Linked servers on dirkscripts.com')}
          action={<Chip
            label={status.checkin?.support ? t('linkPage.on', 'On') : t('linkPage.off', 'Off')}
            color={status.checkin?.support ? '#22c55e' : 'rgba(255,255,255,0.45)'}
            dot
            size="control"
          />}
        >
          <Card>
            <Flex direction="column" gap="xs">
              <Muted>{status.checkin?.support
                ? t('linkPage.supportOn', 'When a ticket asks for one, this server sends a bundle within about a minute. It shows on the ticket, so you can see exactly what was sent.')
                : t('linkPage.supportOff', 'Support can\'t fetch one on their own. Switch it on on the website if you want them to, or send one yourself below.')}
              </Muted>
              {status.bundle && (
                <Muted>{`${t('linkPage.lastBundle', 'Last bundle')}: ${ago(status.bundle.at, t)}${status.bundle.ticket ? ` · ${t('linkPage.ticket', 'ticket')} #${status.bundle.ticket}` : ''}${status.bundle.ok ? (status.bundle.summary ? ` · ${status.bundle.summary}` : '') : ` · ${t('linkPage.notDelivered', 'not delivered')}`}`}</Muted>
              )}
            </Flex>
          </Card>
          <SendBundle onSent={refresh} />
        </Block>
      )}

      <AnimatePresence>
        {confirmUnlink && (
          <ConfirmModal
            title={t('linkPage.unlinkTitle', 'Unlink this server')}
            description={t('linkPage.unlinkBody', 'The server forgets its key and dirkscripts.com revokes it. Support can no longer fetch bundles from it and it stops checking in. You can link it again any time.')}
            confirmLabel={t('linkPage.unlink', 'Unlink')}
            onConfirm={() => {
              setConfirmUnlink(false);
              act('LINK_UNLINK');
            }}
            onClose={() => setConfirmUnlink(false)}
            zIndex={10200}
          />
        )}
      </AnimatePresence>
    </Flex>
  );
}

type SendError =
  | 'denied' | 'notLinked' | 'revoked' | 'unreachable' | 'refused' | 'notFound'
  | 'closed' | 'tooLarge' | 'tooSoon' | 'busy' | 'failed';

/**
 * "Send a support bundle": pick one of the account's open tickets and this
 * server sends its bundle there. Works with the support switch off - the owner
 * choosing to send one is the point. The server only sends to a ticket it has
 * just listed, and the site checks the ticket is this account's and still open.
 */
function SendBundle({ onSent }: { onSent: () => void }) {
  const t = useChrome();
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState<OpenTicket[] | null>(null);
  const [newTicketUrl, setNewTicketUrl] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const [sent, setSent] = useState<{ ticket?: number; summary?: string } | null>(null);

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

  const start = () => {
    setOpen(true);
    setSent(null);
    load();
  };

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
          if (answer.error === 'revoked') onSent();
          if (answer.error === 'notFound' || answer.error === 'closed') load();
          return undefined;
        }
        setSent({ ticket: answer.ticket, summary: answer.summary });
        setOpen(false);
        notify('success', t('linkPage.sent', 'Support bundle sent'));
        onSent();
        return undefined;
      })
      .catch(() => setError('failed'))
      .finally(() => setSending(false));
  };

  const errorLine: Record<SendError, string> = {
    denied: t('linkPage.send_denied', 'Only admins who can edit dirk_lib\'s own settings can send a bundle.'),
    notLinked: t('linkPage.send_notLinked', 'This server isn\'t linked any more.'),
    revoked: t('linkPage.err_revoked', 'This server was unlinked from the website, so it no longer checks in.'),
    unreachable: t('linkPage.err_unreachable', 'Could not reach dirkscripts.com from this server. Check it has internet access and try again.'),
    refused: t('linkPage.err_refused', 'dirkscripts.com refused the request. Try again in a minute.'),
    notFound: t('linkPage.send_notFound', 'That ticket isn\'t open on your account any more. Pick another.'),
    closed: t('linkPage.send_closed', 'That ticket is resolved or closed. Open a new one on dirkscripts.com and send it there.'),
    tooLarge: t('linkPage.send_tooLarge', 'The bundle came out too large to send.'),
    tooSoon: t('linkPage.send_tooSoon', 'This server sent that ticket a bundle under a minute ago. Give it a minute.'),
    busy: t('linkPage.send_busy', 'A bundle is already on its way.'),
    failed: t('linkPage.send_failed', 'Could not build the bundle. The server console says why.'),
  };

  const chosen = tickets?.find((x) => x.id === picked);
  const since = (iso?: string) => (iso ? ago(Math.floor(Date.parse(iso) / 1000), t) : '');

  return (
    <Card>
      {!open ? (
        <Flex direction="column" gap="xs">
          <Flex align="center" gap="md">
            <div style={{ flex: 1, minWidth: 0 }}>
              <Muted>{t('linkPage.sendWhat', 'Send one to a ticket yourself: pick one of your open tickets and this server sends its bundle there. It shows on the ticket, so you see exactly what was sent.')}</Muted>
            </div>
            <StudioButton label={t('linkPage.send', 'Send a support bundle')} icon={Send} primary onClick={start} />
          </Flex>
          {sent && (
            <Flex align="center" gap="xs">
              <Check size="1.4vh" color="#22c55e" />
              <Muted>{`${t('linkPage.sentTo', 'Sent to ticket')}${sent.ticket ? ` #${sent.ticket}` : ''}${sent.summary ? ` · ${sent.summary}` : ''}`}</Muted>
            </Flex>
          )}
        </Flex>
      ) : (
        <Flex direction="column" gap="sm">
          <Flex align="center" gap="xs">
            <Ticket size="1.5vh" color={color} />
            <Text ff="Akrobat Bold" size="sm" c="rgba(255,255,255,0.9)" style={{ flex: 1 }}>
              {t('linkPage.pickTicket', 'Which ticket is it for?')}
            </Text>
            <StudioButton label={t('linkPage.refresh', 'Refresh')} icon={RefreshCw} disabled={loading || sending} onClick={load} />
          </Flex>

          {loading && !tickets ? (
            <Flex align="center" gap="xs"><Loader size="xs" color={color} /><Muted>{t('linkPage.loadingTickets', 'Asking dirkscripts.com for your open tickets…')}</Muted></Flex>
          ) : tickets && tickets.length === 0 ? (
            <Flex direction="column" gap="xs" align="flex-start">
              <Notice icon={Ticket} tone={color}>
                {t('linkPage.noTickets', 'You have no open tickets. Open one on dirkscripts.com, then come back here and send the bundle to it.')}
              </Notice>
              {newTicketUrl && (
                <StudioButton label={t('linkPage.openTicket', 'Open a ticket')} icon={ExternalLink} primary onClick={() => openUrl(newTicketUrl)} />
              )}
            </Flex>
          ) : tickets ? (
            <Flex direction="column" gap="0.6vh" className="studio-scroll" style={{ maxHeight: '28vh', overflowY: 'auto' }}>
              {tickets.map((ticket) => {
                const on = ticket.id === picked;
                const sub = [ticket.script?.name, ticket.updatedAt ? `${t('linkPage.updated', 'updated')} ${since(ticket.updatedAt)}` : ''].filter(Boolean).join(' · ');
                return (
                  <Flex
                    key={ticket.id}
                    align="center"
                    gap="sm"
                    px="sm"
                    py="0.8vh"
                    onClick={() => !sending && setPicked(ticket.id)}
                    style={{
                      cursor: sending ? 'default' : 'pointer',
                      borderRadius: theme.radius.xs,
                      background: on ? alpha(color, 0.12) : alpha(theme.colors.dark[6], 0.5),
                      border: `0.1vh solid ${on ? alpha(color, 0.6) : alpha(theme.colors.dark[4], 0.5)}`,
                    }}
                  >
                    <Flex
                      align="center" justify="center"
                      style={{ width: '1.6vh', height: '1.6vh', flexShrink: 0, borderRadius: '50%', border: `0.2vh solid ${on ? color : 'rgba(255,255,255,0.3)'}` }}
                    >
                      {on && <div style={{ width: '0.7vh', height: '0.7vh', borderRadius: '50%', background: color }} />}
                    </Flex>
                    {ticket.number !== undefined && (
                      <Text ff="monospace" fw={700} size="sm" c={on ? color : 'rgba(255,255,255,0.6)'}>{`#${ticket.number}`}</Text>
                    )}
                    <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
                      <Text ff="Akrobat SemiBold" size="sm" c="rgba(255,255,255,0.92)" truncate>{ticket.subject || t('linkPage.noSubject', 'No subject')}</Text>
                      {sub && <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.45)" truncate>{sub}</Text>}
                    </Flex>
                  </Flex>
                );
              })}
            </Flex>
          ) : null}

          {error && <Notice icon={CircleAlert} tone="#f59e0b">{errorLine[error] ?? error}</Notice>}

          <Flex gap="xs" justify="flex-end">
            <StudioButton label={t('linkPage.cancel', 'Cancel')} disabled={sending} onClick={() => { setOpen(false); setError(null); }} />
            {!!tickets?.length && (
              <StudioButton
                label={sending
                  ? t('linkPage.sending', 'Sending…')
                  : `${t('linkPage.sendTo', 'Send to')} ${chosen?.number !== undefined ? `#${chosen.number}` : t('linkPage.thisTicket', 'this ticket')}`}
                icon={Send}
                primary
                disabled={!picked || sending || loading}
                onClick={send}
              />
            )}
          </Flex>
        </Flex>
      )}
    </Card>
  );
}

function Block({
  icon: Icon, title, description, action, children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const theme = useMantineTheme();
  const color = theme.colors[theme.primaryColor][5];
  return (
    <Flex direction="column" gap="xs">
      <Flex align="center" gap="xs">
        <Icon size="1.9vh" color={color} />
        <Text ff="Akrobat Bold" size="md" c="rgba(255,255,255,0.92)">{title}</Text>
        <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.35)" style={{ flex: 1 }}>{description}</Text>
        {action}
      </Flex>
      {children}
    </Flex>
  );
}

function Card({ children, mt }: { children: React.ReactNode; mt?: string }) {
  const theme = useMantineTheme();
  return (
    <Flex
      direction="column" p="sm" mt={mt}
      style={{
        background: alpha(theme.colors.dark[7], 0.55),
        border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.5)}`,
        borderRadius: theme.radius.xs,
      }}
    >
      {children}
    </Flex>
  );
}

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <Flex align="center" gap="xs">
      <Icon size="1.4vh" color="rgba(255,255,255,0.4)" />
      <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.45)" w="14vh">{label}</Text>
      <Text ff="Akrobat SemiBold" size="sm" c="rgba(255,255,255,0.9)" truncate style={{ flex: 1, minWidth: 0 }}>{value}</Text>
    </Flex>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.5)">{children}</Text>;
}

function Notice({ icon: Icon, tone, children }: { icon: React.ElementType; tone: string; children: React.ReactNode }) {
  return (
    <Flex align="center" gap="xs" px="sm" py="xs" style={{ background: alpha(tone, 0.08), border: `0.1vh solid ${alpha(tone, 0.3)}`, borderRadius: '0.4vh' }}>
      <Icon size="1.5vh" color={tone} />
      <Text ff="Akrobat SemiBold" size="xs" c="rgba(255,255,255,0.75)">{children}</Text>
    </Flex>
  );
}

/** The approve link, click to copy (the cfx-react helper: CEF has no DOM clipboard API). */
function CopyUrl({ url }: { url: string }) {
  const theme = useMantineTheme();
  const [done, setDone] = useState(false);
  return (
    <Flex
      align="center" gap="0.6vh" px="0.8vh" py="0.5vh"
      onClick={() => {
        copyToClipboard(url);
        setDone(true);
        notify('success', 'Copied');
        setTimeout(() => setDone(false), 1500);
      }}
      style={{
        cursor: 'pointer',
        background: alpha(theme.colors.dark[6], 0.7),
        border: `0.1vh solid ${alpha(theme.colors.dark[4], 0.6)}`,
        borderRadius: '0.4vh',
        maxWidth: '100%',
      }}
    >
      <Text ff="monospace" size="xs" c="rgba(255,255,255,0.8)" style={{ wordBreak: 'break-all' }}>{url}</Text>
      {done ? <Check size="1.3vh" color="#22c55e" /> : <Copy size="1.3vh" color="rgba(255,255,255,0.5)" />}
    </Flex>
  );
}
