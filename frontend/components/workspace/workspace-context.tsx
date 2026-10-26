"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, getCurrentSession, getOrganizations, type CurrentSession, type LiveOrganization } from "@/lib/live-api";

type WorkspaceState = {
  status: "loading" | "ready" | "unauthenticated" | "unavailable";
  session: CurrentSession | null;
  organizations: LiveOrganization[];
  selectedOrganization: LiveOrganization | null;
  error: string | null;
  selectOrganization: (id: string) => void;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);
const organizationStorageKey = "sla-dex-live-organization";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WorkspaceState["status"]>("loading");
  const [session, setSession] = useState<CurrentSession | null>(null);
  const [organizations, setOrganizations] = useState<LiveOrganization[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadWorkspace() {
      try {
        const currentSession = await getCurrentSession();
        const memberships = await getOrganizations();
        if (!active) return;
        const storedOrganizationId = window.localStorage.getItem(organizationStorageKey);
        const selectedId = memberships.some((item) => item.id === storedOrganizationId)
          ? storedOrganizationId
          : memberships[0]?.id ?? null;
        setSession(currentSession);
        setOrganizations(memberships);
        setSelectedOrganizationId(selectedId);
        setStatus("ready");
      } catch (cause) {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setStatus("unauthenticated");
        } else {
          setError(cause instanceof Error ? cause.message : "The live workspace could not be loaded.");
          setStatus("unavailable");
        }
      }
    }
    void loadWorkspace();
    return () => { active = false; };
  }, []);

  const selectedOrganization = organizations.find((item) => item.id === selectedOrganizationId) ?? null;
  const state = useMemo<WorkspaceState>(() => ({
    status,
    session,
    organizations,
    selectedOrganization,
    error,
    selectOrganization: (id) => {
      if (!organizations.some((item) => item.id === id)) return;
      window.localStorage.setItem(organizationStorageKey, id);
      setSelectedOrganizationId(id);
    }
  }), [status, session, organizations, selectedOrganization, error]);

  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("WorkspaceProvider is required.");
  return context;
}
