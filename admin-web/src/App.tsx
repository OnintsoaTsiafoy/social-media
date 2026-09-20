import { useEffect } from "react";

import type { AdminProfile } from "@/api/types";
import { Sidebar } from "@/components/shell/Sidebar";
import { Toast } from "@/components/shell/Toast";
import { Topbar } from "@/components/shell/Topbar";
import { PRODUCT_NAME } from "@/config";
import { I18nProvider, useI18n, type MessageKey } from "@/i18n";
import { AnalyticsScreen } from "@/screens/analytics/AnalyticsScreen";
import { LoginScreen, RestoringScreen } from "@/screens/login/LoginScreen";
import { OverviewScreen } from "@/screens/overview/OverviewScreen";
import { PagesScreen } from "@/screens/pages/PagesScreen";
import { SettingsScreen } from "@/screens/settings/SettingsScreen";
import { SupervisionScreen } from "@/screens/supervision/SupervisionScreen";
import { UsersScreen } from "@/screens/users/UsersScreen";
import { AdminProvider, useAdmin } from "@/state/AdminContext";
import { AuthProvider, useAuth } from "@/state/AuthContext";
import type { ScreenId } from "@/types";

export const SCREEN_TITLES: Record<ScreenId, MessageKey> = {
  overview: "screen.overview",
  supervision: "screen.supervision",
  analytics: "screen.analytics",
  users: "screen.users",
  pages: "screen.pages",
  configuration: "screen.configuration",
};

function CurrentScreen() {
  const { screen } = useAdmin();

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
  const { t } = useI18n();

  useEffect(() => {
    document.title = `${t(SCREEN_TITLES[screen])} · ${PRODUCT_NAME}`;
  }, [screen, t]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar />
        <main className="content">
          <CurrentScreen />
        </main>
      </div>
      <Toast />
    </div>
  );
}

function Gate() {
  const { state } = useAuth();

  if (state.status === "restoring") return <RestoringScreen />;
  if (state.status === "signedOut") return <LoginScreen />;

  const profile: AdminProfile = state.profile;
  return (
    <AdminProvider profile={profile}>
      <Shell />
    </AdminProvider>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </I18nProvider>
  );
}
