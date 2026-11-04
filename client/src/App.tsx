import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './context/SessionContext';
import { SECTIONS } from './nav';
import ComingSoon from './pages/ComingSoon';

// Signed-out visitors go to the login page, which is served outside the SPA,
// so a router <Navigate> cannot reach it.
function SignedIn({ children }: { children: ReactNode }) {
  const { signedIn } = useSession();
  if (signedIn) return <>{children}</>;
  window.location.replace('/login');
  return null;
}

export default function App() {
  const { loading } = useSession();

  if (loading) {
    return (
      <div className="boot-screen" role="status" aria-live="polite">
        <div className="sidebar-logo-icon"><i className="ti ti-briefcase" /></div>
        <span>Loading your workspace…</span>
      </div>
    );
  }

  return (
    <Routes>
      {SECTIONS.map(s => (
        <Route key={s.path} path={s.path} element={<SignedIn><ComingSoon section={s} /></SignedIn>} />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
