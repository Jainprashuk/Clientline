import { useCallback, useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { useToast } from '../context/ToastContext';
import {
  loadInbox, loadThread, checkReplies, snoozeThread, doneThread, reopenThread, setThreadCategory, draftThreadReply, sendThreadReply,
  type InboxList, type InboxThread, type ReplyCategory,
} from '../lib/api';
import { timeAgo } from '../lib/leads';

const QUIET: ReplyCategory[] = ['no', 'auto'];
const gapsIn = (t: string) => [...new Set(t.match(/\[[^\]\n]{1,60}\]/g) || [])];

const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(9, 0, 0, 0); return d; };
const nextMonday = () => { const d = day(1); while (d.getDay() !== 1) d.setDate(d.getDate() + 1); return d; };

function Thread({ id, categories, onChanged }: { id: string; categories: InboxList['categories']; onChanged: () => void }) {
  const toast = useToast();
  const [t, setT] = useState<InboxThread | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(() => loadThread(id).then(setT).catch(e => toast(e.message, 'error')), [id, toast]);
  useEffect(() => { setT(null); setText(''); load(); }, [id, load]);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try { await fn(); toast(done, 'success'); await load(); onChanged(); }
    catch (e: any) { toast(e.message, 'error', 7000); }
    finally { setBusy(null); }
  };
  const draft = async () => {
    if (text.trim() && !window.confirm('Replace what you’ve written with a draft?')) return;
    setBusy('draft');
    try { const r = await draftThreadReply(id); setText(r.text); requestAnimationFrame(() => box.current?.focus()); }
    catch (e: any) { toast(e.message, 'error', 7000); }
    finally { setBusy(null); }
  };
  const insertBooking = () => {
    if (!t?.bookingUrl) return;
    const el = box.current; const at = el ? el.selectionStart : text.length;
    setText(text.slice(0, at) + t.bookingUrl + text.slice(at));
  };
  const gaps = gapsIn(text);

  if (!t) return <div className="cl-thread"><div className="empty-state"><i className="ti ti-loader" />Loading…</div></div>;
  return (
    <div className="cl-thread">
      <div className="cl-meta" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 16, color: 'var(--text)' }}>{t.name}{t.company && t.company !== t.name ? <span style={{ fontWeight: 400, color: 'var(--text2)' }}> · {t.company}</span> : null}</div>
          <div className="cl-row-sub">{t.email} · {t.subject}</div>
        </div>
        <div className="cl-meta">
          <select aria-label="What they want" value={t.category || ''} style={{ width: 'auto' }}
            onChange={e => act('cat', () => setThreadCategory(id, e.target.value as ReplyCategory), 'Sorted.')}>
            {!t.category && <option value="">Not sorted</option>}
            {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {t.doneAt
            ? <button className="btn btn-sm" type="button" disabled={busy !== null} onClick={() => act('reopen', () => reopenThread(id), 'Back in Needs you.')}>Reopen</button>
            : <button className="btn btn-sm" type="button" disabled={busy !== null} onClick={() => act('done', () => doneThread(id), 'Marked done.')}><i className="ti ti-check" /> Done</button>}
          <span style={{ position: 'relative' }}>
            <button className="btn btn-sm" type="button" onClick={() => setSnoozeOpen(o => !o)}><i className="ti ti-clock" /> Snooze</button>
            {snoozeOpen && (
              <div className="cl-menu" role="menu" style={{ minWidth: 200 }}>
                {[['Tomorrow', day(1)], ['Next Monday', nextMonday()], ['In two weeks', day(14)], ['In a month', day(30)]].map(([label, d]) => (
                  <button key={label as string} type="button" role="menuitem" onClick={() => { setSnoozeOpen(false); act('snooze', () => snoozeThread(id, (d as Date).toISOString()), `Snoozed until ${(d as Date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}.`); }}>
                    {label as string}<small>{(d as Date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</small>
                  </button>
                ))}
                <label style={{ display: 'block', padding: '8px 10px', fontSize: 12.5 }}>On a date
                  <input type="date" style={{ marginTop: 4 }} min={day(1).toISOString().slice(0, 10)}
                    onChange={e => { if (!e.target.value) return; setSnoozeOpen(false); const d = new Date(`${e.target.value}T09:00:00`); act('snooze', () => snoozeThread(id, d.toISOString()), 'Snoozed.'); }} />
                </label>
              </div>
            )}
          </span>
        </div>
      </div>
      {t.categoryWhy && <div className="cl-hint" style={{ marginTop: -4, marginBottom: 10 }}>{t.categoryWhy}{t.snoozedUntil ? ` · snoozed until ${new Date(t.snoozedUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</div>}

      {t.messages.map((m, i) => (
        <div key={i} className={`cl-msg ${m.direction}`}>
          <div className="meta">{m.direction === 'in' ? t.name : 'You'} · {new Date(m.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          {m.text || '(no text)'}
        </div>
      ))}

      {t.category === 'auto' ? (
        <div className="cl-note">An automatic reply: their sequence pauses until they’re back, then carries on by itself.</div>
      ) : (
        <div className="cl-composer" style={{ marginTop: 14 }}>
          <textarea ref={box} aria-label="Your reply" value={text} placeholder="Write your reply, or let AI draft one from this thread and your profile." onChange={e => setText(e.target.value)} />
          {gaps.length > 0 && (
            <div className="cl-meta" style={{ margin: '6px 0' }}>Fill in before sending: {gaps.map(g => <span key={g} className="cl-gap">{g}</span>)}</div>
          )}
          <div className="cl-meta" style={{ marginTop: 8 }}>
            <button className="btn btn-sm" type="button" disabled={busy !== null} onClick={draft}>
              {busy === 'draft' ? <><i className="ti ti-loader" /> Drafting…</> : <><i className="ti ti-sparkles" /> Draft a reply</>}
            </button>
            {t.bookingUrl && <button className="btn btn-sm" type="button" onClick={insertBooking}><i className="ti ti-calendar" /> Insert booking link</button>}
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary" type="button" disabled={busy !== null || !text.trim() || gaps.length > 0}
              title={gaps.length ? 'Fill in the [gaps] first' : 'Sends from your Gmail, in this thread'}
              onClick={() => act('send', async () => { await sendThreadReply(id, text); setText(''); }, 'Sent from your Gmail.')}>
              {busy === 'send' ? 'Sending…' : <><i className="ti ti-send" /> Send</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Inbox() {
  const toast = useToast();
  const [view, setView] = useState<InboxList['view']>('needs');
  const [data, setData] = useState<InboxList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(() => loadInbox(view).then(d => { setData(d); setError(null); }).catch(e => setError(e.message)), [view]);
  useEffect(() => { load(); }, [load]);

  const check = useCallback(async (soon: boolean) => {
    setChecking(true);
    try {
      const r = await checkReplies(soon);
      if (!r.ok && r.error) toast(r.error, 'error', 7000);
      else if (!soon || r.replies || r.bounces) toast(r.skipped && !soon ? `Not checked: ${r.skipped}.` : `${r.replies} new repl${r.replies === 1 ? 'y' : 'ies'}${r.bounces ? `, ${r.bounces} bounced` : ''}.`, 'info');
      await load();
    } catch (e: any) { if (!soon) toast(e.message, 'error'); }
    finally { setChecking(false); }
  }, [load, toast]);
  // Opening the Inbox checks Gmail if the last check was over ten minutes ago.
  useEffect(() => { check(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const items = data ? data.items : [];
  useEffect(() => { if (data && !openId && items.length && window.innerWidth > 860) setOpenId(items[0].id); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Layout title="Inbox" subtitle="Replies to your outreach, sorted by what the person wants. Drafts use only your profile and the thread."
      actions={<button className="btn" type="button" disabled={checking} onClick={() => check(false)}>{checking ? <><i className="ti ti-loader" /> Checking Gmail…</> : <><i className="ti ti-refresh" /> Check for replies</>}</button>}>
      {error && <div className="info-box danger"><i className="ti ti-alert-triangle" /> {error}</div>}
      {data && data.lastError && <div className="info-box danger" style={{ marginBottom: 12 }}><i className="ti ti-alert-triangle" /> Last Gmail check: {data.lastError}</div>}
      {data && (
        <>
          <div className="cl-meta" style={{ marginBottom: 12 }}>
            <div className="cl-toggles" role="group" aria-label="Show">
              {([['needs', 'Needs you'], ['snoozed', 'Snoozed'], ['all', 'All']] as const).map(([k, label]) => (
                <button key={k} type="button" className="cl-toggle" aria-pressed={view === k} onClick={() => { setView(k); setOpenId(null); }}>
                  {label} · {data.counts[k]}
                </button>
              ))}
            </div>
            <span style={{ flex: 1 }} />
            <span>{data.lastCheckAt ? `Gmail checked ${timeAgo(data.lastCheckAt)}` : 'Gmail not checked yet'}</span>
          </div>
          {!items.length ? (
            <div className="s-card"><div className="empty-state">
              <i className="ti ti-inbox" />
              {view === 'needs' ? 'Nothing needs you. Replies to your outreach show up here.' : view === 'snoozed' ? 'Nothing snoozed.' : 'No replies yet. Once someone answers an outreach email, the conversation appears here.'}
            </div></div>
          ) : (
            <div className="cl-inbox">
              <div className="cl-inbox-list" role="list">
                {items.map(i => (
                  <button key={i.id} type="button" role="listitem" className={`cl-inbox-item${openId === i.id ? ' on' : ''}${i.unread ? ' unread' : ''}`} onClick={() => setOpenId(i.id)}>
                    <div className="top"><span className="who">{i.name}</span><span className="when">{timeAgo(i.lastAt)}</span></div>
                    {i.company && i.company !== i.name && <div className="cl-row-sub" style={{ marginTop: 0 }}>{i.company}</div>}
                    <div className="snip">{i.snippet}</div>
                    {i.category && <span className={`cl-cat${QUIET.includes(i.category) ? ' quiet' : ''}`}>{data.categories[i.category]}</span>}
                  </button>
                ))}
              </div>
              {openId ? <Thread id={openId} categories={data.categories} onChanged={load} /> : <div className="cl-thread"><div className="empty-state">Pick a conversation.</div></div>}
            </div>
          )}
        </>
      )}
      {!data && !error && <div className="empty-state"><i className="ti ti-loader" />Loading…</div>}
    </Layout>
  );
}
