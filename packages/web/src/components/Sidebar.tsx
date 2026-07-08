import { useState } from "react";
import type { Route } from "../router";
import {
  IconChat,
  IconChevronsLeft,
  IconChevronsRight,
  IconCompass,
  IconGear,
  IconGrid,
  IconList,
} from "./Icon";

const NAV_ITEMS: {
  route: Route;
  label: string;
  icon: (props: { size?: number }) => JSX.Element;
}[] = [
  { route: "/", label: "Dashboard", icon: IconGrid },
  { route: "/discover", label: "Discover", icon: IconCompass },
  { route: "/chat", label: "Chat", icon: IconChat },
  { route: "/playlists", label: "Playlists", icon: IconList },
  { route: "/settings", label: "Settings", icon: IconGear },
];

export function Sidebar({ route, navigate }: { route: Route; navigate: (r: Route) => void }) {
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 900);

  return (
    <aside className={`sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark" />
        <span className="sidebar__brand-name">ratemymusic</span>
      </div>
      <nav className="sidebar__nav" aria-label="Primary">
        {NAV_ITEMS.map(({ route: r, label, icon: Icon }) => (
          <button
            key={r}
            type="button"
            className={`nav-link${route === r ? " is-active" : ""}`}
            aria-current={route === r ? "page" : undefined}
            onClick={() => navigate(r)}
            title={collapsed ? label : undefined}
          >
            <Icon />
            <span className="nav-link__label">{label}</span>
          </button>
        ))}
      </nav>
      <button
        type="button"
        className="sidebar__collapse"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <IconChevronsRight /> : <IconChevronsLeft />}
        <span className="nav-link__label">Collapse</span>
      </button>
    </aside>
  );
}
