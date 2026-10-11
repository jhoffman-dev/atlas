import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import {
  resolveActivityPorts,
  resolveAppInfoPort,
  resolveExternalLinks,
  resolveGoogleCalendar,
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
    />
  </StrictMode>,
);
