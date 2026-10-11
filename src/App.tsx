import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { WindowResizeHandles } from "./components/window-resize-handles";
import { SettingsHost, SettingsRegionPortal } from "./theme/interaction/settings-host";
import { ModalHost } from "./theme/interaction/modal-host";
import type { LayoutFile, ModalLayoutFile, SettingsLayoutFile } from "./theme/renderer/types";
import { DevModeInspector } from "./components/themes-page/DevModeInspector";
import { DevModeValidationPanel } from "./components/themes-page/DevModeValidationPanel";
import { ConfirmDialog } from "./components/confirm-dialog";
import { OnboardingModal } from "./components/onboarding-modal";
import { SteamRequiredModal } from "./components/steam-required-modal";
import { useServerStore } from "./stores/server-store";
import { useSettingsStore } from "./stores/settings-store";
import { useUpdateStore } from "./stores/update-store";
import { useModsStore } from "./stores/mods-store";
import { useShallow } from "zustand/react/shallow";
import { useModFilterStore, activeEntries } from "./stores/mod-filter-store";
import { useModFilterLifecycle } from "./hooks/use-mod-filter-lifecycle";
import { useSteamStartup } from "./hooks/use-steam-startup";
import { useBackendEvents } from "./hooks/use-backend-events";
import { useRefreshLoops } from "./hooks/use-refresh-loops";
import type { SettingsValues } from "./theme/renderer/props";
import { watchDayz } from "./stores/launch-store";
import {
  useThemeStore,
  useLayoutSubscription,
  watchHotReload,
  watchThemeActivationReverted,
  getActiveLayout,
} from "./theme/theme-store";
import { FallbackNotice } from "./theme/fallback/fallback-notice";
import { NoticeLaunch } from "./theme/elements/notice-elements";
import { isElementInLayout } from "./theme/layout-query";
import { IncompatibleThemeNotice } from "./theme/fallback/incompatible-theme-notice";
import { useVisibilityCheck } from "./theme/fallback/use-visibility-check";
import {
  ElementContextProvider,
  SubjectContextProvider,
  useElementContext,
  type ViewId,
} from "./theme/elements/context";
import { ModsViewHost } from "./theme/elements/mods-view-host";
import { LayoutRenderer } from "./theme/renderer";
import { useServerDataLoader } from "./hooks/use-server-data-loader";
import type { Server } from "./types/server";
import { watchActiveTheme, stopWatchingTheme } from "./lib/tauri";
import { getVersion } from "@tauri-apps/api/app";

/** No urgency on release checks, so this stays infrequent. */
const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;

/** Catches a subscribe made outside the launcher without reopening the Mods tab. */
const MODS_RECHECK_MS = 5 * 60 * 1000;

/** Neutral backs every engine path, so the active file is never missing. */
function engineLayout<T extends LayoutFile = LayoutFile>(path: string): T {
  return getActiveLayout(path) as T;
}

