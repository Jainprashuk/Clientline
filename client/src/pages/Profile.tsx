import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Layout from '../components/Layout';
import ChipInput from '../components/ChipInput';
import ServicePicker from '../components/ServicePicker';
import ResumeImport from '../components/ResumeImport';
import { LOCATION_OPTIONS, EXCLUSION_OPTIONS, suggestKeywords } from '../lib/presets';
import { useToast } from '../context/ToastContext';
import { loadProfile, saveProfile, type Profile as ProfileData, type ProfileView } from '../lib/api';

const CLIENT_TYPES: [string, string][] = [
  ['startups', 'Startups'], ['saas', 'SaaS companies'], ['ecommerce', 'D2C / e-commerce'], ['local-business', 'Local businesses'],
  ['agencies', 'Agencies'], ['nonprofit', 'Nonprofits'], ['enterprise', 'Large companies'],
];
const SIZES: [string, string][] = [['1-10', '1–10 people'], ['11-50', '11–50'], ['51-200', '51–200'], ['200+', '200+']];

const EMPTY: ProfileData = {
  name: '', headline: '', portfolioUrl: '', howIWork: '', availability: '', phone: '', services: [], currency: 'INR', rate: 0, minProject: 0, clientTypes: [], companySizes: [],
  locations: [], remoteOk: true, exclusions: [], proof: [], cases: [],
  proposalTerms: { split: [30, 40, 30], rounds: 2, validDays: 14 },
  billing: { legalName: '', address: '', taxId: '', gstPercent: 0, upiId: '', payDetails: '', prefix: 'INV', paymentDays: 7 },
  sources: { hn: true, news: true, web: true, webPerDay: 5 },
};

function Card({ id, icon, title, sub, children }: { id?: string; icon: string; title: string; sub: string; children: ReactNode }) {
  return (
    <div className="s-card" id={id} style={{ marginBottom: 16 }}>
      <div className="s-head">
        <div className="s-head-left">
          <div className="s-icon"><i className={`ti ${icon}`} /></div>
          <div><div className="s-title">{title}</div><div className="s-sub">{sub}</div></div>
        </div>
      </div>
      <div className="s-body">{children}</div>
    </div>
  );
}

/** What your first emails can draw on, and what's missing (mirrors emailStrength in lib/outreach/firstEmail.js). */
function EmailStrength({ p }: { p: ProfileData }) {
  const covered = new Set(p.cases.filter(c => c.title && c.result).map(c => c.service).filter(Boolean));
  const items: { ok: boolean; label: string; href: string }[] = [
    { ok: !!p.name.trim(), label: 'Your name', href: '#about' },
    { ok: !!p.headline.trim(), label: 'One line about you', href: '#about' },
    { ok: !!p.portfolioUrl.trim(), label: 'A portfolio or website link', href: '#about' },
    ...p.services.map(s => ({ ok: covered.has(s.name), label: `A project for “${s.name}”`, href: '#work' })),
  ];
  const done = items.filter(i => i.ok).length;
  if (!items.length) return null;
  return (
    <Card icon="ti-mail-check" title={`Email strength · ${done} of ${items.length}`}
      sub="Your first email cites the project that matches what the lead needs. Without one, it goes without proof — never made up.">
      <div className="cl-toggles" style={{ flexWrap: 'wrap' }}>
        {items.map(i => (
          <a key={i.label} href={i.href} className="cl-toggle" aria-pressed={i.ok} style={{ textDecoration: 'none' }}>
            <i className={`ti ${i.ok ? 'ti-check' : 'ti-plus'}`} /> {i.label}
          </a>
        ))}
      </div>
    </Card>
  );
}

function Toggles({ options, value, onChange }: { options: [string, string][]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="cl-toggles">
      {options.map(([key, label]) => (
        <button key={key} type="button" className="cl-toggle" aria-pressed={value.includes(key)}
          onClick={() => onChange(value.includes(key) ? value.filter(v => v !== key) : [...value, key])}>{label}</button>
      ))}
    </div>
  );
}

