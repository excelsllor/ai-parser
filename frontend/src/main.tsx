import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import App from '@app/App';

try {
  if (window.localStorage.getItem('cd_theme') === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  }
} catch {
  // Storage can be unavailable.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
