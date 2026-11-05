import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './context/SessionContext';
import { SECTIONS } from './nav';
import ComingSoon from './pages/ComingSoon';
import Connections from './pages/Connections';
import Profile from './pages/Profile';
import Leads from './pages/Leads';
import Setup from './pages/Setup';
import Outreach from './pages/Outreach';
import Inbox from './pages/Inbox';
import Deals from './pages/Deals';
import Proposals from './pages/Proposals';
import Invoices from './pages/Invoices';
import Work from './pages/Work';
import SendWidget from './components/SendWidget';

// Built sections; every other one is still a ComingSoon placeholder.
const PAGES: Record<string, () => JSX.Element> = {
  '/connections': Connections,
  '/profile': Profile,
  '/leads': Leads,
  '/outreach': Outreach,
  '/inbox': Inbox,
  '/deals': Deals,
  '/proposals': Proposals,
  '/invoices': Invoices,
  '/work': Work,
};

// Signed-out visitors go to the login page, which is served outside the SPA,
// so a router <Navigate> cannot reach it.
function SignedIn({ children }: { children: ReactNode }) {
  const { signedIn } = useSession();
  if (signedIn) return <>{children}</>;
  window.location.replace('/login');
  return null;
}

export default function App() {
  const { loading, signedIn } = useSession();

  if (loading) {
    return (
      <div className="boot-screen" role="status" aria-live="polite">
        <div className="sidebar-logo-icon"><i className="ti ti-briefcase" /></div>
        <span>Loading your workspace…</span>
      </div>
    );
  }

  return (
    <>
    <Routes>
      {SECTIONS.map(s => (
        <Route key={s.path} path={s.path} element={<SignedIn>{(() => { const Page = PAGES[s.path]; return Page ? <Page /> : <ComingSoon section={s} />; })()}</SignedIn>} />
      ))}
      {/* Not in the sidebar: reached from Leads while the profile is empty. */}
      <Route path="/setup" element={<SignedIn><Setup /></SignedIn>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    {signedIn && <SendWidget />}
    </>
  );
}
