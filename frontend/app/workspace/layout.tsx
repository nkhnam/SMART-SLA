import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export default function LiveWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
