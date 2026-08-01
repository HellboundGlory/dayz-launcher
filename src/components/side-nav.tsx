import { Home, ListTree, Bot, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SideNavProps {
  active: string;
  onNavigate: (route: string) => void;
}

export function SideNav({ active, onNavigate }: SideNavProps) {
  return (
    <aside className="flex h-full w-[52px] flex-col border-r border-border bg-card">
      <div className="flex w-full items-center justify-center py-2">
        <span className="text-xs font-extralight text-muted-foreground">TETRA</span>
      </div>
      <nav className="grid gap-1 p-2">
        <NavButton
          icon={Home}
          label="Home"
          active={active === "home"}
          onClick={() => onNavigate("home")}
        />
        <NavButton
          icon={ListTree}
          label="Server Browser"
          active={active === "server-browser"}
          onClick={() => onNavigate("server-browser")}
        />
        <NavButton
          icon={Bot}
          label="Mod Manager"
          active={active === "mod-manager"}
          onClick={() => onNavigate("mod-manager")}
        />
        <NavButton
          icon={Settings2}
          label="Settings"
          active={active === "settings"}
          onClick={() => onNavigate("settings")}
        />
      </nav>
    </aside>
  );
}

function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        active && "bg-accent text-accent-foreground",
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}