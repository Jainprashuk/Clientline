import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './context/SessionContext';
import { ToastProvider } from './context/ToastContext';
import './styles/pages.css';
import './styles/theme.css';
import './styles/responsive.css';
import './styles/polish.css';
import './styles/settings-redesign.css';
import './styles/leads-redesign.css';
import './styles/clientline.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/app">
      <SessionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
