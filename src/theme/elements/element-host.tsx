import type { CSSProperties, ReactNode } from "react";
import {
  AppClose,
  AppCollapseToggle,
  AppDragRegion,
  AppLogo,
  AppMaximize,
  AppMinimize,
  AppSchemeToggle,
  AppUiScale,
} from "./app-elements";
import {
  NavFavourites,
  NavMods,
  NavRecent,
  NavServers,
  NavSettings,
} from "./nav-elements";
import {
  StatusActivity,
  StatusLastRefreshed,
  StatusListSource,
  StatusPopulated,
  StatusServerTotal,
  StatusSteam,
} from "./status-elements";
import {
  NoticeError,
  NoticeModsCached,
  NoticeModsError,
  NoticeModsOutdated,
  NoticeModsResult,
  NoticeStorage,
  NoticeUpdate,
  ServerActionNotice,
} from "./notice-elements";
import {
  ServerAddress,
  ServerCancel,
  ServerDeselect,
  ServerCheckMods,
  ServerFavourite,
  ServerGameTime,
  ServerInfo,
  ServerJoin,
  ServerLastPlayed,
  ServerLoadToMenu,
  ServerManageMods,
  ServerMap,
  ServerMenu,
  ServerModCount,
  ServerName,
  ServerPing,
  ServerPlayers,
  ServerRefresh,
  ServerRegion,
  ServerSubscribeAll,
  ServerTags,
  ServerUnsubscribeUnique,
  ServerVersion,
} from "./server-elements";
import {
  FilterHideEmpty,
  FilterHideFull,
  FilterHideLocked,
  FilterHideOffline,
  FilterMap,
  FilterMaxPing,
  FilterRegion,
  FilterReset,
  FilterSearch,
  FilterTags,
  ServersRefresh,
} from "./filter-elements";
import { ServerListHost, ServerModsListHost } from "./list-elements";
import { ServerDownloadSize, ServerReadiness } from "./readiness-elements";
import {
  ModActions,
  ModAuthor,
  ModName,
  ModSize,
  ModStatus,
  ModSubscribed,
  ModUpdated,
  ServerModName,
  ServerModSize,
  ServerModState,
} from "./mod-elements";
import {
  SettingsBack,
  SettingsDone,
  SettingsTitle,
  SettingsProfileName,
  SettingsDayzPath,
  SettingsDetectPaths,
  SettingsWorkshopPath,
  SettingsLaunchParams,
  SettingsOnJoin,
  SettingsMinimiseToTray,
  SettingsCloseToTray,
  SettingsStartWithWindows,
  SettingsStartMinimised,
  SettingsDiscordPresence,
  SettingsDataFolder,
  SettingsOpenDataFolder,
  SettingsAutoRefresh,
  SettingsThemeManagement,
  SettingsSectionTitle,
  SettingsSectionDescription,
  SettingsSectionIcon,
  SettingsGroupTitle,
} from "./settings-elements";
import { useElementContext } from "./context";
import type { ElementNode } from "../renderer/types";

