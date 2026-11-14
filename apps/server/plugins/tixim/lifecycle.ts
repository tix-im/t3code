import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as FileSystem from "effect/FileSystem";
import * as SqlClient from "effect/sql/SqlClient";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { ProcessRunner, ProjectService, ServerSettings } from "../../src/plugins/host.ts";
import * as TiximWorkflows from "./TiximWorkflows.ts";
import * as TiximWorkflowWaits from "./TiximWorkflowWaits.ts";
import * as TiximProjects from "./TiximProjects.ts";

export const services = TiximWorkflowWaits.layer.pipe(
  Layer.provideMerge(TiximWorkflows.layer.pipe(Layer.provide(ProcessRunner.layer))),
);
export const startup = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* (yield* TiximWorkflowWaits.WorkflowWaits).start();
    const random = yield* Effect.serviceOption(SecureRandom.SecureRandom);
    const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);
    const sql = yield* Effect.serviceOption(SqlClient.SqlClient);
    const runner = yield* Effect.serviceOption(ProcessRunner.ProcessRunner);
    const projects = yield* Effect.serviceOption(ProjectService.ProjectService);
    const settings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
    if (
      Option.isSome(random) &&
      Option.isSome(fileSystem) &&
      Option.isSome(sql) &&
      Option.isSome(runner) &&
      Option.isSome(projects) &&
      Option.isSome(settings)
    ) {
      yield* TiximProjects.start().pipe(
        Effect.provideService(SecureRandom.SecureRandom, random.value),
        Effect.provideService(FileSystem.FileSystem, fileSystem.value),
        Effect.provideService(SqlClient.SqlClient, sql.value),
        Effect.provideService(ProcessRunner.ProcessRunner, runner.value),
        Effect.provideService(ProjectService.ProjectService, projects.value),
        Effect.provideService(ServerSettings.ServerSettingsService, settings.value),
        Effect.provideService(HostProcess.Environment, yield* HostProcess.Environment),
      );
    }
  }),
);
/** RPC handlers are built per connection, outside the layer that holds these services. */
export const rpcContext = Effect.serviceOption(TiximWorkflowWaits.WorkflowWaits).pipe(
  Effect.map(
    Option.match({
      onNone: () => Context.empty() as Context.Context<TiximWorkflowWaits.WorkflowWaits>,
      onSome: (waits) => Context.make(TiximWorkflowWaits.WorkflowWaits, waits),
    }),
  ),
);
