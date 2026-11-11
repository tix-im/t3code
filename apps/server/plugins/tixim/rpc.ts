import {
  WS_METHODS,
  TiximCommandError,
  type TiximWorkflowListInput,
  type TiximWorkflowOverviewInput,
  type TiximWorkflowSearchInput,
  type TiximWorkflowLinkInput,
  type TiximWorkflowSnoozeInput,
  type TiximConnectionsInput,
  type TiximFlowRpcInput,
  type TiximListContextsInput,
  type TiximListModelsInput,
  type TiximListHarnessesInput,
  type TiximProjectsInput,
  type TiximProjectLinkInput,
  type TiximProjectImportInput,
  type TiximProjectUnlinkInput,
  type TiximProjectSyncInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { ProcessRunner } from "../../src/plugins/host.ts";
import * as TiximWorkflows from "./TiximWorkflows.ts";
import * as TiximWorkflowWaits from "./TiximWorkflowWaits.ts";
import * as TiximCatalog from "./tiximCatalog.ts";
import * as TiximProjects from "./TiximProjects.ts";
import { ProjectService, ServerSettings } from "../../src/plugins/host.ts";
const isTiximCommandError = Schema.is(TiximCommandError);

export const makeRpcHandlers = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tiximProcessRunner = yield* ProcessRunner.make();
  const tiximEnvironment = yield* HostProcess.Environment;
  const projectService = yield* ProjectService.ProjectService;
  const fileSystem = yield* FileSystem.FileSystem;
  const random = yield* SecureRandom.SecureRandom;
  const settings = yield* ServerSettings.ServerSettingsService;
  const projectRpc = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.provideService(ProcessRunner.ProcessRunner, tiximProcessRunner),
      Effect.provideService(ProjectService.ProjectService, projectService),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(SecureRandom.SecureRandom, random),
      Effect.provideService(ServerSettings.ServerSettingsService, settings),
      Effect.provideService(HostProcess.Environment, tiximEnvironment),
      Effect.mapError((error) =>
        isTiximCommandError(error) ? error : new TiximCommandError({ message: String(error) }),
      ),
    );
  const workflowWaits = yield* Effect.serviceOption(TiximWorkflowWaits.WorkflowWaits);
  const searchWorkflows = yield* TiximWorkflows.makeCachedSearch.pipe(
    Effect.provideService(SqlClient.SqlClient, sql),
    Effect.provideService(ProcessRunner.ProcessRunner, tiximProcessRunner),
  );
  return {
    [WS_METHODS.tiximWorkflows]: (input: typeof TiximWorkflowListInput.Type) =>
      TiximWorkflows.live(input.threadId).pipe(
        Stream.provideService(SqlClient.SqlClient, sql),
        Stream.provideService(ProcessRunner.ProcessRunner, tiximProcessRunner),
      ),
    [WS_METHODS.tiximWorkflowOverview]: (_input: TiximWorkflowOverviewInput) =>
      TiximWorkflows.liveOverview().pipe(Stream.provideService(SqlClient.SqlClient, sql)),
    [WS_METHODS.tiximWorkflowSearch]: (input: TiximWorkflowSearchInput) => searchWorkflows(input),
    [WS_METHODS.tiximWorkflowLink]: (input: TiximWorkflowLinkInput) =>
      TiximWorkflows.link(input).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.provideService(ProcessRunner.ProcessRunner, tiximProcessRunner),
      ),
    [WS_METHODS.tiximWorkflowSnooze]: (input: TiximWorkflowSnoozeInput) =>
      Option.isSome(workflowWaits)
        ? workflowWaits.value.snooze(input)
        : Effect.fail(new TiximCommandError({ message: "Workflow snooze is unavailable." })),
    [WS_METHODS.tiximConnections]: (_input: TiximConnectionsInput) =>
      TiximWorkflows.listConnections().pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, tiximProcessRunner),
      ),
    [WS_METHODS.tiximProjects]: (input: TiximProjectsInput) =>
      projectRpc(TiximProjects.list(input.connectionId)),
    [WS_METHODS.tiximProjectLinks]: (_input: Record<string, never>) =>
      projectRpc(TiximProjects.listLinks()),
    [WS_METHODS.tiximProjectLink]: (input: TiximProjectLinkInput) =>
      projectRpc(TiximProjects.link(input)),
    [WS_METHODS.tiximProjectImport]: (input: TiximProjectImportInput) =>
      projectRpc(TiximProjects.importProject(input)),
    [WS_METHODS.tiximProjectUnlink]: (input: TiximProjectUnlinkInput) =>
      projectRpc(TiximProjects.unlink(input)),
    [WS_METHODS.tiximProjectSync]: (input: TiximProjectSyncInput) =>
      projectRpc(TiximProjects.sync(input.connectionId)),
    [WS_METHODS.tiximFlowRead]: (input: TiximFlowRpcInput) =>
      TiximWorkflows.rpc(input, false).pipe(
        Stream.provideService(SqlClient.SqlClient, sql),
        Stream.provideService(ProcessRunner.ProcessRunner, tiximProcessRunner),
      ),
    [WS_METHODS.tiximFlowWrite]: (input: TiximFlowRpcInput) =>
      TiximWorkflows.rpc(input, true).pipe(
        Stream.provideService(SqlClient.SqlClient, sql),
        Stream.provideService(ProcessRunner.ProcessRunner, tiximProcessRunner),
      ),
    [WS_METHODS.serverListTiximContexts]: (_input: TiximListContextsInput) =>
      TiximCatalog.listTiximContexts(tiximProcessRunner, tiximEnvironment),
    [WS_METHODS.serverListTiximModels]: (input: TiximListModelsInput) =>
      TiximCatalog.listTiximModels(tiximProcessRunner, tiximEnvironment, input),
    [WS_METHODS.serverListTiximHarnesses]: (input: TiximListHarnessesInput) =>
      Effect.annotateCurrentSpan({ "tixim.context": input.context }).pipe(
        Effect.andThen(
          TiximCatalog.listTiximHarnesses(tiximProcessRunner, tiximEnvironment, input.context),
        ),
      ),
  };
});

