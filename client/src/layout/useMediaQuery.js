import { useCallback, useSyncExternalStore } from 'react';

// True while `query` matches. Where matchMedia is missing (old browsers, jsdom in tests) it
// returns `fallback`, which is the wide layout for the min-width queries in breakpoints.js.
export function useMediaQuery(query, fallback = true) {
  const subscribe = useCallback(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );

  const getSnapshot = () =>
    typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback;

  return useSyncExternalStore(subscribe, getSnapshot, () => fallback);
}
