import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import ServicePicker from '../components/ServicePicker';
import ChipInput from '../components/ChipInput';
import { useToast } from '../context/ToastContext';
import { loadProfile, saveProfile, type Profile } from '../lib/api';
import { SERVICE_PRESETS, LOCATION_OPTIONS, guessHome, inCurrency } from '../lib/presets';

const PLACE_NAME: Record<string, string> = {
  india: 'India', us: 'United States', uk: 'United Kingdom', europe: 'Europe', canada: 'Canada', australia: 'Australia', uae: 'UAE', singapore: 'Singapore',
};
const placeLabel = (s: string) => PLACE_NAME[s] || s.replace(/\b\w/g, c => c.toUpperCase());
const SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

/**
 * Three questions, nothing to type unless you want to: what you do, the smallest
 * project you'd take, and where clients can be. Everything else in My profile has
 * a sensible default and can wait until you have seen some leads.
 */
export default function Setup() {
  const toast = useToast();
  const navigate = useNavigate();
  const home = useMemo(guessHome, []);
  const [base, setBase] = useState<Profile | null>(null);
  const [step, setStep] = useState(0);
  const [services, setServices] = useState<Profile['services']>([]);
  const [currency, setCurrency] = useState<Profile['currency']>(home.currency);
  const [minProject, setMinProject] = useState(0);
  const [locations, setLocations] = useState<string[]>([home.location]);
  const [remoteOk, setRemoteOk] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProfile().then(v => {
      const p = v.profile;
      setBase(p);
      if (p.services.length) setServices(p.services);
      if (p.minProject) setMinProject(p.minProject);
      if (p.locations.length) setLocations(p.locations);
      if (p.currency) setCurrency(p.currency);
      setRemoteOk(p.remoteOk !== false);
    }).catch(e => toast(e.message, 'error'));
  }, [toast]);

  // The suggested smallest project: the lowest of the picked services' usual minimums.
  const suggested = useMemo(() => {
    const mins = services.map(s => SERVICE_PRESETS.find(p => p.name === s.name)?.minINR).filter((n): n is number => !!n);
    return inCurrency(mins.length ? Math.min(...mins) : 15000, currency);
  }, [services, currency]);
  useEffect(() => { if (step === 1 && !minProject) setMinProject(suggested); }, [step, suggested, minProject]);

  const step1ok = services.length > 0;
  const step2ok = minProject > 0;
  const step3ok = locations.length > 0 || remoteOk;
  const sliderMax = inCurrency(300000, currency);

  const finish = async () => {
    if (!base) return;
    setSaving(true);
    // Exclusions that come with the picked tiles, minus any that name a picked service.
    const picked = SERVICE_PRESETS.filter(p => services.some(s => s.name === p.name));
    const words = new Set(services.flatMap(s => s.keywords));
    const exclusions = [...new Set([...base.exclusions, 'unpaid', 'equity only', ...picked.flatMap(p => p.exclusions)])].filter(x => !words.has(x));
    try {
      const v = await saveProfile({ ...base, services, currency, minProject, locations, remoteOk, exclusions,
        clientTypes: base.clientTypes.length ? base.clientTypes : ['startups'] });
      if (!v.complete) { toast(`Still needed: ${v.missing.join(', ')}`, 'error'); return; }
      toast('Saved. Finding your first leads…', 'success');
      navigate('/leads?first=1');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally { setSaving(false); }
  };

  return (
    <Layout title="Set up" subtitle="Three quick questions, then your first leads. You can fine-tune everything later in My profile.">
      <div className="cl-setup">
        <div className="cl-steps" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} className={i <= step ? 'on' : ''} />)}</div>

        {step === 0 && (
          <div className="s-card"><div className="s-body">
            <h2>What do you do?</h2>
            <p className="lead">Pick everything you’d take on. Not in the list? Add your own below.</p>
            <ServicePicker value={services} onChange={setServices} />
          </div></div>
        )}

        {step === 1 && (
          <div className="s-card"><div className="s-body">
            <h2>Smallest project you’d take</h2>
            <p className="lead">Posts that offer less than this are skipped. Most freelancers doing this work start around {SYMBOL[currency]}{suggested.toLocaleString('en-IN')}.</p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
              <span className="cl-amount">{SYMBOL[currency]}{minProject.toLocaleString('en-IN')}</span>
              <select aria-label="Currency" value={currency} style={{ width: 'auto', marginLeft: 'auto' }}
                onChange={e => { const c = e.target.value as Profile['currency']; setCurrency(c); setMinProject(0); }}>
                {['INR', 'USD', 'EUR', 'GBP'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <input type="range" className="cl-range" aria-label="Smallest project" min={0} max={sliderMax} step={currency === 'INR' ? 1000 : 50}
              value={Math.min(minProject, sliderMax)} onChange={e => setMinProject(Number(e.target.value))} />
            <div className="cl-meta" style={{ marginTop: 10 }}>
              Or type it:
              <input type="number" min={0} value={minProject || ''} style={{ width: 140 }} aria-label="Smallest project amount"
                onChange={e => setMinProject(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
            </div>
          </div></div>
        )}

        {step === 2 && (
          <div className="s-card"><div className="s-body">
            <h2>Where can your clients be?</h2>
            <p className="lead">Posts that only want someone elsewhere are skipped. Pick from the list or type a country or city.</p>
            <ChipInput label="Client locations" value={locations} max={10} placeholder="Pick or type a place"
              suggestions={LOCATION_OPTIONS} format={placeLabel} onChange={setLocations} />
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, fontSize: 13.5 }}>
              <input type="checkbox" checked={remoteOk} onChange={e => setRemoteOk(e.target.checked)} />
              Remote clients from anywhere are fine too
            </label>
          </div></div>
        )}

        <div className="cl-setup-foot">
          {step > 0 ? <button className="btn" type="button" onClick={() => setStep(s => s - 1)}><i className="ti ti-arrow-left" /> Back</button> : <span />}
          {step < 2 ? (
            <button className="btn btn-primary" type="button" disabled={step === 0 ? !step1ok : !step2ok} onClick={() => setStep(s => s + 1)}>
              Next <i className="ti ti-arrow-right" />
            </button>
          ) : (
            <button className="btn btn-primary" type="button" disabled={!step3ok || saving || !base} onClick={finish}>
              {saving ? <><i className="ti ti-loader" /> Saving…</> : <>Find my first leads <i className="ti ti-arrow-right" /></>}
            </button>
          )}
        </div>
      </div>
    </Layout>
  );
}
