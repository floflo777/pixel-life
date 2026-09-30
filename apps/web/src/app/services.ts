/**
 * Page-wide singletons: the API, identity, settings, audio, local progress, toasts and the confirm dialog queue.
 * Components read them through `useServices()`; tests build their own with `createServices()`.
 */
import { createContext, useContext } from "react";
import { createApi, type Api } from "../api/client.js";
import { createIdentity, type IdentityController } from "../identity/store.js";
import { createProgressBook, type ProgressBook } from "../meta/progress.js";
import { createShellAudio, type ShellAudio } from "../settings/audio.js";
import { createSettings, type Settings } from "../settings/settings.js";
import { createStore, type Store } from "../lib/store.js";

/** A transient message in the toast area (`role="status"`). */
export interface Toast {
  id: number;
  text: string;
  tone: "info" | "good" | "bad";
}

/** A pending confirmation shown by the shell (host-confirmed economy, architecture §1b.2). */
export interface Confirmation {
  title: string;
  /** Body lines (price, split, effect). */
  lines: readonly string[];
  /** Always shown in the footer note: simulated vs live. */
  note: string;
  confirmLabel: string;
  resolve(ok: boolean): void;
}

/** Everything the shell shares. */
export interface Services {
  api: Api;
  identity: IdentityController;
  settings: Store<Settings>;
  audio: ShellAudio;
  progress: ProgressBook;
  toasts: Store<readonly Toast[]>;
  confirmations: Store<Confirmation | null>;
  toast(text: string, tone?: Toast["tone"]): void;
  /** Shows the confirm dialog; resolves true on confirm, false on cancel. One at a time. */
  confirm(c: Omit<Confirmation, "resolve">): Promise<boolean>;
}

let toastSeq = 0;

/** Builds the service graph. `not_owner` from any endpoint drops the binding so the player re-picks. */
export function createServices(): Services {
  const settings = createSettings();
  const toasts = createStore<readonly Toast[]>([]);
  const confirmations = createStore<Confirmation | null>(null);
  const toast = (text: string, tone: Toast["tone"] = "info"): void => {
    const id = ++toastSeq;
    toasts.set((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => toasts.set((t) => t.filter((x) => x.id !== id)), 5000);
  };
  // `identity` is created after `api`, which only needs it lazily in the callbacks.
  let identity: IdentityController | null = null;
  const api = createApi({
    onNotOwner: () => identity?.dropOwner("The chain says this wallet no longer owns that Friend. Pick again."),
  });
  identity = createIdentity();
  return {
    api,
    identity,
    settings,
    audio: createShellAudio(settings),
    progress: createProgressBook(),
    toasts,
    confirmations,
    toast,
    confirm(c) {
      confirmations.get()?.resolve(false);
      return new Promise<boolean>((resolve) => {
        confirmations.set({
          ...c,
          resolve: (ok) => {
            confirmations.set(null);
            resolve(ok);
          },
        });
      });
    },
  };
}

/** React context carrying the services. */
export const ServicesContext = createContext<Services | null>(null);

/** The shell services (throws outside the provider: a wiring bug). */
export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error("useServices() outside <ServicesContext>");
  return s;
}
