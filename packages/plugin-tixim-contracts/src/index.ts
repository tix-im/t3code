import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";
import * as schemas from "./schemas.ts";
export * from "./schemas.ts";

export const methods = {
  tiximWorkflows: "server.tiximWorkflows",
  tiximWorkflowOverview: "server.tiximWorkflowOverview",
  tiximWorkflowSearch: "server.tiximWorkflowSearch",
  tiximWorkflowLink: "server.tiximWorkflowLink",
  tiximWorkflowSnooze: "server.tiximWorkflowSnooze",
  tiximConnections: "server.tiximConnections",
  tiximProjects: "server.tiximProjects",
  tiximProjectLinks: "server.tiximProjectLinks",
  tiximProjectLink: "server.tiximProjectLink",
  tiximProjectImport: "server.tiximProjectImport",
  tiximProjectUnlink: "server.tiximProjectUnlink",
  tiximProjectSync: "server.tiximProjectSync",
  tiximFlowRead: "server.tiximFlowRead",
  tiximFlowWrite: "server.tiximFlowWrite",
  serverListTiximContexts: "server.listTiximContexts",
  serverListTiximHarnesses: "server.listTiximHarnesses",
  serverListTiximModels: "server.listTiximModels",
} as const;

export type SubscriptionMethod =
  | typeof methods.tiximWorkflows
  | typeof methods.tiximWorkflowOverview;
export type StreamCommandMethod = typeof methods.tiximFlowRead | typeof methods.tiximFlowWrite;

export const scopes = {
  [methods.tiximWorkflows]: "orchestration:read",
  [methods.tiximWorkflowOverview]: "orchestration:read",
  [methods.tiximWorkflowSearch]: "orchestration:read",
  [methods.tiximWorkflowLink]: "orchestration:operate",
  [methods.tiximWorkflowSnooze]: "orchestration:operate",
  [methods.tiximConnections]: "orchestration:read",
  [methods.tiximProjects]: "orchestration:read",
  [methods.tiximProjectLinks]: "orchestration:read",
  [methods.tiximProjectLink]: "orchestration:operate",
  [methods.tiximProjectImport]: "orchestration:operate",
  [methods.tiximProjectUnlink]: "orchestration:operate",
  [methods.tiximProjectSync]: "orchestration:operate",
  [methods.tiximFlowRead]: "orchestration:read",
  [methods.tiximFlowWrite]: "orchestration:operate",
  [methods.serverListTiximContexts]: "providers:manage",
  [methods.serverListTiximHarnesses]: "providers:manage",
  [methods.serverListTiximModels]: "providers:manage",
} as const;
export const clientScopes = {
  [methods.tiximProjectLink]: scopes[methods.tiximProjectLink],
  [methods.tiximProjectImport]: scopes[methods.tiximProjectImport],
  [methods.tiximProjectUnlink]: scopes[methods.tiximProjectUnlink],
  [methods.tiximProjectSync]: scopes[methods.tiximProjectSync],
  [methods.tiximWorkflowLink]: scopes[methods.tiximWorkflowLink],
  [methods.tiximWorkflowSnooze]: scopes[methods.tiximWorkflowSnooze],
  [methods.tiximFlowWrite]: scopes[methods.tiximFlowWrite],
} as const;
export const providers = [
  { driverKind: "tixim", label: "Tixim", defaultModel: "default", acpBacked: true },
] as const;