export function ElementHost({
  node,
  className,
  style,
}: {
  node: ElementNode;
  className?: string;
  style?: CSSProperties;
}): ReactNode {
  const { contextName } = useElementContext();
  const mergedClass = [node.class, className].filter(Boolean).join(" ") || undefined;

  switch (node.element) {
    case "app.minimize":
      return <AppMinimize className={mergedClass} style={style} />;
    case "app.maximize":
      return <AppMaximize className={mergedClass} style={style} />;
    case "app.close":
      return <AppClose className={mergedClass} style={style} />;
    case "app.dragRegion":
      return <AppDragRegion className={mergedClass} style={style} />;
    case "app.logo":
      return <AppLogo options={node.options} className={mergedClass} style={style} />;
    case "app.collapseToggle":
      return (
        <AppCollapseToggle options={node.options} className={mergedClass} style={style} />
      );
    case "app.uiScale":
      return <AppUiScale options={node.options} className={mergedClass} style={style} />;
    case "app.schemeToggle":
      return <AppSchemeToggle className={mergedClass} style={style} />;

    case "nav.servers":
      return <NavServers options={node.options} className={mergedClass} style={style} />;
    case "nav.favourites":
      return <NavFavourites options={node.options} className={mergedClass} style={style} />;
    case "nav.recent":
      return <NavRecent options={node.options} className={mergedClass} style={style} />;
    case "nav.mods":
      return <NavMods options={node.options} className={mergedClass} style={style} />;
    case "nav.settings":
      return <NavSettings options={node.options} className={mergedClass} style={style} />;

    case "status.steam":
      return <StatusSteam options={node.options} className={mergedClass} style={style} />;
    case "status.serverTotal":
      return (
        <StatusServerTotal options={node.options} className={mergedClass} style={style} />
      );
    case "status.populated":
      return (
        <StatusPopulated options={node.options} className={mergedClass} style={style} />
      );
    case "status.listSource":
      return <StatusListSource className={mergedClass} style={style} />;
    case "status.lastRefreshed":
      return (
        <StatusLastRefreshed options={node.options} className={mergedClass} style={style} />
      );
    case "status.activity":
      return <StatusActivity className={mergedClass} style={style} />;

    case "notice.storage":
      return <NoticeStorage className={mergedClass} style={style} />;
    case "notice.error":
      return <NoticeError className={mergedClass} style={style} />;
    case "notice.update":
      return <NoticeUpdate className={mergedClass} style={style} />;
    case "notice.modsError":
      return <NoticeModsError className={mergedClass} style={style} />;
    case "notice.modsCached":
      return <NoticeModsCached className={mergedClass} style={style} />;
    case "notice.modsResult":
      return <NoticeModsResult className={mergedClass} style={style} />;
    case "notice.modsOutdated":
      return <NoticeModsOutdated className={mergedClass} style={style} />;
    case "server.actionNotice":
      return <ServerActionNotice className={mergedClass} style={style} />;

    case "server.name":
      return <ServerName className={mergedClass} style={style} />;
    case "server.players":
      return <ServerPlayers options={node.options} className={mergedClass} style={style} />;
    case "server.ping":
      return <ServerPing options={node.options} className={mergedClass} style={style} />;
    case "server.map":
      return <ServerMap className={mergedClass} style={style} />;
    case "server.gameTime":
    case "server.time":
      return <ServerGameTime options={node.options} className={mergedClass} style={style} />;
    case "server.tags":
      return <ServerTags options={node.options} className={mergedClass} style={style} />;
    case "server.favourite":
      return <ServerFavourite options={node.options} className={mergedClass} style={style} />;
    case "server.join":
      return <ServerJoin options={node.options} className={mergedClass} style={style} />;
    case "server.info":
      return <ServerInfo className={mergedClass} style={style} />;
    case "server.menu":
      return <ServerMenu options={node.options} className={mergedClass} style={style} />;
    case "server.loadToMenu":
      return <ServerLoadToMenu options={node.options} className={mergedClass} style={style} />;
    case "server.cancel":
      return <ServerCancel options={node.options} className={mergedClass} style={style} />;
    case "server.manageMods":
      return <ServerManageMods options={node.options} className={mergedClass} style={style} />;
    case "server.deselect":
      return <ServerDeselect options={node.options} className={mergedClass} style={style} />;
    case "server.refresh":
      return <ServerRefresh className={mergedClass} style={style} />;
    case "server.address":
      return <ServerAddress options={node.options} className={mergedClass} style={style} />;
    case "server.lastPlayed":
      return <ServerLastPlayed options={node.options} className={mergedClass} style={style} />;
    case "server.modCount":
      return <ServerModCount options={node.options} className={mergedClass} style={style} />;
    case "server.region":
      return <ServerRegion options={node.options} className={mergedClass} style={style} />;
    case "server.version":
      return <ServerVersion className={mergedClass} style={style} />;
    case "server.checkMods":
      return <ServerCheckMods options={node.options} className={mergedClass} style={style} />;
    case "server.subscribeAll":
      return <ServerSubscribeAll options={node.options} className={mergedClass} style={style} />;
    case "server.unsubscribeUnique":
      return <ServerUnsubscribeUnique options={node.options} className={mergedClass} style={style} />;
    case "server.readiness":
      return <ServerReadiness options={node.options} className={mergedClass} style={style} />;
    case "server.downloadSize":
      return <ServerDownloadSize className={mergedClass} style={style} />;

    case "filter.search":
      return <FilterSearch options={node.options} className={mergedClass} style={style} />;
    case "filter.map":
      return <FilterMap options={node.options} className={mergedClass} style={style} />;
    case "filter.tags":
      return <FilterTags options={node.options} className={mergedClass} style={style} />;
    case "filter.region":
      return <FilterRegion options={node.options} className={mergedClass} style={style} />;
    case "filter.maxPing":
      return <FilterMaxPing options={node.options} className={mergedClass} style={style} />;
    case "filter.hideEmpty":
      return <FilterHideEmpty options={node.options} className={mergedClass} style={style} />;
    case "filter.hideFull":
      return <FilterHideFull options={node.options} className={mergedClass} style={style} />;
    case "filter.hideLocked":
      return <FilterHideLocked options={node.options} className={mergedClass} style={style} />;
    case "filter.hideOffline":
      return <FilterHideOffline options={node.options} className={mergedClass} style={style} />;
    case "servers.refresh":
      return <ServersRefresh options={node.options} className={mergedClass} style={style} />;
    case "filter.reset":
      return <FilterReset options={node.options} className={mergedClass} style={style} />;

    case "list.servers":
      return <ServerListHost className={mergedClass} style={style} />;
    case "list.serverMods":
      return <ServerModsListHost className={mergedClass} style={style} />;

    case "serverMod.state":
      return <ServerModState options={node.options} className={mergedClass} style={style} />;
    case "serverMod.name":
      return <ServerModName className={mergedClass} style={style} />;
    case "serverMod.size":
      return <ServerModSize className={mergedClass} style={style} />;

    case "mod.name":
      return <ModName className={mergedClass} style={style} />;
    case "mod.status":
      return <ModStatus className={mergedClass} style={style} />;
    case "mod.size":
      return <ModSize className={mergedClass} style={style} />;
    case "mod.updated":
      return <ModUpdated className={mergedClass} style={style} />;
    case "mod.actions":
      return <ModActions className={mergedClass} style={style} />;
    case "mod.author":
      return <ModAuthor className={mergedClass} style={style} />;
    case "mod.subscribed":
      return <ModSubscribed className={mergedClass} style={style} />;

    case "settings.back":
      return <SettingsBack options={node.options} className={mergedClass} style={style} />;
    case "settings.done":
      return <SettingsDone options={node.options} className={mergedClass} style={style} />;
    case "settings.title":
      return <SettingsTitle className={mergedClass} style={style} />;
    case "settings.profileName":
      return <SettingsProfileName options={node.options} className={mergedClass} style={style} />;
    case "settings.dayzPath":
      return <SettingsDayzPath options={node.options} className={mergedClass} style={style} />;
    case "settings.detectPaths":
      return <SettingsDetectPaths className={mergedClass} style={style} />;
    case "settings.workshopPath":
      return <SettingsWorkshopPath options={node.options} className={mergedClass} style={style} />;
    case "settings.launchParams":
      return <SettingsLaunchParams options={node.options} className={mergedClass} style={style} />;
    case "settings.onJoin":
      return <SettingsOnJoin options={node.options} className={mergedClass} style={style} />;
    case "settings.minimiseToTray":
      return <SettingsMinimiseToTray options={node.options} className={mergedClass} style={style} />;
    case "settings.closeToTray":
      return <SettingsCloseToTray options={node.options} className={mergedClass} style={style} />;
    case "settings.startWithWindows":
      return <SettingsStartWithWindows options={node.options} className={mergedClass} style={style} />;
    case "settings.startMinimised":
      return <SettingsStartMinimised options={node.options} className={mergedClass} style={style} />;
    case "settings.discordPresence":
      return <SettingsDiscordPresence options={node.options} className={mergedClass} style={style} />;
    case "settings.dataFolder":
      return <SettingsDataFolder options={node.options} className={mergedClass} style={style} />;
    case "settings.openDataFolder":
      return <SettingsOpenDataFolder className={mergedClass} style={style} />;
    case "settings.autoRefresh":
      return <SettingsAutoRefresh options={node.options} className={mergedClass} style={style} />;
    case "settings.themeManagement":
      return <SettingsThemeManagement className={mergedClass} style={style} />;
    case "settings.sectionTitle":
      return <SettingsSectionTitle options={node.options} className={mergedClass} style={style} />;
    case "settings.sectionDescription":
      return <SettingsSectionDescription options={node.options} className={mergedClass} style={style} />;
    case "settings.sectionIcon":
      return <SettingsSectionIcon options={node.options} className={mergedClass} style={style} />;
    case "settings.groupTitle":
      return <SettingsGroupTitle options={node.options} className={mergedClass} style={style} />;

    default:
      return (
        <div
          data-el={node.element}
          data-context={contextName}
          className={mergedClass}
          style={style}
        >
          {node.label}
        </div>
      );
  }
}
