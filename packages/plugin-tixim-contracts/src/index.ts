import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";
import * as schemas from "./schemas.ts";
export * from "./schemas.ts";

export const methods = {
  tiximWorkflows: "server.tiximWorkflows",
  tiximWorkflowSearch: "server.tiximWorkflowSearch",
  tiximWorkflowLink: "server.tiximWorkflowLink",
  tiximWorkflowSnooze: "server.tiximWorkflowSnooze",
  tiximFlowRead: "server.tiximFlowRead",
  tiximFlowWrite: "server.tiximFlowWrite",
  serverListTiximContexts: "server.listTiximContexts",
  serverListTiximHarnesses: "server.listTiximHarnesses",
  serverListTiximModels: "server.listTiximModels",
} as const;

export type SubscriptionMethod = typeof methods.tiximWorkflows;
export type StreamCommandMethod = typeof methods.tiximFlowRead | typeof methods.tiximFlowWrite;

export const scopes = {
  [methods.tiximWorkflows]: "orchestration:read",
  [methods.tiximWorkflowSearch]: "orchestration:read",
  [methods.tiximWorkflowLink]: "orchestration:operate",
  [methods.tiximWorkflowSnooze]: "orchestration:operate",
  [methods.tiximFlowRead]: "orchestration:read",
  [methods.tiximFlowWrite]: "orchestration:operate",
  [methods.serverListTiximContexts]: "providers:manage",
  [methods.serverListTiximHarnesses]: "providers:manage",
  [methods.serverListTiximModels]: "providers:manage",
} as const;
export const clientScopes = {
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
    WstiximWorkflowSearchRpc,
    WstiximWorkflowLinkRpc,
    WstiximWorkflowSnoozeRpc,
    WstiximFlowReadRpc,
    WstiximFlowWriteRpc,
    WsServerListTiximContextsRpc,
    WsServerListTiximModelsRpc,
    WsServerListTiximHarnessesRpc,
  ] as const;
}

export { orchestrationInstructions } from "./instructions.ts";

export { enabled, serverSwitchOn } from "./configuration.ts";
