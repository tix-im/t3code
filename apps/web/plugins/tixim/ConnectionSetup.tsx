import { useEffect } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { DesktopTiximProject } from "@t3tools/contracts";
import type { PluginConnectionSetupProps } from "../../src/plugins/api";
import {
  Alert,
  AlertAction,
  AlertDescription,
  Button,
  cn,
  useEnvironmentQuery,
} from "../../src/plugins/host";
import { desktopTiximProjectsStateAtom, formatDesktopTiximError } from "./desktopTiximProjects";
const EMPTY_TIXIM_PROJECTS: ReadonlyArray<DesktopTiximProject> = [];
export function ConnectionSetup({
  desktopBridge,
  savedAliases: savedDesktopSshEnvironmentKeys,
  busy: isAddingSavedBackend,
  onBusyChange: setIsAddingSavedBackend,
  onErrorChange,
  error,
  connectSsh: connectSavedBackendSshTarget,
}: PluginConnectionSetupProps) {
  const desktopTiximProjects = useEnvironmentQuery(desktopTiximProjectsStateAtom);
  const refreshDesktopTiximProjects = desktopTiximProjects.refresh;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reruns `tix ssh hosts` through the bridge each time the tixim tab is shown
  useEffect(() => {
    refreshDesktopTiximProjects();
  }, [refreshDesktopTiximProjects]);
  const tiximProjects = desktopTiximProjects.data ?? EMPTY_TIXIM_PROJECTS;
  const unsavedTiximProjects = tiximProjects.filter(
    (project) => !savedDesktopSshEnvironmentKeys.has(project.alias),
  );
  const hasUnconfiguredTiximProjects = tiximProjects.some((project) => !project.configured);
  const isLoadingTiximProjects =
    desktopTiximProjects.isPending && desktopTiximProjects.data === null;
  const handleInstallTiximSshConfig = async () => {
    const installTiximSshConfig = desktopBridge?.installTiximSshConfig;
    if (isAddingSavedBackend || !installTiximSshConfig) return;

    setIsAddingSavedBackend(true);
    onErrorChange(null);
    try {
      await installTiximSshConfig();
    } catch (error) {
      onErrorChange(formatDesktopTiximError(error, "Failed to install the tixim SSH config."));
    }
    setIsAddingSavedBackend(false);
    refreshDesktopTiximProjects();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-foreground">tixim projects</span>
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={isAddingSavedBackend || desktopTiximProjects.isPending}
          onClick={() => refreshDesktopTiximProjects()}
        >
          <RefreshCwIcon
            aria-hidden
            className={cn("size-3", desktopTiximProjects.isPending && "animate-spin")}
          />
          Refresh
        </Button>
      </div>
      {hasUnconfiguredTiximProjects ? (
        <Alert variant="warning">
          <AlertDescription>
            The tixim SSH config is not included in ~/.ssh/config yet, so tix-* hosts cannot be
            reached.
          </AlertDescription>
          <AlertAction>
            <Button
              size="xs"
              variant="outline"
              disabled={isAddingSavedBackend}
              onClick={() => void handleInstallTiximSshConfig()}
            >
              Install SSH config
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {isLoadingTiximProjects ? (
        <p className="text-xs text-muted-foreground">Loading projects…</p>
      ) : unsavedTiximProjects.length > 0 ? (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
          {unsavedTiximProjects.map((project) => (
            <li key={project.alias} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {project.project}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {project.directory}
                </span>
              </span>
              <Button
                size="xs"
                variant="outline"
                disabled={isAddingSavedBackend}
                onClick={() =>
                  void connectSavedBackendSshTarget({
                    alias: project.alias,
                    hostname: project.alias,
                    username: null,
                    port: null,
                  })
                }
              >
                Connect
              </Button>
            </li>
          ))}
        </ul>
      ) : desktopTiximProjects.error === null ? (
        <p className="text-xs text-muted-foreground">
          {tiximProjects.length > 0
            ? "All tixim projects are already added."
            : "No tixim projects found."}
        </p>
      ) : null}
      {error || desktopTiximProjects.error ? (
        <Alert variant="error">
          <AlertDescription>{error ?? desktopTiximProjects.error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
