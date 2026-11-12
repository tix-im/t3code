import {
  TiximCommandError,
  TiximWorkflowRun,
  type TiximWorkflowConnection,
  type TiximWorkflowRelationship,
  type TiximWorkflowLinkInput,
  type TiximWorkflowSearchInput,
  type TiximFlowRpcInput,
} from "@t3tools/contracts";
import { tiximHostEnvironment, resolveTiximCommand } from "@t3tools/plugin-tixim-provider/server";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";
import { ProcessRunner } from "../../src/plugins/host.ts";
import { ServerSettings } from "../../src/plugins/host.ts";

const Snapshot = Schema.Struct({
  daemonId: Schema.String,
  runs: Schema.Array(
    Schema.Struct({
      runId: Schema.String,
      name: Schema.String,
      state: Schema.String,
      parentRunId: Schema.String,
      submittedAt: Schema.NullOr(Schema.Number),
      startedAt: Schema.NullOr(Schema.Number),
      finishedAt: Schema.NullOr(Schema.Number),
      attention: Schema.Boolean,
      automatic: Schema.Boolean,
      hosting: Schema.Boolean,
    }),
  ),
});
const ExecutionProgress = Schema.Struct({ executing: Schema.Boolean, revision: Schema.String });
const ProgressSnapshot = Schema.Struct({
  daemonId: Schema.String,
  runs: Schema.Array(
    Schema.Struct({
      runId: Schema.String,
      state: Schema.String,
      attention: Schema.Boolean,
      progress: ExecutionProgress,
    }),
  ),
});
export type WorkflowObservation = TiximWorkflowRun & {
  readonly progress?: typeof ExecutionProgress.Type;
};
const decodeProgress = Schema.decodeEffect(Schema.fromJsonString(ProgressSnapshot));
const encodeProgressInput = Schema.encodeSync(
  Schema.fromJsonString(Schema.Struct({ runIds: Schema.Array(Schema.String) })),
);
const encodeConnectionKey = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      connectionId: Schema.String,
      daemonId: Schema.String,
    }),
  ),
);
const ProviderThread = Schema.Struct({
  providerInstanceId: Schema.String,
  nativeThreadRef: Schema.NullOr(Schema.Struct({ nativeId: Schema.NullOr(Schema.String) })),
});
const Config = Schema.Struct({ context: Schema.optional(Schema.String) });
const encodeRun = Schema.encodeSync(Schema.fromJsonString(TiximWorkflowRun));
const encodeSnapshotInput = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      origin: Schema.String,
      sessionIds: Schema.Array(Schema.String),
      knownHosts: Schema.Array(Schema.Struct({ daemonId: Schema.String, runId: Schema.String })),
    }),
  ),
);
const decodeRun = Schema.decodeSync(Schema.fromJsonString(TiximWorkflowRun));
const decodeConfig = Schema.decodeEffect(Config);
const decodeProviderThread = Schema.decodeEffect(Schema.fromJsonString(ProviderThread));
const decodeSnapshot = Schema.decodeEffect(Schema.fromJsonString(Snapshot));
const failure = () =>
  new TiximCommandError({
    message: "The workflow connection is unavailable or access was denied.",
  });
const safe = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.mapError(failure));

const threadExists = Effect.fn(function* (threadId: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows =
    yield* sql`SELECT 1 FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId} AND deleted_at IS NULL`;
  return rows.length > 0;
});
const thread = Effect.fn(function* (threadId: string) {
  if (!(yield* threadExists(threadId))) return yield* failure();
});
const connection = Effect.fn(function* (id: string) {
  const settings = yield* (yield* ServerSettings.ServerSettingsService).getSettings;
  const entry = Object.entries(settings.providerInstances).find(([key]) => key === id)?.[1];
  if (entry?.driver !== "tixim") return yield* failure();
  const config = yield* decodeConfig(entry.config ?? {});
  const context = config.context ?? "";
  const environment = yield* mergeProviderInstanceEnvironment(
    entry.environment,
    yield* HostProcess.Environment,
  );
  return {
    context,
    label: entry.displayName ?? id,
    environment: tiximHostEnvironment(environment, { context }),
  };
});
const snapshot = Effect.fn(function* (threadId: string, connectionId: string) {
  const sql = yield* SqlClient.SqlClient;
  const selected = yield* connection(connectionId);
  const providerThreads = yield* sql<{
    payload_json: string;
  }>`SELECT payload_json FROM orchestration_v2_projection_provider_threads WHERE thread_id = ${threadId}`;
  const sessionIds: string[] = [];
  for (const row of providerThreads) {
    const value = yield* decodeProviderThread(row.payload_json);
    if (value.providerInstanceId === connectionId && value.nativeThreadRef?.nativeId)
      sessionIds.push(value.nativeThreadRef.nativeId);
  }
  const knownHosts = yield* sql<{ daemonId: string; runId: string }>`
    SELECT daemon_id AS daemonId, run_id AS runId FROM tixim_workflow_links
    WHERE thread_id = ${threadId} AND source = 'agent_session' AND excluded = 0`;
  const runner = yield* ProcessRunner.ProcessRunner;
  const output = yield* runner.run({
    command: resolveTiximCommand(selected.environment),
    args: [...(selected.context ? ["--context", selected.context] : []), "flow-bridge", "snapshot"],
    stdin: encodeSnapshotInput({ origin: threadId, sessionIds, knownHosts }),
    env: { ...selected.environment, TIX_WAIT_FOR_DAEMON: "0" },
    // A snapshot paginates the daemon's complete history, including finished runs.
    timeout: "2 minutes",
    maxOutputBytes: 32 * 1024 * 1024,
  });
  if (output.code !== 0) return yield* failure();
  return {
    ...(yield* decodeSnapshot(output.stdout)),
    label: selected.label,
  };
});

