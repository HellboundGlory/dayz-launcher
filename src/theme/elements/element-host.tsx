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
      return <StatusLastRefreshed className={mergedClass} style={style} />;

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
