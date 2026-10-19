import { useSyncExternalStore } from 'react';

/** From this width the app uses the desktop layout (sidebar, side-by-side Home); below it, the phone layout. */
const DESKTOP = '(min-width: 1000px)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia?.(DESKTOP);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

const isDesktop = () => window.matchMedia?.(DESKTOP).matches === true;

/** True on a wide screen; follows the window as it is resized. */
export function useDesktop(): boolean {
  return useSyncExternalStore(subscribe, isDesktop, () => false);
}
