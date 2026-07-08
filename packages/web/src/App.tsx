import { Sidebar } from "./components/Sidebar";
import { Chat } from "./pages/Chat";
import { Dashboard } from "./pages/Dashboard";
import { Discover } from "./pages/Discover";
import { Playlists } from "./pages/Playlists";
import { Settings } from "./pages/Settings";
import { useHashRoute } from "./router";
import { ToastProvider } from "./toast";

function RouteView({ route }: { route: ReturnType<typeof useHashRoute>[0] }) {
  switch (route) {
    case "/discover":
      return <Discover />;
    case "/chat":
      return <Chat />;
    case "/playlists":
      return <Playlists />;
    case "/settings":
      return <Settings />;
    default:
      return <Dashboard />;
  }
}

function Shell() {
  const [route, navigate] = useHashRoute();

  return (
    <div className="app-shell">
      <Sidebar route={route} navigate={navigate} />
      <main className="main">
        <RouteView route={route} />
      </main>
    </div>
  );
}

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