export function rpcDefinitions<Auth extends Schema.Top>(EnvironmentAuthorizationError: Auth) {
  const WstiximWorkflowsRpc = Rpc.make(methods.tiximWorkflows, {
    payload: schemas.TiximWorkflowListInput,
    success: schemas.TiximWorkflowListResult,
    stream: true,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });

  const WstiximWorkflowOverviewRpc = Rpc.make(methods.tiximWorkflowOverview, {
    payload: schemas.TiximWorkflowOverviewInput,
    success: schemas.TiximWorkflowOverview,
    stream: true,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });

  const WstiximWorkflowSearchRpc = Rpc.make(methods.tiximWorkflowSearch, {
    payload: schemas.TiximWorkflowSearchInput,
    success: schemas.TiximWorkflowListResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });

  const WstiximWorkflowLinkRpc = Rpc.make(methods.tiximWorkflowLink, {
    payload: schemas.TiximWorkflowLinkInput,
    success: schemas.TiximWorkflowListResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });

  const WstiximWorkflowSnoozeRpc = Rpc.make(methods.tiximWorkflowSnooze, {
    payload: schemas.TiximWorkflowSnoozeInput,
    success: schemas.TiximWorkflowSnoozeResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });

  const WstiximConnectionsRpc = Rpc.make(methods.tiximConnections, {
    payload: schemas.TiximConnectionsInput,
    success: schemas.TiximConnectionsResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });
  const WstiximProjectsRpc = Rpc.make(methods.tiximProjects, {
    payload: schemas.TiximProjectsInput,
    success: schemas.TiximProjectsResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });
  const WstiximProjectLinksRpc = Rpc.make(methods.tiximProjectLinks, {
    payload: schemas.TiximProjectLinksInput,
    success: schemas.TiximProjectLinksResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });
  const WstiximProjectLinkRpc = Rpc.make(methods.tiximProjectLink, {
    payload: schemas.TiximProjectLinkInput,
    success: schemas.TiximProjectsResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });
  const WstiximProjectImportRpc = Rpc.make(methods.tiximProjectImport, {
    payload: schemas.TiximProjectImportInput,
    success: schemas.TiximProjectsResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });
  const WstiximProjectUnlinkRpc = Rpc.make(methods.tiximProjectUnlink, {
    payload: schemas.TiximProjectUnlinkInput,
    success: schemas.TiximProjectsResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });
  const WstiximProjectSyncRpc = Rpc.make(methods.tiximProjectSync, {
    payload: schemas.TiximProjectSyncInput,
    success: schemas.TiximProjectsResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });

  const WstiximFlowReadRpc = Rpc.make(methods.tiximFlowRead, {
    payload: schemas.TiximFlowRpcInput,
    success: Schema.String,
    stream: true,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });

  const WstiximFlowWriteRpc = Rpc.make(methods.tiximFlowWrite, {
    payload: schemas.TiximFlowRpcInput,
    success: Schema.String,
    stream: true,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });

  const WsServerListTiximContextsRpc = Rpc.make(methods.serverListTiximContexts, {
    payload: schemas.TiximListContextsInput,
    success: schemas.TiximListContextsResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });

  const WsServerListTiximModelsRpc = Rpc.make(methods.serverListTiximModels, {
    payload: schemas.TiximListModelsInput,
    success: schemas.TiximListModelsResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });

  const WsServerListTiximHarnessesRpc = Rpc.make(methods.serverListTiximHarnesses, {
    payload: schemas.TiximListHarnessesInput,
    success: schemas.TiximListHarnessesResult,
    error: Schema.Union([schemas.TiximCommandError, EnvironmentAuthorizationError]),
  });

  return [
    WstiximWorkflowsRpc,
    WstiximWorkflowOverviewRpc,
    WstiximWorkflowSearchRpc,
    WstiximWorkflowLinkRpc,
    WstiximWorkflowSnoozeRpc,
    WstiximConnectionsRpc,
    WstiximProjectsRpc,
    WstiximProjectLinksRpc,
    WstiximProjectLinkRpc,
    WstiximProjectImportRpc,
    WstiximProjectUnlinkRpc,
    WstiximProjectSyncRpc,
    WstiximFlowReadRpc,
    WstiximFlowWriteRpc,
    WsServerListTiximContextsRpc,
    WsServerListTiximModelsRpc,
    WsServerListTiximHarnessesRpc,
  ] as const;
}

export { orchestrationInstructions } from "./instructions.ts";

export { enabled, serverSwitchOn } from "./configuration.ts";
