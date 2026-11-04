import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Layout from '../components/Layout';
import ChipInput from '../components/ChipInput';
import { useToast } from '../context/ToastContext';
import { loadProfile, saveProfile, type Profile as ProfileData, type ProfileView } from '../lib/api';

const CLIENT_TYPES: [string, string][] = [
  ['startups', 'Startups'], ['saas', 'SaaS companies'], ['ecommerce', 'D2C / e-commerce'], ['local-business', 'Local businesses'],
  ['agencies', 'Agencies'], ['nonprofit', 'Nonprofits'], ['enterprise', 'Large companies'],
];
const SIZES: [string, string][] = [['1-10', '1–10 people'], ['11-50', '11–50'], ['51-200', '51–200'], ['200+', '200+']];
const LOCATION_PRESETS = ['india', 'us', 'uk', 'europe', 'canada', 'australia', 'uae', 'singapore'];
const EXCLUSION_PRESETS = ['equity only', 'unpaid', 'revenue share', 'internship', 'full-time', 'wordpress'];

// Words that, in a service name, suggest the keywords a client's post would use.
// Only a starting point: the user edits the chips.
const KEYWORD_HINTS: Record<string, string[]> = {
  react: ['react', 'next.js', 'frontend'], next: ['next.js', 'react'], node: ['node.js', 'backend', 'api'],
  web: ['website', 'web app', 'web developer'], website: ['website', 'landing page', 'web developer'],
  landing: ['landing page', 'website'], mobile: ['mobile app', 'react native', 'flutter'], app: ['app developer', 'mvp'],
  flutter: ['flutter', 'mobile app'], android: ['android', 'mobile app'], ios: ['ios', 'swift', 'mobile app'],
  shopify: ['shopify', 'e-commerce', 'store'], wordpress: ['wordpress', 'website'], design: ['designer', 'ui/ux', 'figma'],
  ui: ['ui/ux', 'figma', 'designer'], ux: ['ui/ux', 'figma'], brand: ['branding', 'logo', 'brand designer'],
  logo: ['logo', 'branding'], seo: ['seo', 'search ranking'], marketing: ['marketing', 'growth'], content: ['content writer', 'copywriting'],
  copy: ['copywriter', 'copywriting'], video: ['video editor', 'video editing'], data: ['data analyst', 'dashboard', 'python'],
  python: ['python', 'django', 'automation'], ai: ['ai', 'llm', 'chatbot'], automation: ['automation', 'zapier', 'workflow'],
  devops: ['devops', 'aws', 'deployment'], backend: ['backend', 'api', 'database'], dashboard: ['dashboard', 'admin panel'],
  mvp: ['mvp', 'prototype'],
};
function suggestKeywords(name: string): string[] {
  const out: string[] = [];
  for (const w of name.toLowerCase().split(/[^a-z0-9+.#]+/)) {
    for (const k of KEYWORD_HINTS[w.replace(/\.js$/, '')] || []) if (!out.includes(k)) out.push(k);
  }
  return out;
}

const EMPTY: ProfileData = {
  name: '', headline: '', services: [], currency: 'INR', rate: 0, minProject: 0, clientTypes: [], companySizes: [],
  locations: [], remoteOk: true, exclusions: [], proof: [], cases: [], sources: { hn: true, news: true, web: true, webPerDay: 5 },
};

function Card({ icon, title, sub, children }: { icon: string; title: string; sub: string; children: ReactNode }) {
  return (
    <div className="s-card" style={{ marginBottom: 16 }}>
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
    <Layout title="My profile" subtitle="What you sell and to whom. Leads are judged against this, and first lines may only use what is here." actions={view ? saveBtn : undefined}>
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

          <Card icon="ti-user" title="About you" sub="How a first line introduces you">
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
          </Card>

          <Card icon="ti-briefcase" title="What you sell" sub="A lead only counts if their post mentions one of a service’s keywords">
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
            {p.services.length < 10 && (
              <button type="button" className="btn" onClick={() => set('services', [...p.services, { name: '', keywords: [], minBudget: 0 }])}>
                <i className="ti ti-plus" /> Add a service
              </button>
            )}
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
                suggestions={LOCATION_PRESETS} onChange={v => set('locations', v)} />
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 13 }}>
                <input type="checkbox" checked={p.remoteOk} onChange={e => set('remoteOk', e.target.checked)} />
                Remote clients anywhere are fine
              </label>
            </div>
          </Card>

          <Card icon="ti-ban" title="Leave out" sub="A post mentioning any of these is dropped">
            <ChipInput label="Words that rule a lead out" value={p.exclusions} max={30} placeholder="A word or phrase"
              suggestions={EXCLUSION_PRESETS} onChange={v => set('exclusions', v)} />
          </Card>

          <Card icon="ti-award" title="Proof" sub="The only results and quotes a first line may mention">
            <div className="form-label" style={{ marginBottom: 8 }}>Results you can point to</div>
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
              </div>
            ))}
            {p.cases.length < 10 && (
              <button type="button" className="btn" style={{ marginBottom: 18 }} onClick={() => set('cases', [...p.cases, { title: '', result: '', url: '' }])}>
                <i className="ti ti-plus" /> Add a result
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

          <div className="cl-savebar">
            {dirty && <span className="cl-hint" style={{ margin: 0 }}>Unsaved changes</span>}
            {saveBtn}
          </div>
        </>
      )}
    </Layout>
  );
}
