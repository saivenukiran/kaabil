/**
 * One shared state object, saved in this browser only (localStorage). Two tabs of the
 * app, one as the person and one as the family, stay in sync through the `storage`
 * event. Nothing leaves the device and no audio is ever stored.
 */
import { useSyncExternalStore } from 'react';
import { initialState } from './dose/engine';
import type { AppState } from './types';

const KEY = 'kaabil.prototype.state.v1';

function isState(x: unknown): x is AppState {
  const s = x as Partial<AppState> | null;
  return !!s && s.v === 1 && Array.isArray(s.medicines) && Array.isArray(s.doses) && Array.isArray(s.outbox) && typeof s.clockMs === 'number';
}

function load(): AppState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isState(parsed)) return parsed;
    }
  } catch {
    // Storage blocked or corrupted: start from the demo seed.
  }
  return initialState();
}

let state: AppState = load();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

function persist(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or quota: the app keeps working in memory.
  }
}

export function getState(): AppState {
  return state;
}

export function update(fn: (s: AppState) => AppState): void {
  state = fn(state);
  persist();
  notify();
}

export function resetDemo(): void {
  update(() => initialState());
}

window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    state = load();
    notify();
  }
});

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}
