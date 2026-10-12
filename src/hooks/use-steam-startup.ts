import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { emit, listen } from "@tauri-apps/api/event";
// Static import: window-resize-handles already pulls this in statically anyway.
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { useServerStore } from "@/stores/server-store";
import {
  steamInit,
  asSteamInitError,
  steamConnectionState,
  discoverServers,
  logClient,
  type SteamInitError,
  type SteamInitFailure,
} from "@/lib/tauri";
import type { SplashScreenProps } from "@/components/splash-screen";

/** Interval between Steam-availability rechecks while it's down. */
const STEAM_RETRY_MS = 4000;

/** Poll interval for detecting a lost Steam connection (cheap local check). */
const CONNECTION_POLL_MS = 3000;

/** Let "Ready — 100%" show briefly before revealing the launcher. */
const SPLASH_READY_MS = 400;

/** Hard ceiling so a stuck backend can never leave the splash up forever. */
const SPLASH_FAILSAFE_MS = 120_000;

/** The splash milestone shown while discovery streams. */
const FETCHING_STATUS = "Fetching servers from Steam…";

/** The splash's live "Found N servers" detail line. */
function splashDetail(found: number): string | undefined {
  return found > 0 ? `Found ${found.toLocaleString()} servers` : undefined;
}

export function useSteamStartup({
  registryReadyHandled,
  setRefreshedAt,
}: {
  registryReadyHandled: RefObject<boolean>;
  setRefreshedAt: (value: string) => void;
}) {
  const triggerReload = useServerStore((s) => s.triggerReload);
  const serverCount = useServerStore((s) => s.servers.length);
  const mapsLoaded = useServerStore((s) => s.mapsLoaded);
  const hasLoadedOnce = useServerStore((s) => s.hasLoadedOnce);
  const loadError = useServerStore((s) => s.loadError);

  const [steamConnected, setSteamConnected] = useState(false);
  const [steamError, setSteamError] = useState<SteamInitError | null>(null);
  const [connecting, setConnecting] = useState(false);
  const connectInFlight = useRef(false);
  /** Consecutive failed attempts, reset whenever the failure kind changes. */
  const steamAttempts = useRef<{
    kind: SteamInitFailure;
    count: number;
  } | null>(null);
  const [autoRetryExhausted, setAutoRetryExhausted] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  /** Set the moment discovery starts; stays true for the session. The splash
      uses it to tell "connected but not yet fetching" from "really done". */
  const [discoveryStarted, setDiscoveryStarted] = useState(false);
  /** Latest `discovery-progress` count, for the splash's "Found N servers" line. */
  const discovered = useRef(0);

  // First population after Steam connects. Skips the bulk A2S probe so the
  // table paints immediately from Steam's own data; mod counts and live
  // pings arrive once the user hits REFRESH.
  const runInitialLoad = useCallback(async () => {
    void logClient("startup", "runInitialLoad: start");
    setDiscoveryStarted(true);
    setDiscovering(true);
    try {
      await discoverServers();
    } catch (e) {
      void logClient(
        "startup",
        "runInitialLoad: discovery threw: " + String(e),
      );
      console.error("Discovery failed:", e);
    } finally {
      setDiscovering(false);
    }

    void logClient(
      "startup",
      "runInitialLoad: discovery settled, dispatching final reload",
    );
    triggerReload();
    setRefreshedAt(new Date().toLocaleTimeString());
  }, [triggerReload, setRefreshedAt]);

  // Extracted from the mount effect so Retry and the automatic recheck run
  // the same path as the first attempt.
  const connectSteam = useCallback(
    async (manual = false) => {
      // Ref rather than state: needs to be accurate at call time, not last render.
      if (connectInFlight.current) return;
      connectInFlight.current = true;
      // Manual retry resets the auto-retry budget.
      if (manual) {
        steamAttempts.current = null;
        setAutoRetryExhausted(false);
      }
      setConnecting(true);
      try {
        await steamInit();
        setSteamConnected(true);
        setSteamError(null);
        steamAttempts.current = null;
        setAutoRetryExhausted(false);
        triggerReload();
        void runInitialLoad();
      } catch (e) {
        // Fresh object per attempt, so the retry effect re-arms even on an
        // identical failure.
        const failure = asSteamInitError(e);
        const prior = steamAttempts.current;
        const count = prior?.kind === failure.kind ? prior.count + 1 : 1;
        steamAttempts.current = { kind: failure.kind, count };

        setSteamConnected(false);
        setSteamError(failure);
        setAutoRetryExhausted(
          failure.autoRetryLimit !== null && count >= failure.autoRetryLimit,
        );
      } finally {
        connectInFlight.current = false;
        setConnecting(false);
      }
    },
    [triggerReload, runInitialLoad],
  );

  useEffect(() => {
    void connectSteam();
    // Mount only: retries go through the prompt, not through a dependency
    // change on this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check on a timer while Steam is down, bounded by autoRetryLimit.
  useEffect(() => {
    if (steamConnected || !steamError?.autoRetry || autoRetryExhausted) return;
    const timer = window.setTimeout(() => {
      void connectSteam();
    }, STEAM_RETRY_MS);
    return () => clearTimeout(timer);
  }, [steamConnected, steamError, autoRetryExhausted, connectSteam]);

  // Live-monitor the connection once it's up; stops on the first drop.
  useEffect(() => {
    if (!steamConnected) return;
    let cancelled = false;
    let failureLogged = false;
    const timer = window.setInterval(() => {
      void steamConnectionState()
        .then((up) => {
          if (cancelled || up) return;
          setSteamConnected(false);
          setSteamError({
            kind: "disconnected",
            message:
              "The connection to Steam was lost while the launcher was running.",
            autoRetry: false,
            autoRetryLimit: 0,
          });
        })
        .catch((e) => {
          // A failed check says nothing about the connection; log once and keep polling.
          if (failureLogged) return;
          failureLogged = true;
          console.error("Steam connection check failed:", e);
          void logClient("steam", `connection check failed: ${String(e)}`);
        });
    }, CONNECTION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [steamConnected]);

  // ── Startup splash (separate window) ────────────────────────────
  // `main` stays hidden until startup is ready or Steam fails; the last
  // clause lets a genuinely empty result dismiss once discovery finishes.
  const startupReady =
    steamConnected &&
    mapsLoaded &&
    hasLoadedOnce &&
    (serverCount > 0 || (discoveryStarted && !discovering));

  // Reveals main and closes the splash exactly once — a second call would
  // rip focus back from the game, so `revealDone` gates any re-fire.
  const revealDone = useRef(false);
  const revealLauncherWhenReady = useCallback(() => {
    if (revealDone.current) return;
    revealDone.current = true;
    void (async () => {
      const self = getCurrentWindow();
      try {
        await self.show();
        await self.setFocus();
      } catch (e) {
        console.error("Could not reveal the launcher window:", e);
      }
      // Close splash only after main is shown, to avoid a bare-desktop frame.
      try {
        const windows = await getAllWindows();
        await windows.find((w) => w.label === "splash")?.close();
      } catch (e) {
        console.error("Could not close the splash window:", e);
      }
    })();
  }, []);

  // A connect already in flight is not shown as a failure while auto-retry runs.
  const shownSteamError =
    steamError?.kind === "already_initialising" && !autoRetryExhausted ? null : steamError;

  // Let "Ready" show briefly, then reveal; Steam or a post-registry list failure forces it.
  useEffect(() => {
    if (!(startupReady || shownSteamError || (registryReadyHandled.current && loadError)))
      return;
    const t = window.setTimeout(revealLauncherWhenReady, SPLASH_READY_MS);
    return () => clearTimeout(t);
  }, [startupReady, shownSteamError, loadError, revealLauncherWhenReady, registryReadyHandled]);

  // Fail-safe: a pathological backend must never leave the launcher hidden
  // behind a static splash, so always reveal it eventually.
  useEffect(() => {
    const t = window.setTimeout(revealLauncherWhenReady, SPLASH_FAILSAFE_MS);
    return () => clearTimeout(t);
  }, [revealLauncherWhenReady]);

  // Status/% milestones in startup order; percentages are markers, not live progress.
  const splash: SplashScreenProps = (() => {
    if (!steamConnected) {
      return { status: "Connecting to Steam…", pct: 15 };
    }
    if (!discoveryStarted || discovering) {
      return {
        status: FETCHING_STATUS,
        pct: 45,
        detail: splashDetail(discovered.current),
      };
    }
    if (serverCount === 0) {
      return { status: "Propagating server list…", pct: 70 };
    }
    if (!mapsLoaded) {
      return { status: "Loading server maps…", pct: 95 };
    }
    return { status: "Ready", pct: 100 };
  })();

  // Publish the current milestone to the splash window as it changes.
  const latestSplash = useRef(splash);
  const emitSplash = useCallback((detail?: string) => {
    const current = latestSplash.current;
    void emit("splash-progress", {
      status: current.status,
      detail: detail ?? current.detail,
      pct: current.pct,
    });
  }, []);
  useEffect(() => {
    latestSplash.current = splash;
    emitSplash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splash.status, splash.detail, splash.pct]);

  // Logged from its own effect, keyed on the milestone alone: `detail` ticks
  // with every discovery-progress event, which wrote ~8k identical lines a
  // pass.
  useEffect(() => {
    void logClient(
      "splash",
      `milestone ${splash.pct}% "${splash.status}" servers=${serverCount}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splash.status, splash.pct]);

  // Replay the current milestone when the splash announces itself — it may
  // miss early events while still registering its listener.
  useEffect(() => {
    const pending = listen("splash-ready", () => {
      emitSplash();
    });
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, [emitSplash]);

  const onDiscoveryProgress = useCallback(
    (found: number) => {
      discovered.current = found;
      // Keep the milestone's detail current for a late splash-ready replay.
      const detail = splashDetail(found);
      latestSplash.current = { ...latestSplash.current, detail };
      if (!revealDone.current && latestSplash.current.status === FETCHING_STATUS) {
        emitSplash(detail);
      }
    },
    [emitSplash],
  );

  return {
    steamConnected,
    steamError: shownSteamError,
    connecting,
    autoRetryExhausted,
    connectSteam,
    discovering,
    runInitialLoad,
    revealDone,
    onDiscoveryProgress,
  };
}
