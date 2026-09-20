import { useEffect } from "react";

import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { Sidebar } from "@/components/shell/Sidebar";
import { Toast } from "@/components/shell/Toast";
import { Topbar } from "@/components/shell/Topbar";
import { UserDrawer } from "@/components/shell/UserDrawer";
import { PRODUCT_NAME } from "@/config";
import { AnalyticsScreen } from "@/screens/analytics/AnalyticsScreen";
import { OverviewScreen } from "@/screens/overview/OverviewScreen";
import { PagesScreen } from "@/screens/pages/PagesScreen";
import { SettingsScreen } from "@/screens/settings/SettingsScreen";
import { SupervisionScreen } from "@/screens/supervision/SupervisionScreen";
import { UsersScreen } from "@/screens/users/UsersScreen";
import { AdminProvider, useAdmin } from "@/state/AdminContext";
import type { ScreenId } from "@/types";

const SCREEN_TITLES: Record<ScreenId, string> = {
  overview: "Platform overview",
  supervision: "AI supervision",
  analytics: "Analytics",
  users: "Users & roles",
  pages: "Connected pages",
  configuration: "Configuration",
};

function CurrentScreen() {
  const { screen, loading } = useAdmin();
  if (loading) return <ScreenSkeleton />;

  switch (screen) {
    case "overview":
      return <OverviewScreen />;
    case "supervision":
      return <SupervisionScreen />;
    case "analytics":
      return <AnalyticsScreen />;
    case "users":
      return <UsersScreen />;
    case "pages":
      return <PagesScreen />;
    case "configuration":
      return <SettingsScreen />;
  }
}

function Shell() {
  const { screen } = useAdmin();

  useEffect(() => {
    document.title = `${SCREEN_TITLES[screen]} · ${PRODUCT_NAME}`;
  }, [screen]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar />
        <main className="content">
          <CurrentScreen />
        </main>
      </div>
      <UserDrawer />
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <AdminProvider>
      <Shell />
    </AdminProvider>
  );
}
