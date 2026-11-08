// @effect-diagnostics nodeBuiltinImport:off - The handoff must still answer while the server's fibers are stuck in shutdown.
// @effect-diagnostics globalTimers:off
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { compareExactServiceVersions, isExactServiceVersion } from "./cloud/serviceProtocol.ts";

export const NIX_STORE_PATH_ENV = "T3CODE_NIX_STORE_PATH";
// A shutdown can hang with the ownership lock held, so yielding always ends in an exit.
const HANDOFF_SHUTDOWN_DEADLINE_MS = 15_000;
export const HANDOFF_WAIT_MS = HANDOFF_SHUTDOWN_DEADLINE_MS + 5_000;
export const HANDOFF_POLL_MS = 250;

const SOCKET_FILE = "server-handoff.sock";
const EXCHANGE_TIMEOUT_MS = 2_000;
const MAX_MESSAGE_CHARS = 4_096;
const STORE_PATH = /^\/nix\/store\/[0-9a-df-np-sv-z]{32}-t3code-[^/]+$/;

const HandoffRequest = Schema.Struct({ storePath: Schema.String, serverVersion: Schema.String });
type HandoffRequest = typeof HandoffRequest.Type;
const HandoffReply = Schema.Struct({
  accepted: Schema.Boolean,
  reason: Schema.optional(Schema.String),
});
type HandoffReply = typeof HandoffReply.Type;

const decodeRequest = Schema.decodeUnknownOption(Schema.fromJsonString(HandoffRequest));
const decodeReply = Schema.decodeUnknownOption(Schema.fromJsonString(HandoffReply));

const hasServerEntry = (storePath: string): boolean => {
  try {
    return NodeFS.statSync(NodePath.join(storePath, "bin", "t3")).isFile();
  } catch {
    return false;
  }
};

export interface ServerHandoffPolicy {
  /** Why this server cannot yield right now, such as a live supervisor that would restart it. */
  readonly refusal?: () => string | undefined;
  readonly yieldServer?: () => void;
  readonly isInstalled?: (storePath: string) => boolean;
}

/** Store paths identify a build; Nix rebuilds of one release all share its version. */
export function handoffRefusal(input: {
  readonly request: HandoffRequest;
  readonly ownStorePath: string;
  readonly ownVersion: string;
  readonly isInstalled: (storePath: string) => boolean;
}): string | undefined {
  const { request, ownStorePath, ownVersion, isInstalled } = input;
  if (!STORE_PATH.test(request.storePath)) return "not a T3 Code store path";
  if (request.storePath === ownStorePath) return "this build is already running";
  if (
    isExactServiceVersion(request.serverVersion) &&
    isExactServiceVersion(ownVersion) &&
    compareExactServiceVersions(request.serverVersion, ownVersion) < 0
  ) {
    return `refusing to downgrade from ${ownVersion} to ${request.serverVersion}`;
  }
  if (!isInstalled(request.storePath)) return "the new build has no server entry";
  return undefined;
}

const terminateForHandoff = () => {
  setTimeout(() => process.exit(0), HANDOFF_SHUTDOWN_DEADLINE_MS).unref();
  process.kill(process.pid, "SIGTERM");
};

/** Owned by the lock holder, so the path is free to replace: any socket found is a dead owner's. */
export const listenForServerHandoff = Effect.fn("serverHandoff.listen")(function* (input: {
  readonly stateDir: string;
  readonly ownStorePath: string;
  readonly ownVersion: string;
  readonly policy?: ServerHandoffPolicy;
}) {
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const yieldServer = input.policy?.yieldServer ?? terminateForHandoff;
  const isInstalled = input.policy?.isInstalled ?? hasServerEntry;
  const socketPath = NodePath.join(input.stateDir, SOCKET_FILE);
  let yielded = false;

  const answer = (socket: NodeNet.Socket, line: string) => {
    const request = decodeRequest(line);
    const reason = Option.isNone(request)
      ? "malformed handoff request"
      : (input.policy?.refusal?.() ??
        handoffRefusal({
          request: request.value,
          ownStorePath: input.ownStorePath,
          ownVersion: input.ownVersion,
          isInstalled,
        }));
    const reply: HandoffReply =
      reason === undefined ? { accepted: true } : { accepted: false, reason };
    socket.end(`${JSON.stringify(reply)}\n`, () => {
      if (reason !== undefined || yielded || Option.isNone(request)) return;
      yielded = true;
      runFork(
        Effect.logWarning("yielding this T3 home to a newer Nix build", {
          storePath: request.value.storePath,
        }),
      );
      yieldServer();
    });
  };

  const onConnection = (socket: NodeNet.Socket) => {
    socket.setTimeout(EXCHANGE_TIMEOUT_MS, () => socket.destroy());
    socket.on("error", () => undefined);
    let buffered = "";
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const newline = buffered.indexOf("\n");
      if (newline !== -1) {
        socket.off("data", onData);
        answer(socket, buffered.slice(0, newline));
      } else if (buffered.length > MAX_MESSAGE_CHARS) {
        socket.destroy();
      }
    };
    socket.on("data", onData);
  };

  // Losing the handoff must never cost the server its startup.
  yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<NodeNet.Server | string>((resolve) => {
          try {
            NodeFS.rmSync(socketPath, { force: true });
          } catch (cause) {
            resolve(String(cause));
            return;
          }
          const server = NodeNet.createServer(onConnection);
          server.once("error", (cause) => resolve(String(cause)));
          server.listen(socketPath, () => {
            NodeFS.chmod(socketPath, 0o600, (cause) => {
              server.unref();
              if (cause === null) {
                resolve(server);
              } else {
                server.close();
                resolve(String(cause));
              }
            });
          });
        }),
    ).pipe(
      Effect.tap((server) =>
        typeof server === "string"
          ? Effect.logWarning("Nix server handoff is unavailable", { cause: server })
          : Effect.void,
      ),
    ),
    (server) =>
      Effect.sync(() => {
        if (typeof server !== "string") server.close();
      }),
  );
});

/** Undefined when no owner answers, which includes every build without handoff support. */
export const requestServerHandoff = (input: {
  readonly stateDir: string;
  readonly storePath: string;
  readonly serverVersion: string;
}): Effect.Effect<HandoffReply | undefined> =>
  Effect.promise(
    () =>
      new Promise<HandoffReply | undefined>((resolve) => {
        const socket = NodeNet.createConnection(NodePath.join(input.stateDir, SOCKET_FILE));
        let buffered = "";
        const finish = (reply: HandoffReply | undefined) => {
          socket.destroy();
          resolve(reply);
        };
        socket.setTimeout(EXCHANGE_TIMEOUT_MS, () => finish(undefined));
        socket.on("error", () => finish(undefined));
        socket.on("close", () => finish(undefined));
        socket.on("connect", () => {
          socket.write(
            `${JSON.stringify({ storePath: input.storePath, serverVersion: input.serverVersion })}\n`,
          );
        });
        socket.on("data", (chunk) => {
          buffered += chunk.toString("utf8");
          const newline = buffered.indexOf("\n");
          if (newline !== -1) {
            finish(Option.getOrUndefined(decodeReply(buffered.slice(0, newline))));
          } else if (buffered.length > MAX_MESSAGE_CHARS) {
            finish(undefined);
          }
        });
      }),
  );
