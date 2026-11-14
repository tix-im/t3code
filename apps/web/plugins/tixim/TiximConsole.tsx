import type { EnvironmentId } from "@t3tools/contracts";
import { ChevronDownIcon, WorkflowIcon } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogPopup,
  DialogTitle,
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  SidebarUtilityItem,
  useEnvironmentProviders,
  useEnvironmentQuery,
  useEnvironments,
} from "../../src/plugins/host";
import { FlowFrame } from "./FlowFrame";
import { workflowEnvironment } from "./state";

// The Tix Flow pages whose RPCs `tix flow-bridge` forwards.
const PAGES = [
  { path: "/runs", label: "Runs" },
  { path: "/workflows", label: "Workflows" },
  { path: "/pending", label: "Input" },
] as const;

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ id: string; label: string; disabled?: boolean }>;
  onChange: (id: string) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="sm" variant="ghost" aria-label={label} className="shrink-0" />}
      >
        <span className="max-w-40 truncate">
          {options.find((option) => option.id === value)?.label}
        </span>
        <ChevronDownIcon aria-hidden />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <MenuRadioItem key={option.id} value={option.id} disabled={option.disabled ?? false}>
              {option.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

function ConsoleContent({
  environments,
}: {
  environments: ReadonlyArray<{ id: EnvironmentId; label: string }>;
}) {
  const [environmentChoice, setEnvironmentChoice] = useState<string | null>(null);
  const [connectionChoice, setConnectionChoice] = useState<string | null>(null);
  const [page, setPage] = useState<string>(PAGES[0].path);
  // Reselecting a page must leave a run detail opened inside the frame.
  const [visit, setVisit] = useState(0);
  const environment =
    environments.find((value) => value.id === environmentChoice) ?? environments[0];
  const live = useEnvironmentQuery(
    environment
      ? workflowEnvironment.tiximConnections({ environmentId: environment.id, input: {} })
      : null,
  );
  const connections = live.data?.connections ?? [];
  const available = connections.filter((value) => value.available);
  const connection = available.find((value) => value.id === connectionChoice) ?? available[0];
  const status = live.error
    ? live.error
    : live.data === null
      ? "Connecting to Tixim…"
      : connection
        ? null
        : "No Tixim connection is reachable on this environment.";
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-1 border-b border-border/65 py-2.5 ps-4 pe-12">
        <WorkflowIcon aria-hidden className="size-4 shrink-0" />
        <DialogTitle className="me-3 ms-1.5 shrink-0">Tixim</DialogTitle>
        <nav aria-label="Tixim pages" className="me-auto flex items-center gap-1">
          {PAGES.map((item) => (
            <Button
              key={item.path}
              size="sm"
              variant={item.path === page ? "secondary" : "ghost"}
              aria-current={item.path === page ? "page" : undefined}
              onClick={() => {
                setPage(item.path);
                setVisit((count) => count + 1);
              }}
            >
              {item.label}
            </Button>
          ))}
        </nav>
        {environment && environments.length > 1 ? (
          <Picker
            label="Tixim environment"
            value={environment.id}
            options={environments}
            onChange={(id) => {
              setEnvironmentChoice(id);
              setConnectionChoice(null);
            }}
          />
        ) : null}
        {connection && connections.length > 1 ? (
          <Picker
            label="Tixim connection"
            value={connection.id}
            options={connections.map((value) => ({
              id: value.id,
              label: value.label,
              disabled: !value.available,
            }))}
            onChange={setConnectionChoice}
          />
        ) : null}
      </div>
      {environment && connection ? (
        <FlowFrame
          key={`${environment.id}/${connection.id}/${page}/${visit}`}
          environmentId={environment.id}
          connectionId={connection.id}
          daemonId={connection.daemonId}
          title={`Tix Flow: ${connection.label}`}
          path={page}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
          <p role={live.error ? "alert" : "status"} className="m-0 text-sm text-muted-foreground">
            {status}
          </p>
          {live.data !== null || live.error ? (
            <Button size="sm" variant="outline" onClick={live.refresh}>
              Retry
            </Button>
          ) : null}
        </div>
      )}
    </>
  );
}

export function TiximSidebarUtility() {
  const [open, setOpen] = useState(false);
  const providersByEnvironment = useEnvironmentProviders();
  const { presentationById } = useEnvironments();
  const environments = [...providersByEnvironment]
    .filter(([, providers]) => providers.some((provider) => provider.driver === "tixim"))
    .map(([id]) => ({ id, label: presentationById.get(id)?.entry.target.label ?? id }));
  if (environments.length === 0) return null;
  return (
    <>
      <SidebarUtilityItem icon={<WorkflowIcon />} label="Tixim" onClick={() => setOpen(true)} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="flex h-[85vh] w-[min(1200px,95vw)] max-w-none flex-col">
          <ConsoleContent environments={environments} />
        </DialogPopup>
      </Dialog>
    </>
  );
}
