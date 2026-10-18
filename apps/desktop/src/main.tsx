import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import {
  resolveActivityPorts,
  resolveAppInfoPort,
  resolveExternalLinks,
  resolveGlobalCapture,
  resolveGoogleCalendar,
  resolveGranola,
  resolveIndexPorts,
  resolveLocalApiPorts,
  resolveChatPorts,
  resolveNotePorts,
  resolvePageSnapshot,
  resolveSourcePorts,
  resolveSyncPorts,
  resolveVaultPorts,
} from './composition.ts';
import { guardStrayFileDrops } from './file-drop-guard.ts';
import { preloadPages } from './pages-on-first-use.ts';
import '@fontsource-variable/manrope';
import './styles.css';

guardStrayFileDrops(window);

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');

createRoot(root).render(
  <StrictMode>
    <App
      appInfo={resolveAppInfoPort()}
      vault={resolveVaultPorts()}
      notes={resolveNotePorts()}
      index={resolveIndexPorts()}
      sources={resolveSourcePorts()}
      links={resolveExternalLinks()}
      snapshot={resolvePageSnapshot()}
      api={resolveLocalApiPorts()}
      chat={resolveChatPorts()}
      activity={resolveActivityPorts()}
      sync={resolveSyncPorts()}
      googleCalendar={resolveGoogleCalendar()}
      granola={resolveGranola()}
      globalCapture={resolveGlobalCapture()}
    />
  </StrictMode>,
);

// The pages not on the start path load after start-up, so they open without a
// fallback yet never hold up the first paint.
if (document.readyState === 'complete') void preloadPages();
else window.addEventListener('load', () => void preloadPages(), { once: true });