export function App() {
  const [activeView, setActiveView] = useState<ViewId>("servers");
  /** The row whose ⋯ menu asked for "More info" — drives the M1 modal. */
  const [infoServer, setInfoServer] = useState<Server | null>(null);
  const [modFilterOpen, setModFilterOpen] = useState(false);
  // The fallback notice is dismissed per launcher version (§16.1).
  const [launcherVersion, setLauncherVersion] = useState<string | undefined>(undefined);
  const setFilter = useServerStore((s) => s.setFilter);
  const loadError = useServerStore((s) => s.loadError);

  // Each tab is a filter preset, not just a highlight toggle.
  const handleViewChange = useCallback(
    (view: ViewId) => {
      setActiveView(view);
      setSettingsOpen(false);
      setFilter({
        favourites_only: view === "fav",
        recent_only: view === "recent",
      });
    },
    [setFilter],
  );
  const [refreshing, setRefreshing] = useState(false);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const profileName = useSettingsStore((s) => s.profileName);
  const dayzPath = useSettingsStore((s) => s.dayzPath);
  const onboardingDismissed = useSettingsStore((s) => s.onboardingDismissed);

  // Decided once, off the settings snapshot from the moment they finish
  // loading — re-deriving this on every render would hide the modal the
  // instant it fills in the very fields it's asking about.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const onboardingDecided = useRef(false);
  useEffect(() => {
    if (onboardingDecided.current || !settingsLoaded) return;
    onboardingDecided.current = true;
    if (
      !onboardingDismissed &&
      profileName.trim() === "" &&
      dayzPath === null
    ) {
      setShowOnboarding(true);
    }
  }, [settingsLoaded, onboardingDismissed, profileName, dayzPath]);
  const [error, setError] = useState<string | null>(null);
  // One-shot: the backend's registry may not be open yet when the first queries run.
  const registryReadyHandled = useRef(false);
  // A failed list load shows like a failed action.
  const shownError = error ?? (registryReadyHandled.current ? loadError : null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Session-only dev aid: the inspector must outlive the Settings overlay
  // (and a sidebar nav click) to reach the shell slots it inspects, and a
  // reload deliberately puts it back off. Not persisted anywhere.
  const [devMode, setDevMode] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  // Dismissed for this session only; returns next launch if still pending.
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);

  // Load persisted settings before anything can overwrite them.
  const loadSettings = useSettingsStore((s) => s.load);
  const flushSettings = useSettingsStore((s) => s.flush);

  // Independent of Steam — just a GitHub request.
  const resolveInstalled = useUpdateStore((s) => s.resolveInstalled);
  const checkForUpdates = useUpdateStore((s) => s.checkNow);
  const updateAvailable = useUpdateStore((s) => s.available);

  useEffect(() => {
    void resolveInstalled();
    void checkForUpdates();
    const timer = window.setInterval(
      () => void checkForUpdates(),
      UPDATE_RECHECK_MS,
    );
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // App-level, not the Mods tab, so the Browse Workshop modal stays fresh too.
  const loadMods = useModsStore((s) => s.load);
  useEffect(() => {
    void loadMods();
    const timer = window.setInterval(() => void loadMods(), MODS_RECHECK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // App-level so "is DayZ running" survives the details panel unmounting.
  useEffect(() => watchDayz(), []);

  // Puts the palette back when the activation guard window reverts or times out.
  useEffect(() => watchThemeActivationReverted(), []);

  // Re-reads the active theme's files whenever the Dev Mode watch reports a change.
  useEffect(() => watchHotReload(), []);

  useEffect(() => {
    void getVersion()
      .then((version) => setLauncherVersion(version || undefined))
      .catch(() => undefined);
  }, []);

  const activeId = useThemeStore((s) => s.activeId);
  const settingsValues = useThemeStore((s) => s.settingsValues);
  const selectedServer = useServerStore((s) => s.selectedServer);
  const modsRows = useModsStore((s) => s.rows);
  const selectedModId = useModsStore((s) => s.selectedModId);
  const selectedModRow = modsRows.find((r) => r.workshop_id === selectedModId) ?? null;
  useServerDataLoader();
  useLayoutSubscription();

  // Each screen's file: the active theme's own, else Neutral's.
  const shellLayout = engineLayout("layout/shell.json");
  const browserLayout = engineLayout("layout/views/browser.json");
  const modsLayout = engineLayout("layout/views/mods.json");
  const settingsLayout = engineLayout<SettingsLayoutFile>("layout/settings.json");
  const serverInfoModal = engineLayout<ModalLayoutFile>("layout/modals/serverInfo.json");
  const modFilterModal = engineLayout<ModalLayoutFile>("layout/modals/modFilter.json");
  const updateModal = engineLayout<ModalLayoutFile>("layout/modals/update.json");
  const browserPlaces = (element: string) => isElementInLayout(browserLayout, element);
  const settingsMode = settingsLayout.presentation?.mode ?? "overlay";

  // SPEC §15: runs the visibility check whenever the screen composition changes.
  useVisibilityCheck({
    activeView,
    settingsOpen,
    settingsPresentation: settingsMode,
    openModals: [
      infoServer ? "serverInfo" : null,
      modFilterOpen ? "modFilter" : null,
      updateOpen ? "update" : null,
    ].filter((id): id is string => id !== null),
  });

  // Dev Mode's watch: the cleanup stops the previous one, so turning Dev Mode
  // off or switching theme replaces rather than accumulates.
  useEffect(() => {
    if (!devMode) return;
    void watchActiveTheme(activeId).catch((e) => {
      console.error(`Could not watch theme "${activeId}" for changes:`, e);
    });
    return () => {
      void stopWatchingTheme();
    };
  }, [devMode, activeId]);

  // A pending debounced write would otherwise be lost when the window closes.
  useEffect(() => {
    const onHide = () => {
      void flushSettings();
    };
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flushSettings]);

  const {
    steamConnected,
    steamError,
    connecting,
    autoRetryExhausted,
    connectSteam,
    discovering,
    runInitialLoad,
    revealDone,
    onDiscoveryProgress,
  } = useSteamStartup({ registryReadyHandled, setRefreshedAt });
  const { counts, listSource, storageDegraded } = useBackendEvents({
    discovering,
    revealDone,
    onDiscoveryProgress,
    registryReadyHandled,
    setError,
    setRefreshing,
    setRefreshedAt,
    handleViewChange,
  });
  const { handleRefresh } = useRefreshLoops({
    steamConnected,
    runInitialLoad,
    setError,
    setRefreshing,
    setRefreshedAt,
  });

  const onOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const onCloseSettings = useCallback(() => setSettingsOpen(false), []);

  const openModFilter = useCallback(() => {
    useModFilterStore.getState().begin();
    setModFilterOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (infoServer) setInfoServer(null);
    else if (modFilterOpen) setModFilterOpen(false);
    else if (updateOpen) setUpdateOpen(false);
  }, [infoServer, modFilterOpen, updateOpen]);

  const dismissError = useCallback(() => {
    // Clear only what the banner is showing.
    if (error) setError(null);
    else useServerStore.getState().setLoadError(null);
  }, [error]);
  const dismissUpdateBanner = useCallback(() => setUpdateBannerDismissed(true), []);
  const openUpdateModal = useCallback(() => setUpdateOpen(true), []);

  // Every field a themed element can read; rebuilt only when one changes.
  const elementContextValue = useMemo(
    () => ({
      activeView,
      onViewChange: handleViewChange,
      settingsOpen,
      onOpenSettings,
      onCloseSettings,
      error: shownError,
      dismissError,
      storageDegraded,
      serverCounts: counts,
      refreshedAt,
      steamConnected,
      listSource,
      updateAvailable,
      updateBannerDismissed,
      dismissUpdateBanner,
      openUpdateModal,
      // A panel-mode Settings covers the detail panel, so hide it until Settings closes.
      selectedServer: settingsOpen && settingsMode === "panel" ? null : selectedServer,
      selectedMod: settingsOpen && settingsMode === "panel" ? null : selectedModRow,
      onRefresh: handleRefresh,
      refreshing,
      discovering,
      devMode,
      onDevModeChange: setDevMode,
      openServerInfo: setInfoServer,
      openModFilter,
      modFilterOpen,
      closeModal,
      themeId: activeId,
    }),
    [
      activeView,
      handleViewChange,
      settingsOpen,
      onOpenSettings,
      onCloseSettings,
      shownError,
      dismissError,
      storageDegraded,
      counts,
      refreshedAt,
      steamConnected,
      listSource,
      updateAvailable,
      updateBannerDismissed,
      dismissUpdateBanner,
      openUpdateModal,
      settingsMode,
      selectedServer,
      selectedModRow,
      handleRefresh,
      refreshing,
      discovering,
      devMode,
      openModFilter,
      modFilterOpen,
      closeModal,
      activeId,
    ],
  );

  // Harness-only: the headless UI harness has no other way to reach this state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Only the harness defines this, before App loads; the prod-build harness has no DEV flag.
    if (!("__harness" in window)) return;
    (window as unknown as { __harness?: Record<string, unknown> }).__harness = {
      openServerInfo: setInfoServer,
      openModFilter,
      openUpdateModal,
      closeModal,
    };
  });

  const modsView = (
    <ModsViewHost file={modsLayout} themeId={activeId} settings={settingsValues[activeId]} />
  );
  const engineBrowser = (
    <LayoutRenderer file={browserLayout} themeId={activeId} settings={settingsValues[activeId]} />
  );

  const modalLayer = (
    <>
      {devMode && <DevModeInspector />}
      {devMode && <DevModeValidationPanel />}
      {showOnboarding && steamConnected && (
        <OnboardingModal onDone={() => setShowOnboarding(false)} />
      )}
      {updateOpen && (
        <ModalHost
          file={updateModal}
          label="Update"
          initialFocus='[data-el="update.install"], [data-el="update.viewRelease"]'
          themeId={activeId}
          settings={settingsValues[activeId]}
          onClose={() => setUpdateOpen(false)}
        />
      )}
      {infoServer && (
        <SubjectContextProvider
          subject={{ kind: "server", data: infoServer }}
          contextName="modal"
        >
          <ModalHost
            file={serverInfoModal}
            label={`Server info: ${infoServer.name || infoServer.addr}`}
            initialFocus='[data-el="server.join"]'
            themeId={activeId}
            settings={settingsValues[activeId]}
            onClose={() => setInfoServer(null)}
          />
        </SubjectContextProvider>
      )}
      {modFilterOpen && (
        <ThemedModFilterModal
          file={modFilterModal}
          themeId={activeId}
          settings={settingsValues[activeId]}
          onClose={() => setModFilterOpen(false)}
        />
      )}
      {/* Blocking: nothing works without Steam. */}
      {!steamConnected && steamError && (
        <SteamRequiredModal
          error={steamError}
          checking={connecting}
          exhausted={autoRetryExhausted}
          onRetry={() => void connectSteam(true)}
        />
      )}
      <ConfirmDialog />
    </>
  );

  return (
    <ElementContextProvider value={elementContextValue}>
      <div className="relative flex h-screen flex-col overflow-hidden [border-radius:var(--t-radius-window)] border border-line bg-bg">
        <WindowResizeHandles />

        {activeId !== "neutral" && (
          <FallbackNotice themeId={activeId} launcherVersion={launcherVersion} />
        )}
        <IncompatibleThemeNotice />

        {/* Rows never show a join result, so a themed shell without the bar still gets one. */}
        {!isElementInLayout(shellLayout, "notice.launch") &&
          !browserPlaces("notice.launch") && <NoticeLaunch />}

        <div className="flex min-h-0 flex-1 flex-col">
          <LayoutRenderer
            file={shellLayout}
            themeId={activeId}
            settings={settingsValues[activeId]}
            outlets={{
              view:
                settingsOpen && settingsMode === "view" ? (
                  <SettingsSurface layout={settingsLayout} placement="outlet" onClose={onCloseSettings} />
                ) : activeView === "mods" ? (
                  modsView
                ) : (
                  engineBrowser
                ),
              modals: modalLayer,
            }}
          />
        </div>
        {settingsOpen && <SettingsSurface layout={settingsLayout} onClose={onCloseSettings} />}
      </div>
    </ElementContextProvider>
  );
}

export interface SettingsSurfaceProps {
  /** The active theme's `layout/settings.json`, or Neutral's when the theme's own is missing or fell back. */
  layout: SettingsLayoutFile;
  /** `outlet` draws `view` Settings where the shell's view outlet goes; the default hosts overlay/panel Settings beside the shell. */
  placement?: "outlet" | "overlay";
  onClose: () => void;
}

/** Settings from the shell's `settings.json`: the view outlet for `view` mode, else beside the shell. */
export function SettingsSurface({ layout, placement = "overlay", onClose }: SettingsSurfaceProps) {
  const mode = layout.presentation?.mode ?? "overlay";
  if (placement === "outlet") {
    return mode === "view" ? <SettingsHost file={layout} onClose={onClose} /> : null;
  }
  return mode === "view" ? null : <SettingsRegionPortal file={layout} onClose={onClose} />;
}

/** Owns the mod filter's lifecycle and preview subject so typing in it re-renders only the modal. */
function ThemedModFilterModal({
  file,
  themeId,
  settings,
  onClose,
}: {
  file: ModalLayoutFile;
  themeId: string;
  settings?: SettingsValues;
  onClose: () => void;
}) {
  const { subscribedRows } = useModFilterLifecycle();
  const parent = useElementContext();
  const { tab, query, previewId, known, searchResults, usage } = useModFilterStore(
    useShallow((s) => ({
      tab: s.tab,
      query: s.query,
      previewId: s.previewId,
      known: s.known,
      searchResults: s.searchResults,
      usage: s.usage,
    })),
  );
  const previewMod = useMemo(
    () =>
      activeEntries({ tab, query, subscribedRows, known, searchResults, usage }).find(
        (entry) => entry.id === previewId,
      ) ?? null,
    [tab, query, subscribedRows, known, searchResults, usage, previewId],
  );

  return (
    <ElementContextProvider value={{ ...parent, previewMod }}>
      <ModalHost
        file={file}
        label="Filter by mod"
        initialFocus='[data-el="modFilter.search"] input'
        themeId={themeId}
        settings={settings}
        onClose={onClose}
      />
    </ElementContextProvider>
  );
}