const savedState = Effect.fn("TiximWorkflows.savedState")(function* (threadId: string) {
  if (!(yield* threadExists(threadId))) return { previous: [], connections: [] };
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* (yield* ServerSettings.ServerSettingsService).getSettings;
  const previous = yield* sql<{
    daemon_id: string;
    connection_id: string;
    run_id: string;
    excluded: number;
    payload_json: string;
    relationship: TiximWorkflowRelationship;
  }>`SELECT * FROM tixim_workflow_links WHERE thread_id = ${threadId}`;
  const ids = new Set([
    ...Object.entries(settings.providerInstances)
      .filter(([, value]) => value.driver === "tixim")
      .map(([id]) => id),
    ...previous.map((row) => row.connection_id),
  ]);
  const providers = new Map(Object.entries(settings.providerInstances));
  return {
    previous,
    connections: Array.from(ids, (id): TiximWorkflowConnection => ({
      id,
      label: providers.get(id)?.displayName ?? id,
      daemonId: "",
      available: false,
      loading: true,
    })),
  };
});

export const list = Effect.fn(function* (threadId: string) {
  const { previous, connections: configured } = yield* savedState(threadId);
  const sql = yield* SqlClient.SqlClient;
  const runs = new Map<string, TiximWorkflowRun>(
    previous
      .filter((row) => !row.excluded)
      .map((row) => [
        `${row.daemon_id}/${row.run_id}`,
        { ...decodeRun(row.payload_json), availability: "unavailable" as const },
      ]),
  );
  const connections: TiximWorkflowConnection[] = [];
  for (const entry of configured) {
    const { id } = entry;
    const result = yield* Effect.result(snapshot(threadId, id));
    if (result._tag === "Failure") {
      connections.push({
        ...entry,
        loading: false,
        error:
          result.failure._tag === "ProcessTimeoutError"
            ? "Loading workflows timed out. Reload the connection to try again."
            : failure().message,
      });
      continue;
    }
    const current = result.success;
    connections.push({ id, label: current.label, daemonId: current.daemonId, available: true });
    for (const value of current.runs) {
      const key = `${current.daemonId}/${value.runId}`;
      const existing = previous.find(
        (row) => row.daemon_id === current.daemonId && row.run_id === value.runId,
      );
      if (existing?.excluded || (!existing && !value.automatic)) continue;
      const source = value.hosting
        ? ("agent_session" as const)
        : (runs.get(key)?.source ??
          (existing ? decodeRun(existing.payload_json).source : ("automatic" as const)));
      const run: TiximWorkflowRun = {
        ...value,
        daemonId: current.daemonId,
        connectionId:
          runs.get(key)?.availability === "available" ? runs.get(key)!.connectionId : id,
        source,
        relationship: existing?.relationship ?? "owner",
        availability: "available",
      };
      yield* sql`INSERT INTO tixim_workflow_links (thread_id, daemon_id, run_id, connection_id, source, relationship, excluded, payload_json)
        SELECT ${threadId}, ${run.daemonId}, ${run.runId}, ${run.connectionId}, ${source}, ${run.relationship}, 0, ${encodeRun(run)}
        WHERE EXISTS (SELECT 1 FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId} AND deleted_at IS NULL)
        ON CONFLICT(thread_id, daemon_id, run_id) DO UPDATE SET payload_json = json_set(excluded.payload_json, '$.relationship', tixim_workflow_links.relationship), connection_id = excluded.connection_id, source = excluded.source
        WHERE tixim_workflow_links.excluded = 0`;
      runs.set(key, run);
    }
  }
  // A user can detach or change a relationship while a daemon snapshot is in flight.
  const linked = yield* sql<{
    payload_json: string;
  }>`SELECT payload_json FROM tixim_workflow_links WHERE thread_id = ${threadId} AND excluded = 0`;
  return {
    runs: linked.map((row) => {
      const run = decodeRun(row.payload_json);
      return {
        ...run,
        availability:
          runs.get(`${run.daemonId}/${run.runId}`)?.availability ?? ("unavailable" as const),
      };
    }),
    connections,
  };
});

