import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type { Range } from "@/data/overview";
import type { NetFilter } from "@/types";
import { useLiveTicker } from "@/state/useLiveTicker";
import { useRoute } from "@/state/useRoute";
import { useSupervision } from "@/state/useSupervision";
import { useToast } from "@/state/useToast";
import { useUsers } from "@/state/useUsers";
import { useAnalyticsFilters, usePageSettings, useWorkspaceSettings } from "@/state/useWorkspace";

/**
 * Everything the console keeps between screens. The mock-up holds all of its state in
 * one component, so filters, the review queue and edits persist while you navigate;
 * this provider preserves that. Swapping a fixture for the real API happens in the hooks.
 */
function useAdminState() {
  const route = useRoute();
  const { toast, say } = useToast();
  const [net, setNet] = useState<NetFilter>("all");
  const [range, setRange] = useState<Range>("Last 7 days");
  const ticker = useLiveTicker();
  const supervision = useSupervision(say);
  const users = useUsers(say);
  const analytics = useAnalyticsFilters();
  const pages = usePageSettings();
  const settings = useWorkspaceSettings(say);

  // Leaving a screen closes the member drawer, as in the design.
  const closeDrawer = users.close;
  useEffect(() => {
    closeDrawer();
  }, [route.screen, closeDrawer]);

  return { ...route, toast, say, net, setNet, range, setRange, ticker, supervision, users, analytics, pages, settings };
}

export type AdminState = ReturnType<typeof useAdminState>;

const AdminContext = createContext<AdminState | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const state = useAdminState();
  return <AdminContext.Provider value={state}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminState {
  const state = useContext(AdminContext);
  if (!state) throw new Error("useAdmin must be used inside <AdminProvider>");
  return state;
}
