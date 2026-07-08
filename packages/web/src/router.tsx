import { useEffect, useState } from "react";

export type Route = "/" | "/discover" | "/playlists" | "/chat" | "/settings";

const KNOWN_ROUTES: Route[] = ["/", "/discover", "/playlists", "/chat", "/settings"];

function normalize(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  return (KNOWN_ROUTES as string[]).includes(path) ? (path as Route) : "/";
}

/** Minimal hash router: avoids pulling in react-router-dom for four static views. */
export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => normalize(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(normalize(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = (next: Route) => {
    window.location.hash = next === "/" ? "" : next;
    setRoute(next);
  };

  return [route, navigate];
}