/** Only exact execution IDs are suggestions; prose and workflow definitions are not ownership. @public */
export function mentionedWorkflowIds(text: string): ReadonlySet<string> {
  return new Set(text.match(/(?<![\w-])wf-[a-z0-9]+(?:-[a-z0-9]+)+(?![\w-])/g) ?? []);
}

const searchImpl = Effect.fn(function* (input: TiximWorkflowSearchInput) {
  yield* thread(input.threadId);
  const result = yield* snapshot(input.threadId, input.connectionId);
  const query = input.query.toLowerCase().trim();
  const sql = yield* SqlClient.SqlClient;
  const mentions = new Set<string>();
  if (input.mentionedOnly) {
    const messages = yield* sql<{
      text: string;
    }>`SELECT json_extract(payload_json, '$.text') AS text
      FROM orchestration_v2_projection_messages WHERE thread_id = ${input.threadId}
      AND role IN ('user', 'assistant') AND json_extract(payload_json, '$.text') LIKE '%wf-%'`;
    for (const message of messages)
      for (const id of mentionedWorkflowIds(message.text)) mentions.add(id);
  }
  return {
    runs: result.runs
      .filter(
        (r) =>
          (!input.mentionedOnly || mentions.has(r.runId)) &&
          `${r.name} ${r.runId}`.toLowerCase().includes(query),
      )
      .slice(0, 100)
      .map((r): TiximWorkflowRun => ({
        ...r,
        daemonId: result.daemonId,
        connectionId: input.connectionId,
        source: "manual",
        relationship: "tracking",
        availability: "available",
      })),
    connections: [
      { id: input.connectionId, label: result.label, daemonId: result.daemonId, available: true },
    ],
  };
});
export const search = (input: TiximWorkflowSearchInput) => safe(searchImpl(input));

const linkImpl = Effect.fn(function* (input: TiximWorkflowLinkInput) {
  yield* thread(input.threadId);
  const sql = yield* SqlClient.SqlClient;
  if (input.attach) {
    const previous = yield* sql<{
      source: TiximWorkflowRun["source"];
      relationship: TiximWorkflowRelationship;
    }>`SELECT source, relationship FROM tixim_workflow_links
      WHERE thread_id = ${input.threadId} AND daemon_id = ${input.daemonId} AND run_id = ${input.runId}`;
    const current = yield* snapshot(input.threadId, input.connectionId);
    const found = current.runs.find((r) => r.runId === input.runId);
    if (current.daemonId !== input.daemonId || !found) return yield* failure();
    const run: TiximWorkflowRun = {
      ...found,
      connectionId: input.connectionId,
      daemonId: current.daemonId,
      source: found.hosting ? "agent_session" : (previous[0]?.source ?? "manual"),
      relationship:
        input.relationship ?? previous[0]?.relationship ?? (found.hosting ? "owner" : "tracking"),
      availability: "available",
    };
    yield* sql`INSERT INTO tixim_workflow_links (thread_id, daemon_id, run_id, connection_id, source, relationship, excluded, payload_json)
      SELECT ${input.threadId}, ${input.daemonId}, ${input.runId}, ${input.connectionId}, ${run.source}, ${run.relationship}, 0, ${encodeRun(run)}
      WHERE EXISTS (SELECT 1 FROM orchestration_v2_projection_threads WHERE thread_id = ${input.threadId} AND deleted_at IS NULL)
      ON CONFLICT(thread_id, daemon_id, run_id) DO UPDATE SET excluded = 0, connection_id = excluded.connection_id, source = excluded.source, relationship = excluded.relationship, payload_json = excluded.payload_json`;
  } else {
    yield* sql`UPDATE tixim_workflow_links SET excluded = 1 WHERE thread_id = ${input.threadId} AND daemon_id = ${input.daemonId} AND run_id = ${input.runId}`;
  }
  return yield* list(input.threadId);
});
export const link = (input: TiximWorkflowLinkInput) => safe(linkImpl(input));

