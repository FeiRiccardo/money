import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './app/App';
import { DriveProvider } from './app/drive';
import { takeRedirect } from './app/googleDrive';
import { StoreProvider } from './app/store';
import { trackViewport } from './app/viewport';
import './i18n';
import './styles.css';

registerSW({ immediate: true });
trackViewport();
// Before the first render, and only once: a return from Google's consent page carries the token.
const arrival = takeRedirect();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <DriveProvider arrival={arrival}>
        <App />
      </DriveProvider>
    </StoreProvider>
  </StrictMode>,
);