const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

export default function Profile() {
  const toast = useToast();
  const [view, setView] = useState<ProfileView | null>(null);
  const [p, setP] = useState<ProfileData>(EMPTY);
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProfile().then(v => { setView(v); setP(v.profile); setSaved(JSON.stringify(v.profile)); }).catch(e => setError(e.message));
  }, []);

  const dirty = useMemo(() => !!view && JSON.stringify(p) !== saved, [p, saved, view]);
  const [importing, setImporting] = useState(false);
  const set = <K extends keyof ProfileData>(k: K, v: ProfileData[K]) => setP(prev => ({ ...prev, [k]: v }));
  const setService = (i: number, patch: Partial<ProfileData['services'][number]>) =>
    set('services', p.services.map((s, n) => (n === i ? { ...s, ...patch } : s)));

  // Leaving with unsaved changes loses them: ask first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async () => {
    setSaving(true);
    try {
      const v = await saveProfile(p);
      setView(v); setP(v.profile); setSaved(JSON.stringify(v.profile));
      toast(v.complete ? 'Profile saved.' : `Saved. Still needed for leads: ${v.missing.join(', ')}.`, v.complete ? 'success' : 'info', 6000);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally { setSaving(false); }
  };

  const cur = p.currency;
  const saveBtn = (
    <button className="btn btn-primary" type="button" disabled={!dirty || saving} onClick={save}>
      {saving ? <><i className="ti ti-loader" /> Saving…</> : dirty ? 'Save changes' : 'Saved'}
    </button>
  );

  return (
    <Layout title="My profile" subtitle="What you sell and to whom. Leads are judged against this, and your emails may only use what is here."
      actions={view ? <><button className="btn" type="button" onClick={() => setImporting(true)}><i className="ti ti-file-cv" /> Fill from resume</button>{saveBtn}</> : undefined}>
      {importing && <ResumeImport profile={p} onApply={patch => setP(prev => ({ ...prev, ...patch }))} onClose={() => setImporting(false)} />}
      {error && <div className="info-box danger"><i className="ti ti-alert-triangle" /> {error}</div>}
      {!view && !error && <div className="empty-state"><i className="ti ti-loader" />Loading…</div>}
      {view && (
        <>
          {!view.complete && (
            <div className="info-box" style={{ marginBottom: 16 }}>
              <i className="ti ti-info-circle" style={{ fontSize: 15, flexShrink: 0 }} />
              <div>To start finding leads, add {view.missing.join(', ')}.</div>
            </div>
          )}

          <EmailStrength p={p} />

          <Card id="about" icon="ti-user" title="About you" sub="How your first email introduces you and signs off">
            <div className="cl-cols">
              <div className="form-group">
                <label className="form-label" htmlFor="pf-name">Your name</label>
                <input id="pf-name" type="text" value={p.name} maxLength={80} onChange={e => set('name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pf-headline">One line about you</label>
                <input id="pf-headline" type="text" value={p.headline} maxLength={140} placeholder="Freelance React and Node developer"
                  onChange={e => set('headline', e.target.value)} />
              </div>
            </div>
            <div className="cl-cols">
              <div className="form-group">
                <label className="form-label" htmlFor="pf-portfolio">Portfolio or website</label>
                <input id="pf-portfolio" type="url" value={p.portfolioUrl} maxLength={300} placeholder="https://yourname.dev"
                  onChange={e => set('portfolioUrl', e.target.value)} />
                <div className="cl-hint">Under your name in every first email, as “{(p.portfolioUrl || 'https://yourname.dev').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')}”.</div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pf-phone">Phone <span className="cl-row-sub">(optional)</span></label>
                <input id="pf-phone" type="tel" value={p.phone} maxLength={30} placeholder="+91 98765 43210"
                  onChange={e => set('phone', e.target.value)} />
                <div className="cl-hint">Next to your site under your name — clients who’d rather call can.</div>
              </div>
            </div>
            <div className="cl-cols">
              <div className="form-group">
                <label className="form-label" htmlFor="pf-avail">When you can start <span className="cl-row-sub">(optional)</span></label>
                <input id="pf-avail" type="text" value={p.availability} maxLength={80} placeholder="I can start next week"
                  onChange={e => set('availability', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="pf-how">How you work <span className="cl-row-sub">(optional)</span></label>
              <input id="pf-how" type="text" value={p.howIWork} maxLength={160} placeholder="Fixed price after a short call, a demo every week"
                onChange={e => set('howIWork', e.target.value)} />
              <div className="cl-hint">The email may use this when it says how you’d start on their project.</div>
            </div>
          </Card>

          <Card icon="ti-briefcase" title="What you sell" sub="Pick what you do, or add your own. A lead only counts if their post mentions one of a service’s keywords">
            <ServicePicker value={p.services} onChange={v => set('services', v)} />
            {p.services.length > 0 && <div className="form-label" style={{ margin: '18px 0 8px' }}>Fine-tune each service</div>}
            {p.services.map((s, i) => (
              <div className="cl-row" key={i}>
                <button type="button" className="btn btn-xs cl-row-remove" aria-label={`Remove ${s.name || 'service'}`}
                  onClick={() => set('services', p.services.filter((_, n) => n !== i))}><i className="ti ti-x" /></button>
                <div className="cl-cols">
                  <div className="form-group">
                    <label className="form-label">Service</label>
                    <input type="text" value={s.name} maxLength={80} placeholder="React web apps"
                      onChange={e => setService(i, { name: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Smallest job for this ({cur})</label>
                    <input type="number" min={0} value={s.minBudget || ''} placeholder={p.minProject ? `${p.minProject} (your minimum)` : '0'}
                      onChange={e => setService(i, { minBudget: num(e.target.value) })} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Keywords a client would use</label>
                  <ChipInput label={`Keywords for ${s.name || 'this service'}`} value={s.keywords} max={15}
                    placeholder="Type a word and press Enter" suggestions={suggestKeywords(s.name)}
                    onChange={keywords => setService(i, { keywords })} />
                </div>
              </div>
            ))}
          </Card>

          <Card icon="ti-currency-rupee" title="Pricing" sub="Leads with a stated budget below your minimum are dropped">
            <div className="cl-cols">
              <div className="form-group">
                <label className="form-label" htmlFor="pf-cur">Currency</label>
                <select id="pf-cur" value={p.currency} onChange={e => set('currency', e.target.value as ProfileData['currency'])}>
                  {['INR', 'USD', 'EUR', 'GBP'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pf-rate">Hourly rate ({cur})</label>
                <input id="pf-rate" type="number" min={0} value={p.rate || ''} onChange={e => set('rate', num(e.target.value))} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pf-min">Smallest project ({cur})</label>
                <input id="pf-min" type="number" min={0} value={p.minProject || ''} onChange={e => set('minProject', num(e.target.value))} />
              </div>
            </div>
          </Card>

          <Card icon="ti-target-arrow" title="Ideal client" sub="Who you want to work with, and where they can be">
            <div className="form-group">
              <label className="form-label">Kinds of client</label>
              <Toggles options={CLIENT_TYPES} value={p.clientTypes} onChange={v => set('clientTypes', v)} />
            </div>
            <div className="form-group">
              <label className="form-label">Company size</label>
              <Toggles options={SIZES} value={p.companySizes} onChange={v => set('companySizes', v)} />
            </div>
            <div className="form-group">
              <label className="form-label">Where they can be</label>
              <ChipInput label="Client locations" value={p.locations} max={10} placeholder="A country or city"
                suggestions={LOCATION_OPTIONS} onChange={v => set('locations', v)} />
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 13 }}>
                <input type="checkbox" checked={p.remoteOk} onChange={e => set('remoteOk', e.target.checked)} />
                Remote clients anywhere are fine
              </label>
            </div>
          </Card>

          <Card icon="ti-ban" title="Leave out" sub="A post mentioning any of these is dropped">
            <ChipInput label="Words that rule a lead out" value={p.exclusions} max={30} placeholder="A word or phrase"
              suggestions={EXCLUSION_OPTIONS} onChange={v => set('exclusions', v)} />
          </Card>

          <Card id="work" icon="ti-award" title="Your work" sub="Each first email cites the piece that matches the lead’s service, with its link — and only what you write here">
            <div className="form-label" style={{ marginBottom: 8 }}>Projects with a result</div>
            {p.cases.map((c, i) => (
              <div className="cl-row" key={i}>
                <button type="button" className="btn btn-xs cl-row-remove" aria-label="Remove result"
                  onClick={() => set('cases', p.cases.filter((_, n) => n !== i))}><i className="ti ti-x" /></button>
                <div className="cl-cols">
                  <input type="text" aria-label="Project" placeholder="Chai Point menu rebuild" value={c.title} maxLength={120}
                    onChange={e => set('cases', p.cases.map((x, n) => (n === i ? { ...x, title: e.target.value } : x)))} />
                  <input type="url" aria-label="Link (optional)" placeholder="https://… (optional)" value={c.url} maxLength={300}
                    onChange={e => set('cases', p.cases.map((x, n) => (n === i ? { ...x, url: e.target.value } : x)))} />
                </div>
                <input type="text" aria-label="Result" placeholder="Mobile score went from 34 to 92" value={c.result} maxLength={300}
                  onChange={e => set('cases', p.cases.map((x, n) => (n === i ? { ...x, result: e.target.value } : x)))} />
                <div className="cl-cols" style={{ marginTop: 8 }}>
                  <select aria-label="Which service it proves" value={c.service || ''}
                    onChange={e => set('cases', p.cases.map((x, n) => (n === i ? { ...x, service: e.target.value } : x)))}>
                    <option value="">Which service does it prove?</option>
                    {p.services.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                  <input type="text" aria-label="Kind of client (optional)" placeholder="For a… D2C brand (optional)" value={c.client || ''} maxLength={80}
                    onChange={e => set('cases', p.cases.map((x, n) => (n === i ? { ...x, client: e.target.value } : x)))} />
                </div>
              </div>
            ))}
            {p.cases.length < 10 && (
              <button type="button" className="btn" style={{ marginBottom: 18 }}
                onClick={() => set('cases', [...p.cases, { title: '', result: '', url: '', service: p.services.find(s => !p.cases.some(c => c.service === s.name))?.name || '', client: '' }])}>
                <i className="ti ti-plus" /> Add a project
              </button>
            )}
            <div className="form-label" style={{ marginBottom: 8 }}>What clients said</div>
            {p.proof.map((q, i) => (
              <div className="cl-row" key={i}>
                <button type="button" className="btn btn-xs cl-row-remove" aria-label="Remove quote"
                  onClick={() => set('proof', p.proof.filter((_, n) => n !== i))}><i className="ti ti-x" /></button>
                <textarea aria-label="Quote" rows={2} maxLength={400} placeholder="“Delivered a week early and the site is twice as fast.”" value={q.text}
                  onChange={e => set('proof', p.proof.map((x, n) => (n === i ? { ...x, text: e.target.value } : x)))} />
                <input type="text" aria-label="Who said it" placeholder="Ritika, owner of Brewbox Coffee" value={q.who} maxLength={80}
                  onChange={e => set('proof', p.proof.map((x, n) => (n === i ? { ...x, who: e.target.value } : x)))} />
              </div>
            ))}
            {p.proof.length < 10 && (
              <button type="button" className="btn" onClick={() => set('proof', [...p.proof, { who: '', text: '' }])}>
                <i className="ti ti-plus" /> Add a quote
              </button>
            )}
          </Card>

          <Card id="getting-paid" icon="ti-receipt" title="Proposals & getting paid" sub="What your proposals offer and what your invoices show. Payment is by UPI or your bank — no gateway, no fees.">
            <div className="cl-cols">
              <div className="form-group">
                <label className="form-label" htmlFor="pf-split">Payment split (%)</label>
                <input id="pf-split" type="text" value={(p.proposalTerms?.split || [30, 40, 30]).join(' / ')} placeholder="30 / 40 / 30"
                  onChange={e => set('proposalTerms', { ...p.proposalTerms, split: e.target.value.split(/[^\d]+/).map(Number).filter(Boolean) })} />
                <div className="cl-hint">To start / at the halfway demo / on delivery. Must add up to 100.</div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pf-rounds">Rounds of changes included</label>
                <input id="pf-rounds" type="number" min={0} max={10} value={p.proposalTerms?.rounds ?? 2} onChange={e => set('proposalTerms', { ...p.proposalTerms, rounds: num(e.target.value) })} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pf-valid">Proposal open for (days)</label>
                <input id="pf-valid" type="number" min={1} max={90} value={p.proposalTerms?.validDays ?? 14} onChange={e => set('proposalTerms', { ...p.proposalTerms, validDays: num(e.target.value) })} />
              </div>
            </div>
            <div className="cl-cols">
              <div className="form-group">
                <label className="form-label" htmlFor="pf-upi">UPI ID</label>
                <input id="pf-upi" type="text" value={p.billing?.upiId || ''} placeholder="yourname@okicici" onChange={e => set('billing', { ...p.billing, upiId: e.target.value.trim() })} />
                <div className="cl-hint">Rupee invoices show a QR any UPI app can scan — the amount fills in by itself.</div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pf-legal">Name on invoices</label>
                <input id="pf-legal" type="text" maxLength={160} value={p.billing?.legalName || ''} placeholder={p.name || 'Your full name or business name'} onChange={e => set('billing', { ...p.billing, legalName: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="pf-pay">Bank, PayPal or Wise details <span className="cl-row-sub">(for clients outside India, or as a second option)</span></label>
              <textarea id="pf-pay" rows={3} maxLength={800} value={p.billing?.payDetails || ''} placeholder={'Bank: HDFC · A/c 50100… · IFSC HDFC0001234\nPayPal: you@example.com'} onChange={e => set('billing', { ...p.billing, payDetails: e.target.value })} />
            </div>
            <div className="cl-cols">
              <div className="form-group">
                <label className="form-label" htmlFor="pf-addr">Address on invoices (optional)</label>
                <textarea id="pf-addr" rows={2} maxLength={500} value={p.billing?.address || ''} onChange={e => set('billing', { ...p.billing, address: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pf-tax">PAN or GSTIN (optional)</label>
                <input id="pf-tax" type="text" maxLength={40} value={p.billing?.taxId || ''} onChange={e => set('billing', { ...p.billing, taxId: e.target.value.toUpperCase() })} />
              </div>
            </div>
            <div className="cl-cols">
              <div className="form-group">
                <label className="form-label" htmlFor="pf-gst">GST on rupee invoices</label>
                <select id="pf-gst" value={String(p.billing?.gstPercent || 0)} onChange={e => set('billing', { ...p.billing, gstPercent: Number(e.target.value) })}>
                  <option value="0">None — not registered (under ₹20 lakh a year)</option>
                  {[5, 12, 18, 28].map(g => <option key={g} value={g}>{g}%</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pf-days">Pay within (days)</label>
                <input id="pf-days" type="number" min={0} max={90} value={p.billing?.paymentDays ?? 7} onChange={e => set('billing', { ...p.billing, paymentDays: num(e.target.value) })} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="pf-prefix">Invoice number prefix</label>
                <input id="pf-prefix" type="text" maxLength={12} value={p.billing?.prefix || 'INV'} onChange={e => set('billing', { ...p.billing, prefix: e.target.value })} />
              </div>
            </div>
          </Card>

          <div className="cl-savebar">
            {dirty && <span className="cl-hint" style={{ margin: 0 }}>Unsaved changes</span>}
            {saveBtn}
          </div>
        </>
      )}
    </Layout>
  );
}