const observe = Effect.fn("TiximWorkflows.observe")(function* (
  threadId: string,
  targets: ReadonlyArray<TiximWorkflowRun>,
) {
  yield* thread(threadId);
  const sql = yield* SqlClient.SqlClient;
  const runner = yield* ProcessRunner.ProcessRunner;
  const wanted = new Set(targets.map((run) => `${run.daemonId}/${run.runId}`));
  const rows = yield* sql<{
    payload_json: string;
  }>`SELECT payload_json FROM tixim_workflow_links WHERE thread_id = ${threadId} AND excluded = 0`;
  const groups = new Map<string, TiximWorkflowRun[]>();
  for (const row of rows) {
    const run = decodeRun(row.payload_json);
    if (!wanted.has(`${run.daemonId}/${run.runId}`)) continue;
    const group = encodeConnectionKey({ connectionId: run.connectionId, daemonId: run.daemonId });
    groups.set(group, [...(groups.get(group) ?? []), run]);
  }
  const observations: WorkflowObservation[] = [];
  for (const runs of groups.values()) {
    const first = runs[0]!;
    const result = yield* Effect.result(
      Effect.gen(function* () {
        const selected = yield* connection(first.connectionId);
        const output = yield* runner.run({
          command: resolveTiximCommand(selected.environment),
          args: [
            ...(selected.context ? ["--context", selected.context] : []),
            "flow-bridge",
            "progress",
            "--daemon",
            first.daemonId,
          ],
          stdin: encodeProgressInput({ runIds: runs.map((run) => run.runId) }),
          env: { ...selected.environment, TIX_WAIT_FOR_DAEMON: "0" },
          timeout: "2 minutes",
          maxOutputBytes: 32 * 1024 * 1024,
        });
        if (output.code !== 0) return yield* failure();
        const snapshot = yield* decodeProgress(output.stdout);
        if (snapshot.daemonId !== first.daemonId) return yield* failure();
        return snapshot;
      }),
    );
    for (const run of runs) {
      const value =
        result._tag === "Success"
          ? result.success.runs.find((r) => r.runId === run.runId)
          : undefined;
      observations.push(
        value
          ? { ...run, ...value, availability: "available" }
          : { ...run, availability: "unavailable" },
      );
    }
  }
  // A detach during the daemon read must win over its result.
  const linked = yield* sql<{
    daemon_id: string;
    run_id: string;
  }>`SELECT daemon_id, run_id FROM tixim_workflow_links WHERE thread_id = ${threadId} AND excluded = 0`;
  return observations.filter((run) =>
    linked.some((link) => link.daemon_id === run.daemonId && link.run_id === run.runId),
  );
});

export const live = (threadId: string) =>
  Stream.concat(
    Stream.fromEffect(safe(savedState(threadId))).pipe(
      Stream.map(({ previous, connections }) => ({
        runs: previous
          .filter((row) => !row.excluded)
          .map((row) => ({
            ...decodeRun(row.payload_json),
            availability: "unavailable" as const,
          })),
        connections,
      })),
    ),
    Stream.fromEffectSchedule(safe(list(threadId)), Schedule.spaced("5 seconds")),
  );

