/**
 * The shell layout: skip link, HUD, the routed screen (lazy, with loading / error / retry), identity notices, the host
 * confirm dialog and toasts. Also runs the background `/api/me` sync (boot, focus, every 60 s for owners).
 */
import { Component, type ErrorInfo, lazy, type ReactNode, Suspense, useEffect, useMemo } from "react";
import { type PageModule, type RouteDef, loaderOf, resolveRoute } from "../app/routes.js";
import { useServices } from "../app/services.js";
import { syncMe } from "../identity/bootstrap.js";
import { useLocation } from "../lib/router.js";
import { useStore } from "../lib/store.js";
import { reducedMotionOf } from "../settings/settings.js";
import { Button, ErrorBox, Loading } from "../ui/kit.js";
import { Hud } from "./Hud.js";
import { ConfirmHost, Toasts } from "./overlays.js";
import { NotFound, PagePending } from "./placeholders.js";

/** Catches a crashed screen (or a failed chunk download) and offers a retry without reloading the shell. */
class ScreenBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("screen crashed", error, info.componentStack);
  }
  override render() {
    if (this.state.error)
      return (
        <div className="page">
          <ErrorBox
            message="This screen failed to load. Check your connection and retry."
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      );
    return this.props.children;
  }
}

const lazyCache = new Map<RouteDef, ReturnType<typeof lazy<PageModule["default"]>>>();
function screenOf(r: RouteDef) {
  let c = lazyCache.get(r);
  if (!c) {
    const load = loaderOf(r);
    if (!load) return null;
    // A failed chunk load is not cached, so "retry" in the boundary downloads it again.
    c = lazy(() =>
      load().catch((e: unknown) => {
        lazyCache.delete(r);
        throw e;
      }),
    );
    lazyCache.set(r, c);
  }
  return c;
}

/** Identity notices (account changed, session ended): dismissible, announced politely. */
function Notice() {
  const { identity } = useServices();
  const { notice } = useStore(identity.store);
  if (!notice) return null;
  return (
    <div className="notice" role="status">
      <p>{notice}</p>
      <Button variant="quiet" onClick={() => identity.clearNotice()} aria-label="Dismiss notice">
        ×
      </Button>
    </div>
  );
}

/** The whole app below the services provider. */
export function App() {
  const services = useServices();
  const loc = useLocation();
  const settings = useStore(services.settings);
  const match = useMemo(() => resolveRoute(loc.pathname), [loc.pathname]);
  const { identity } = useStore(services.identity.store);

  useEffect(() => {
    document.title = match && match.route.name !== "landing" ? `${match.route.title} · Pixel Life` : "Pixel Life";
  }, [match]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotionOf(settings));
    document.documentElement.dataset.noFlash = String(settings.noFlash);
  }, [settings]);

  // Owner session restore on boot; for owners also on focus and every minute (inbox badge, balance, scars).
  useEffect(() => {
    void syncMe(services);
  }, [services]);
  useEffect(() => {
    if (identity.mode !== "owner") return;
    const tick = (): void => void syncMe(services);
    const t = setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", tick);
    };
  }, [identity.mode, services]);

  const Screen = match ? screenOf(match.route) : null;
  const bleed = match?.route.bleed ?? false;
  return (
    <>
      <a className="skip-link" href="#main">
        skip to content
      </a>
      <Hud current={match?.route.name ?? null} />
      <Notice />
      <main id="main" className={bleed ? "main main-bleed" : "main"} tabIndex={-1}>
        <ScreenBoundary resetKey={loc.pathname}>
          <Suspense fallback={<Loading label="loading" />}>
            {!match ? (
              <NotFound path={loc.pathname} />
            ) : Screen ? (
              <Screen params={match.params} search={loc.search} />
            ) : (
              <PagePending route={match.route} />
            )}
          </Suspense>
        </ScreenBoundary>
      </main>
      <ConfirmHost />
      <Toasts />
    </>
  );
}
