import { DesktopTiximProjectSchema } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as IpcChannels from "./channels.ts";
import { DesktopIpc } from "../../src/plugins/host.ts";

const TIX_COMMAND_TIMEOUT = "15 seconds";
const MAX_TIX_ERROR_OUTPUT_LENGTH = 4_000;

export class DesktopTiximCliNotFoundError extends Schema.TaggedError<DesktopTiximCliNotFoundError>()(
  "DesktopTiximCliNotFoundError",
  { command: Schema.String },
) {
  // The web client matches "[tix_not_found]" to explain how to install the CLI.
  override get message(): string {
    return `[tix_not_found] tix CLI not found (${this.command}). Install tix or set T3_TIX_BIN.`;
  }
}

export class DesktopTiximCommandError extends Schema.TaggedError<DesktopTiximCommandError>()(
  "DesktopTiximCommandError",
  {
    args: Schema.Array(Schema.String),
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `tix ${this.args.join(" ")} failed: ${this.detail}`;
  }
}

const resolveTixCommand = (): string => process.env.T3_TIX_BIN?.trim() || "tix";

const collectOutput = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const runTixCommand = Effect.fn("desktop.tixim.runCommand")(function* (
  args: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = resolveTixCommand();
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(command, [...args], {
          stdin: "ignore",
          // Releasing a timed-out command otherwise waits on SIGTERM indefinitely.
          forceKillAfter: "1 second",
        }),
      );
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [collectOutput(child.stdout), collectOutput(child.stderr), child.exitCode],
        { concurrency: "unbounded" },
      );
      return { stdout, stderr, exitCode: Number(exitCode) };
    }),
  ).pipe(
    Effect.timeoutOption(TIX_COMMAND_TIMEOUT),
    Effect.mapError((cause) =>
      cause.reason._tag === "NotFound"
        ? new DesktopTiximCliNotFoundError({ command })
        : new DesktopTiximCommandError({ args, detail: cause.message, cause }),
    ),
  );

  if (Option.isNone(result)) {
    return yield* new DesktopTiximCommandError({
      args,
      detail: `timed out after ${TIX_COMMAND_TIMEOUT}.`,
    });
  }
  const { stdout, stderr, exitCode } = result.value;
  if (exitCode !== 0) {
    const output = stderr.trim() || stdout.trim();
    return yield* new DesktopTiximCommandError({
      args,
      detail: `exit ${exitCode}${output ? `: ${output.slice(0, MAX_TIX_ERROR_OUTPUT_LENGTH)}` : ""}`,
    });
  }
  return stdout;
});

const decodeTiximProjects = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(DesktopTiximProjectSchema)),
);

export const discoverTiximProjects = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.DISCOVER_TIXIM_PROJECTS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(DesktopTiximProjectSchema),
  handler: Effect.fn("desktop.ipc.tiximEnvironment.discoverProjects")(function* () {
    const args = ["ssh", "hosts", "--json"];
    const stdout = yield* runTixCommand(args);
    return yield* decodeTiximProjects(stdout).pipe(
      Effect.mapError(
        (cause) => new DesktopTiximCommandError({ args, detail: "unexpected output.", cause }),
      ),
    );
  }),
});

export const installTiximSshConfig = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.INSTALL_TIXIM_SSH_CONFIG_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.tiximEnvironment.installSshConfig")(function* () {
    const environment = yield* HostProcess.Environment;
    yield* runTixCommand([
      "ssh",
      "config",
      "--write",
      "--workflow",
      environment.T3_TIXIM_WORKFLOW?.trim() || "catalog:t3-code/t3-desktop",
    ]);
  }),
});
