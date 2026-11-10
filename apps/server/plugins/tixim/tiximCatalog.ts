import {
  TiximCommandError,
  type TiximContext,
  type TiximListContextsResult,
  TiximHarnessIcon,
  type TiximListHarnessesResult,
  type TiximListModelsInput,
  TiximListModelsResult,
} from "@t3tools/contracts";
import { tiximHostEnvironment, resolveTiximCommand } from "@t3tools/plugin-tixim-provider/server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProcessRunner } from "../../src/plugins/host.ts";

const TIX_TIMEOUT = "20 seconds";

const GatewayModelRow = Schema.Struct({
  model: Schema.String,
  source: Schema.String,
  state: Schema.optional(Schema.String),
});

const decodeGatewayModels = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(GatewayModelRow)),
);
const decodeHarnessModels = Schema.decodeEffect(Schema.fromJsonString(TiximListModelsResult));

const TixContextRow = Schema.Struct({
  name: Schema.String,
  url: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  current: Schema.optional(Schema.String),
});

const TixHarnessRow = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  authenticated: Schema.optional(Schema.String),
  has_acp: Schema.optional(Schema.String),
  icon: Schema.optional(Schema.Unknown),
});

// A malformed icon only costs that harness its icon, not the whole listing.
const decodeHarnessIcon = Schema.decodeUnknownOption(TiximHarnessIcon);

const decodeContextRows = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(TixContextRow)),
);
const decodeHarnessRows = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Array(TixHarnessRow)),
);

const runTix = Effect.fn("TiximCatalog.runTix")(function* (
  runner: ProcessRunner.ProcessRunner["Service"],
  environment: NodeJS.ProcessEnv,
  args: ReadonlyArray<string>,
) {
  const output = yield* runner
    // An unreachable daemon fails the listing at once instead of tix's restart grace wait.
    .run({
      command: resolveTiximCommand(environment),
      args,
      env: { ...environment, TIX_WAIT_FOR_DAEMON: "0" },
      timeout: TIX_TIMEOUT,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TiximCommandError({
            message: `Could not run tix on this environment: ${cause.message}`,
          }),
      ),
    );
  if (output.code !== 0) {
    const lines = output.stderr.trim().split("\n");
    const detail = lines.find((line) => /^error:/i.test(line)) ?? lines.at(-1) ?? "";
    return yield* new TiximCommandError({
      message: `tix ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`,
    });
  }
  return output.stdout;
});

/** The default entry: the environment's own daemon when it runs inside a tix run, else its current context. */
function defaultContext(
  environment: NodeJS.ProcessEnv,
  current: TiximContext | undefined,
): TiximContext {
  const runDaemon = environment.TIXIM_URL?.trim() || environment.TIX_DAEMON_URL?.trim();
  return {
    name: "",
    label: runDaemon ? `Default (${runDaemon})` : current ? `Default (${current.name})` : "Default",
    url: runDaemon || current?.url || "",
    status: runDaemon ? "running" : (current?.status ?? ""),
    current: true,
  };
}

export const listTiximContexts = Effect.fn("TiximCatalog.listContexts")(function* (
  runner: ProcessRunner.ProcessRunner["Service"],
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<TiximListContextsResult, TiximCommandError> {
  const stdout = yield* runTix(runner, tiximHostEnvironment(environment, { context: "" }), [
    "-o",
    "json",
    "context",
    "list",
  ]);
  const rows = yield* decodeContextRows(stdout).pipe(
    Effect.mapError(
      () => new TiximCommandError({ message: "tix context list returned unexpected output." }),
    ),
  );
  const contexts = rows.map((row): TiximContext => ({
    name: row.name,
    label: row.name,
    url: row.url ?? "",
    status: row.status ?? "",
    current: row.current === "*",
  }));
  return {
    contexts: [
      defaultContext(
        environment,
        contexts.find((context) => context.current),
      ),
      ...contexts.map((context) => ({ ...context, current: false })),
    ],
  };
});

export const listTiximHarnesses = Effect.fn("TiximCatalog.listHarnesses")(function* (
  runner: ProcessRunner.ProcessRunner["Service"],
  environment: NodeJS.ProcessEnv,
  context: string,
): Effect.fn.Return<TiximListHarnessesResult, TiximCommandError> {
  const stdout = yield* runTix(runner, tiximHostEnvironment(environment, { context }), [
    ...(context ? ["--context", context] : []),
    "-o",
    "json",
    "harnesses",
    "list",
  ]);
  const rows = yield* decodeHarnessRows(stdout).pipe(
    Effect.mapError(
      () => new TiximCommandError({ message: "tix harnesses list returned unexpected output." }),
    ),
  );
  return {
    harnesses: rows
      .filter((row) => row.has_acp === "yes")
      .map((row) => {
        const icon = Option.getOrUndefined(decodeHarnessIcon(row.icon));
        return {
          name: row.name,
          description: row.description ?? "",
          authenticated: row.authenticated === "yes",
          ...(icon ? { icon } : {}),
        };
      }),
  };
});

export const listTiximModels = Effect.fn("TiximCatalog.listModels")(function* (
  runner: ProcessRunner.ProcessRunner["Service"],
  environment: NodeJS.ProcessEnv,
  input: TiximListModelsInput,
): Effect.fn.Return<TiximListModelsResult, TiximCommandError> {
  const runModels = (args: ReadonlyArray<string>) =>
    runTix(runner, tiximHostEnvironment(environment, input), [
      ...(input.context ? ["--context", input.context] : []),
      "-o",
      "json",
      ...args,
    ]);
  const gatewayModels = runModels(["gateway", "models", "list"]).pipe(
    Effect.flatMap((stdout) =>
      decodeGatewayModels(stdout).pipe(
        Effect.mapError(
          () =>
            new TiximCommandError({
              message: "tix gateway models list returned unexpected output.",
            }),
        ),
      ),
    ),
    Effect.map((rows) =>
      rows
        .filter((row) => row.model && row.source !== "endpoint" && row.state !== "disabled")
        .map((row) => ({ id: row.model, name: row.model })),
    ),
  );
  const harnessModels = runModels([
    "harnesses",
    "models",
    input.harness,
    "--routing",
    input.routing,
  ]).pipe(
    Effect.flatMap((stdout) =>
      decodeHarnessModels(stdout).pipe(
        Effect.mapError(
          () =>
            new TiximCommandError({
              message: "tix harnesses models returned unexpected output.",
            }),
        ),
      ),
    ),
    Effect.map((result) => result.models),
    Effect.catchIf(
      (error) => /unrecognized subcommand|unimplemented/i.test(error.message),
      () =>
        // The gateway list cannot describe what a harness's own login may run.
        input.routing === "default"
          ? gatewayModels
          : Effect.fail(
              new TiximCommandError({
                message:
                  "This connection needs a newer Tixim daemon and tix CLI to list harness models.",
              }),
            ),
    ),
  );
  const models = yield* input.routing === "gateway" ? gatewayModels : harnessModels;
  return { models: [...new Map(models.map((model) => [model.id, model])).values()] };
});