// Keep the legacy wire contract available to old clients when the plugin is disabled.
const error = new TiximCommandError({ message: "The Tixim plugin is disabled." });
export const disabledRpcHandlers = Effect.succeed({
  [WS_METHODS.tiximWorkflows]: (_input: typeof TiximWorkflowListInput.Type) => Stream.fail(error),
  [WS_METHODS.tiximWorkflowOverview]: (_input: TiximWorkflowOverviewInput) => Stream.fail(error),
  [WS_METHODS.tiximWorkflowSearch]: (_input: TiximWorkflowSearchInput) => Effect.fail(error),
  [WS_METHODS.tiximWorkflowLink]: (_input: TiximWorkflowLinkInput) => Effect.fail(error),
  [WS_METHODS.tiximWorkflowSnooze]: (_input: TiximWorkflowSnoozeInput) => Effect.fail(error),
  [WS_METHODS.tiximConnections]: (_input: TiximConnectionsInput) => Effect.fail(error),
  [WS_METHODS.tiximProjects]: (_input: TiximProjectsInput) => Effect.fail(error),
  [WS_METHODS.tiximProjectLinks]: (_input: Record<string, never>) => Effect.fail(error),
  [WS_METHODS.tiximProjectLink]: (_input: TiximProjectLinkInput) => Effect.fail(error),
  [WS_METHODS.tiximProjectImport]: (_input: TiximProjectImportInput) => Effect.fail(error),
  [WS_METHODS.tiximProjectUnlink]: (_input: TiximProjectUnlinkInput) => Effect.fail(error),
  [WS_METHODS.tiximProjectSync]: (_input: TiximProjectSyncInput) => Effect.fail(error),
  [WS_METHODS.tiximFlowRead]: (_input: TiximFlowRpcInput) => Stream.fail(error),
  [WS_METHODS.tiximFlowWrite]: (_input: TiximFlowRpcInput) => Stream.fail(error),
  [WS_METHODS.serverListTiximContexts]: (_input: TiximListContextsInput) => Effect.fail(error),
  [WS_METHODS.serverListTiximModels]: (_input: TiximListModelsInput) => Effect.fail(error),
  [WS_METHODS.serverListTiximHarnesses]: (_input: TiximListHarnessesInput) => Effect.fail(error),
});

export function makeRpcHandlersFor(enabled: false): typeof disabledRpcHandlers;
export function makeRpcHandlersFor(
  enabled: boolean,
): typeof makeRpcHandlers | typeof disabledRpcHandlers;
export function makeRpcHandlersFor(enabled: boolean) {
  return enabled ? makeRpcHandlers : disabledRpcHandlers;
}