const READ_METHODS = new Set([
  "SubscribeWorkflowEvents",
  "GetWorkflowLogRecords",
  "StreamWorkflowLogRecords",
  "GetStepInvocation",
  "ListStepFileChanges",
  "GetWorkflowDetail",
  "GetWorkflowStatus",
  "GetWorkflowResults",
  "GetWorkflowDefinition",
  "GetPlannerDag",
  "GetRunBudget",
  "GetStepLog",
  "StreamWorkflowLogs",
  "StreamWorkflowEvents",
  "StreamWorkflowList",
  "ListWorkflowReports",
  "ListWorkflowBlockers",
  "ListPendingApprovals",
  "GetPendingApproval",
  "ListApprovals",
  "GetApproval",
  "GetWorkflowRunFiles",
  "GetWorkflowRunFile",
  "ListRunSnapshots",
  "GetRunReapStatus",
]);
const WRITE_METHODS = new Set([
  "CancelWorkflow",
  "SuspendWorkflowRun",
  "ResumeWorkflowRun",
  "FreezeWorkflowRun",
  "ThawWorkflowRun",
  "RestartWorkflowRun",
  "SetWorkflowTitle",
  "SetWorkflowMeta",
  "SubmitPendingApproval",
  "AnswerWorkflowInput",
  "TopUpRunBudget",
  "MutatePlannerDag",
]);
export function allowedFlowMethod(path: string, write: boolean) {
  const [service, method, extra] = path.split("/");
  return (
    extra === undefined &&
    (service === "tix.control.v1.WorkflowsControl" ||
      service === "tix.control.v1.ApprovalsControl") &&
    (write ? WRITE_METHODS : READ_METHODS).has(method ?? "")
  );
}
export const rpc = (input: TiximFlowRpcInput, write: boolean) =>
  Stream.unwrap(
    safe(
      Effect.gen(function* () {
        yield* thread(input.threadId);
        if (!allowedFlowMethod(input.method, write)) return yield* failure();
        const sql = yield* SqlClient.SqlClient;
        const bound =
          yield* sql`SELECT 1 FROM tixim_workflow_links WHERE thread_id = ${input.threadId} AND daemon_id = ${input.daemonId} AND excluded = 0 LIMIT 1`;
        if (bound.length === 0) return yield* failure();
        const selected = yield* connection(input.connectionId);
        const runner = yield* ProcessRunner.ProcessRunner;
        let buffered = 0;
        return Stream.callback<string, TiximCommandError>((queue) =>
          Effect.gen(function* () {
            let pending = "";
            const output = yield* runner.run({
              command: resolveTiximCommand(selected.environment),
              args: [
                ...(selected.context ? ["--context", selected.context] : []),
                "flow-bridge",
                "rpc",
                "--daemon",
                input.daemonId,
                "--method",
                input.method,
              ],
              env: { ...selected.environment, TIX_WAIT_FOR_DAEMON: "0" },
              stdin: input.body,
              timeout: "24 hours",
              maxOutputBytes: 1,
              outputMode: "truncate",
              onStdoutChunk: (chunk) => {
                pending += Buffer.from(chunk).toString("utf8");
                if (buffered + pending.length > 64 * 1024 * 1024) {
                  Queue.failCauseUnsafe(queue, Cause.fail(failure()));
                  return;
                }
                const lines = pending.split("\n");
                pending = lines.pop() ?? "";
                for (const line of lines)
                  if (line) {
                    buffered += line.length;
                    Queue.offerUnsafe(queue, line);
                  }
              },
            });
            if (output.code !== 0) return yield* Queue.fail(queue, failure());
            yield* Queue.end(queue);
          }).pipe(Effect.catch(() => Queue.fail(queue, failure()))),
        ).pipe(
          Stream.tap((line) =>
            Effect.sync(() => {
              buffered -= line.length;
            }),
          ),
        );
      }),
    ),
  );

export class WorkflowOperations extends Context.Service<
  WorkflowOperations,
  {
    readonly observe: (
      threadId: string,
      targets: ReadonlyArray<TiximWorkflowRun>,
    ) => Effect.Effect<ReadonlyArray<WorkflowObservation>, TiximCommandError>;
    readonly list: (
      threadId: string,
    ) => Effect.Effect<
      typeof import("@t3tools/contracts").TiximWorkflowListResult.Type,
      TiximCommandError
    >;
    readonly search: (
      input: TiximWorkflowSearchInput,
    ) => Effect.Effect<
      typeof import("@t3tools/contracts").TiximWorkflowListResult.Type,
      TiximCommandError
    >;
    readonly link: (
      input: TiximWorkflowLinkInput,
    ) => Effect.Effect<
      typeof import("@t3tools/contracts").TiximWorkflowListResult.Type,
      TiximCommandError
    >;
  }
>()("t3/plugins/tixim/TiximWorkflows/WorkflowOperations") {}
export const layer = Layer.effect(
  WorkflowOperations,
  Effect.gen(function* () {
    const context = yield* Effect.context<
      SqlClient.SqlClient | ServerSettings.ServerSettingsService | ProcessRunner.ProcessRunner
    >();
    return WorkflowOperations.of({
      observe: Effect.fn("WorkflowOperations.observe")(
        (id: string, targets: ReadonlyArray<TiximWorkflowRun>) =>
          safe(observe(id, targets)).pipe(Effect.provide(context)),
      ),
      list: Effect.fn("WorkflowOperations.list")((id: string) =>
        safe(list(id)).pipe(Effect.provide(context)),
      ),
      search: Effect.fn("WorkflowOperations.search")((input: TiximWorkflowSearchInput) =>
        search(input).pipe(Effect.provide(context)),
      ),
      link: Effect.fn("WorkflowOperations.link")((input: TiximWorkflowLinkInput) =>
        link(input).pipe(Effect.provide(context)),
      ),
    });
  }),
);
