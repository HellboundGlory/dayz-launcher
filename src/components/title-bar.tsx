import { Minus, Square, X, Star, Globe, Clock, Settings, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import tetraLogo from "@/assets/tetra-logo.png";

interface TitleBarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  steamConnected: boolean;
  className?: string;
  onOpenSettings: () => void;
}

export function TitleBar({
  activeTab,
  onTabChange,
  steamConnected,
  className,
  onOpenSettings,
}: TitleBarProps) {
  function minimizeWindow() {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().minimize();
    }).catch(() => {});
  }

  function maximizeWindow() {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().toggleMaximize();
    }).catch(() => {});
  }

  function closeWindow() {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().close();
    }).catch(() => {});
  }

  const tabs = [
    { id: "servers", label: "SERVERS", icon: Globe },
    { id: "favorites", label: "FAVOURITES", icon: Star },
    { id: "recent", label: "RECENT", icon: Clock },
    { id: "mods", label: "MODS", icon: Package },
  ];

  return (
    <div
      className={cn(
        "flex h-10 select-none items-center justify-between border-b border-[#1e293b] bg-[#0b0f17]",
        className,
      )}
      data-tauri-drag-region
    >
      <div className="flex items-center gap-0" data-tauri-drag-region>
        <div
          className="flex items-center gap-2 border-r border-[#1e293b] px-4 py-2"
          data-tauri-drag-region
        >
          <img src={tetraLogo} alt="" className="size-5" draggable={false} />
          <span className="text-sm font-bold tracking-wide text-[#38bdf8]">
            TETRA
          </span>
          <span className="text-sm font-medium text-[#f1f5f9]">Launcher</span>
        </div>

        <nav className="flex h-full items-center" data-tauri-drag-region>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "relative flex h-full items-center gap-1.5 px-3 text-xs font-semibold tracking-wider transition-colors",
                  isActive
                    ? "text-[#f1f5f9]"
                    : "text-[#64748b] hover:text-[#94a3b8]",
                )}
              >
                <Icon className="size-3.5" />
                {tab.label}
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 h-[2px] w-3/4 -translate-x-1/2 rounded-full bg-[#38bdf8]" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

        <div className="flex items-center">
        <div className="flex items-center gap-1.5 px-3">
          <span
            className={cn(
              "inline-block size-1.5 rounded-full",
              steamConnected ? "bg-[#22c55e]" : "bg-[#64748b]",
            )}
          />
          <span className="text-xs text-[#64748b]">
            {steamConnected ? "Steam connected" : "Steam offline"}
          </span>
        </div>

        <div className="flex">
          <button
            onClick={onOpenSettings}
            className="inline-flex h-10 w-[46px] items-center justify-center text-[#64748b] hover:bg-[#16202e] hover:text-[#f1f5f9]"
            title="Settings"
          >
            <Settings className="size-3.5" />
          </button>
          <button
            onClick={minimizeWindow}
            className="inline-flex h-10 w-[46px] items-center justify-center text-[#64748b] hover:bg-[#16202e] hover:text-[#f1f5f9]"
            title="Minimize"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            onClick={maximizeWindow}
            className="inline-flex h-10 w-[46px] items-center justify-center text-[#64748b] hover:bg-[#16202e] hover:text-[#f1f5f9]"
            title="Maximize"
          >
            <Square className="size-3" />
          </button>
          <button
            onClick={closeWindow}
            className="inline-flex h-10 w-[46px] items-center justify-center text-[#64748b] hover:bg-[#ef4444] hover:text-white"
            title="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}