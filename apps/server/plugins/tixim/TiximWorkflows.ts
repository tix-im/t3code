import {
  TiximCommandError,
  TiximWorkflowListResult,
  TiximWorkflowOverview,
  TiximWorkflowRun,
  type TiximThreadWorkflows,
  TiximWorkflowRunDetails,
  type TiximWorkflowConnection,
  type TiximWorkflowRelationship,
  type TiximWorkflowLinkInput,
  type TiximWorkflowLogInput,
  type TiximWorkflowSearchInput,
  type TiximFlowRpcInput,
} from "@t3tools/contracts";
import { tiximHostEnvironment, resolveTiximCommand } from "@t3tools/plugin-tixim-provider/server";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Exit from "effect/Exit";
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
      ...TiximWorkflowRunDetails,
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
      runIds: Schema.Array(Schema.String),
    }),
  ),
);
const BridgeSearch = Schema.Struct({
  query: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  references: Schema.optional(Schema.Array(Schema.String)),
});
const encodeSearchInput = Schema.encodeSync(Schema.fromJsonString(BridgeSearch));
const encodeList = Schema.encodeSync(Schema.fromJsonString(TiximWorkflowListResult));
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
export const connection = Effect.fn(function* (id: string) {
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
const readBridge = Effect.fn("TiximWorkflows.readBridge")(function* (
  connectionId: string,
  command: "snapshot" | "search",
  stdin: string,
) {
  const selected = yield* connection(connectionId);
  const runner = yield* ProcessRunner.ProcessRunner;
  const output = yield* runner.run({
    command: resolveTiximCommand(selected.environment),
    args: [...(selected.context ? ["--context", selected.context] : []), "flow-bridge", command],
    stdin,
    env: { ...selected.environment, TIX_WAIT_FOR_DAEMON: "0" },
    timeout: "45 seconds",
    maxOutputBytes: 32 * 1024 * 1024,
  });
  if (output.code !== 0) return yield* failure();
  return {
    ...(yield* decodeSnapshot(output.stdout)),
    label: selected.label,
  };
});

const snapshot = Effect.fn(function* (
  threadId: string,
  connectionId: string,
  runIds: ReadonlyArray<string>,
) {
  const sql = yield* SqlClient.SqlClient;
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
  return yield* readBridge(
    connectionId,
    "snapshot",
    encodeSnapshotInput({ origin: threadId, sessionIds, knownHosts, runIds }),
  );
});

const FINISHED_STATES = new Set(["completed", "failed", "cancelled"]);
/** A restart creates a new run, so a finished run never changes. Links saved before counts existed still need one read. */
const isSettled = (run: TiximWorkflowRun) =>
  FINISHED_STATES.has(run.state) && run.steps !== undefined;

const savedState = Effect.fn("TiximWorkflows.savedState")(function* (threadId: string) {
  if (!(yield* threadExists(threadId))) return { previous: [], connections: [], snoozed: false };
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
  const snoozes = yield* sql`SELECT 1 FROM tixim_workflow_snoozes WHERE thread_id = ${threadId}`;
  return {
    previous,
    snoozed: snoozes.length > 0,
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
  const { previous, connections: configured, snoozed } = yield* savedState(threadId);
  const sql = yield* SqlClient.SqlClient;
  const attached = previous
    .filter((row) => !row.excluded)
    .map((row) => ({ row, run: decodeRun(row.payload_json) }));
  const runs = new Map<string, TiximWorkflowRun>(
    attached.map(({ row, run }) => [
      `${row.daemon_id}/${row.run_id}`,
      { ...run, availability: "unavailable" as const },
    ]),
  );
  const reads = yield* Effect.forEach(
    configured,
    (entry) =>
      Effect.result(
        snapshot(
          threadId,
          entry.id,
          attached
            .filter(({ row, run }) => row.connection_id === entry.id && !isSettled(run))
            .map(({ row }) => row.run_id),
        ),
      ).pipe(Effect.map((result) => ({ entry, result }))),
    { concurrency: "unbounded" },
  );
  const connections: TiximWorkflowConnection[] = [];
  for (const { entry, result } of reads) {
    const { id } = entry;
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
      // A restarted run leaves its terminal state here, which re-arms its notification.
      yield* sql`INSERT INTO tixim_workflow_links (thread_id, daemon_id, run_id, connection_id, source, relationship, excluded, payload_json, last_state, attention_seen)
        SELECT ${threadId}, ${run.daemonId}, ${run.runId}, ${run.connectionId}, ${source}, ${run.relationship}, 0, ${encodeRun(run)}, ${run.state}, ${run.attention ? 1 : 0}
        WHERE EXISTS (SELECT 1 FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId} AND deleted_at IS NULL)
        ON CONFLICT(thread_id, daemon_id, run_id) DO UPDATE SET payload_json = json_set(excluded.payload_json, '$.relationship', tixim_workflow_links.relationship), connection_id = excluded.connection_id, source = excluded.source,
          last_state = CASE WHEN tixim_workflow_links.last_state IN ('completed', 'failed', 'cancelled', 'skipped') AND excluded.last_state NOT IN ('completed', 'failed', 'cancelled', 'skipped') THEN excluded.last_state ELSE tixim_workflow_links.last_state END
        WHERE tixim_workflow_links.excluded = 0`;
      runs.set(key, run);
    }
  }
  // A user can detach or change a relationship while a daemon snapshot is in flight.
  const linked = yield* sql<{
    payload_json: string;
  }>`SELECT payload_json FROM tixim_workflow_links WHERE thread_id = ${threadId} AND excluded = 0`;
  const reachable = connections.filter((entry) => entry.available);
  return {
    runs: linked.map((row) => {
      const run = decodeRun(row.payload_json);
      const home =
        reachable.find(
          (entry) => entry.id === run.connectionId && entry.daemonId === run.daemonId,
        ) ?? reachable.find((entry) => entry.daemonId === run.daemonId);
      const observed = runs.get(`${run.daemonId}/${run.runId}`)?.availability === "available";
      return {
        ...run,
        connectionId: home?.id ?? run.connectionId,
        availability:
          observed || (home !== undefined && isSettled(run))
            ? ("available" as const)
            : ("unavailable" as const),
      };
    }),
    connections,
    ...(snoozed ? { snoozed } : {}),
  };
});

/** Only exact execution IDs are suggestions; prose and workflow definitions are not ownership. @public */
export function mentionedWorkflowIds(text: string): ReadonlySet<string> {
  return new Set(text.match(/(?<![\w-])wf-[a-z0-9]+(?:-[a-z0-9]+)+(?![\w-])/g) ?? []);
}

const MENTION_LOOKUP_LIMIT = 30;
const RECENT_PAGE_SIZE = 200;
const RECENT_PAGE_TTL = Duration.seconds(10);
const SEARCH_RESULT_LIMIT = 100;
const EXACT_REFERENCE =
  /^(?:wf-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{4}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/;

const mentionedReferences = Effect.fn("TiximWorkflows.mentionedReferences")(function* (
  threadId: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const messages = yield* sql<{
    text: string;
  }>`SELECT json_extract(payload_json, '$.text') AS text
    FROM orchestration_v2_projection_messages WHERE thread_id = ${threadId}
    AND role IN ('user', 'assistant') AND json_extract(payload_json, '$.text') LIKE '%wf-%'
    ORDER BY rowid DESC`;
  const mentions = new Set(messages.flatMap((message) => [...mentionedWorkflowIds(message.text)]));
  return [...mentions].slice(0, MENTION_LOOKUP_LIMIT);
});

const readSearch = (connectionId: string, input: typeof BridgeSearch.Type) =>
  readBridge(connectionId, "search", encodeSearchInput(input));
const readRecent = (connectionId: string) => readSearch(connectionId, { limit: RECENT_PAGE_SIZE });
type BridgeRead = Effect.Success<ReturnType<typeof readBridge>>;

const matchesQuery = (run: BridgeRead["runs"][number], query: string) =>
  [run.name, run.definitionName, run.hid, run.runId].some((field) =>
    field?.toLowerCase().includes(query),
  );
const activeThenNewest = (a: BridgeRead["runs"][number], b: BridgeRead["runs"][number]) =>
  Number(FINISHED_STATES.has(a.state)) - Number(FINISHED_STATES.has(b.state)) ||
  (b.submittedAt ?? 0) - (a.submittedAt ?? 0);

const searchImpl = Effect.fn("TiximWorkflows.search")(function* <E, R>(
  input: TiximWorkflowSearchInput,
  recent: (connectionId: string) => Effect.Effect<BridgeRead, E, R>,
) {
  yield* thread(input.threadId);
  const text = input.query.trim();
  const query = text.toLowerCase();
  const mentions = input.mentionedOnly ? yield* mentionedReferences(input.threadId) : [];
  if (input.mentionedOnly && mentions.length === 0) return { runs: [], connections: [] };
  const daemonMatched = !input.mentionedOnly && input.includeHistory === true && query !== "";
  const result = yield* input.mentionedOnly
    ? readSearch(input.connectionId, { references: mentions })
    : EXACT_REFERENCE.test(query)
      ? readSearch(input.connectionId, { references: [query] })
      : daemonMatched
        ? readSearch(input.connectionId, { query: text, limit: SEARCH_RESULT_LIMIT })
        : recent(input.connectionId);
  return {
    runs: result.runs
      .filter(
        (r) =>
          (!input.mentionedOnly || mentions.includes(r.hid ?? r.runId)) &&
          (daemonMatched || matchesQuery(r, query)),
      )
      .toSorted(activeThenNewest)
      .slice(0, SEARCH_RESULT_LIMIT)
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
export const search = (input: TiximWorkflowSearchInput) => safe(searchImpl(input, readRecent));

export const listConnections = Effect.fn("TiximWorkflows.listConnections")(function* () {
  const settings = yield* (yield* ServerSettings.ServerSettingsService).getSettings;
  const entries = Object.entries(settings.providerInstances).filter(
    ([, value]) => value.driver === "tixim",
  );
  const connections = yield* Effect.forEach(
    entries,
    ([id, entry]) =>
      readSearch(id, { limit: 1 }).pipe(
        Effect.map((read): TiximWorkflowConnection => ({
          id,
          label: read.label,
          daemonId: read.daemonId,
          available: true,
        })),
        Effect.orElseSucceed((): TiximWorkflowConnection => ({
          id,
          label: entry.displayName ?? id,
          daemonId: "",
          available: false,
          error: failure().message,
        })),
      ),
    { concurrency: "unbounded" },
  );
  return { connections };
}, safe);

/** Filtering a short-lived page keeps search instant while someone types. */
export const makeCachedSearch = Effect.gen(function* () {
  const context = yield* Effect.context<
    SqlClient.SqlClient | ServerSettings.ServerSettingsService | ProcessRunner.ProcessRunner
  >();
  const recentRuns = yield* Cache.makeWith(
    (connectionId: string) => readRecent(connectionId).pipe(Effect.provide(context)),
    {
      capacity: 16,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? RECENT_PAGE_TTL : Duration.zero),
    },
  );
  return (input: TiximWorkflowSearchInput) =>
    safe(searchImpl(input, (id) => Cache.get(recentRuns, id))).pipe(Effect.provide(context));
});

const dropPending = Effect.fn(function* (input: TiximWorkflowLinkInput) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM tixim_workflow_notifications
    WHERE thread_id = ${input.threadId} AND daemon_id = ${input.daemonId} AND run_id = ${input.runId} AND wake_id IS NULL`;
});

const linkImpl = Effect.fn(function* (input: TiximWorkflowLinkInput) {
  yield* thread(input.threadId);
  const sql = yield* SqlClient.SqlClient;
  if (input.attach) {
    const previous = yield* sql<{
      source: TiximWorkflowRun["source"];
      relationship: TiximWorkflowRelationship;
    }>`SELECT source, relationship FROM tixim_workflow_links
      WHERE thread_id = ${input.threadId} AND daemon_id = ${input.daemonId} AND run_id = ${input.runId}`;
    const current = yield* snapshot(input.threadId, input.connectionId, [input.runId]);
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
    // Starting to track reports nothing already visible; a relationship swap keeps a pending edge.
    yield* sql`INSERT INTO tixim_workflow_links (thread_id, daemon_id, run_id, connection_id, source, relationship, excluded, payload_json, last_state, attention_seen)
      SELECT ${input.threadId}, ${input.daemonId}, ${input.runId}, ${input.connectionId}, ${run.source}, ${run.relationship}, 0, ${encodeRun(run)}, ${run.state}, ${run.attention ? 1 : 0}
      WHERE EXISTS (SELECT 1 FROM orchestration_v2_projection_threads WHERE thread_id = ${input.threadId} AND deleted_at IS NULL)
      ON CONFLICT(thread_id, daemon_id, run_id) DO UPDATE SET connection_id = excluded.connection_id, source = excluded.source, payload_json = excluded.payload_json,
        last_state = CASE WHEN tixim_workflow_links.excluded = 1 OR tixim_workflow_links.relationship = 'untracked' THEN excluded.last_state ELSE tixim_workflow_links.last_state END,
        attention_seen = CASE WHEN tixim_workflow_links.excluded = 1 OR tixim_workflow_links.relationship = 'untracked' THEN excluded.attention_seen ELSE tixim_workflow_links.attention_seen END,
        relationship = excluded.relationship, excluded = 0`;
    if (run.relationship === "untracked") yield* dropPending(input);
  } else {
    yield* sql`UPDATE tixim_workflow_links SET excluded = 1 WHERE thread_id = ${input.threadId} AND daemon_id = ${input.daemonId} AND run_id = ${input.runId}`;
    yield* dropPending(input);
  }
  return yield* list(input.threadId);
});
export const link = (input: TiximWorkflowLinkInput) => safe(linkImpl(input));

const readProgress = Effect.fn("TiximWorkflows.readProgress")(function* (
  connectionId: string,
  daemonId: string,
  runIds: ReadonlyArray<string>,
) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const selected = yield* connection(connectionId);
  const output = yield* runner.run({
    command: resolveTiximCommand(selected.environment),
    args: [
      ...(selected.context ? ["--context", selected.context] : []),
      "flow-bridge",
      "progress",
      "--daemon",
      daemonId,
    ],
    stdin: encodeProgressInput({ runIds }),
    env: { ...selected.environment, TIX_WAIT_FOR_DAEMON: "0" },
    timeout: "2 minutes",
    maxOutputBytes: 32 * 1024 * 1024,
  });
  if (output.code !== 0) return yield* failure();
  const snapshot = yield* decodeProgress(output.stdout);
  if (snapshot.daemonId !== daemonId) return yield* failure();
  return snapshot.runs;
});

const observe = Effect.fn("TiximWorkflows.observe")(function* (
  threadId: string,
  targets: ReadonlyArray<TiximWorkflowRun>,
) {
  yield* thread(threadId);
  const sql = yield* SqlClient.SqlClient;
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
      readProgress(
        first.connectionId,
        first.daemonId,
        runs.map((run) => run.runId),
      ),
    );
    for (const run of runs) {
      const value =
        result._tag === "Success" ? result.success.find((r) => r.runId === run.runId) : undefined;
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
      Stream.map(({ previous, connections, snoozed }) => ({
        runs: previous
          .filter((row) => !row.excluded)
          .map((row) => ({
            ...decodeRun(row.payload_json),
            availability: "unavailable" as const,
          })),
        connections,
        ...(snoozed ? { snoozed } : {}),
      })),
    ),
    Stream.fromEffectSchedule(safe(list(threadId)), Schedule.spaced("5 seconds")),
  ).pipe(Stream.changesWith((a, b) => encodeList(a) === encodeList(b)));

const LOG_TAIL_LINES = 60;
const LogRecords = Schema.Struct({
  records: Schema.Array(
    Schema.Struct({
      cursor: Schema.Struct({ seq: Schema.Number, line: Schema.Number }),
      text: Schema.String,
      step: Schema.optional(Schema.String),
    }),
  ),
});
const decodeLogRecords = Schema.decodeEffect(Schema.fromJsonString(LogRecords));

const readLog = Effect.fn("TiximWorkflows.readLog")(function* (input: TiximWorkflowLogInput) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    payload_json: string;
  }>`SELECT payload_json FROM tixim_workflow_links WHERE thread_id = ${input.threadId} AND daemon_id = ${input.daemonId} AND run_id = ${input.runId} AND excluded = 0`;
  if (rows.length === 0) return yield* failure();
  const run = decodeRun(rows[0]!.payload_json);
  const selected = yield* connection(run.connectionId);
  const runner = yield* ProcessRunner.ProcessRunner;
  const output = yield* runner.run({
    command: resolveTiximCommand(selected.environment),
    args: [
      ...(selected.context ? ["--context", selected.context] : []),
      "-o",
      "json",
      "workflows",
      "logs",
      input.runId,
      "--tail",
      String(LOG_TAIL_LINES),
    ],
    env: { ...selected.environment, TIX_WAIT_FOR_DAEMON: "0" },
    timeout: "45 seconds",
    maxOutputBytes: 4 * 1024 * 1024,
  });
  if (output.code !== 0) return yield* failure();
  const { records } = yield* decodeLogRecords(output.stdout);
  return {
    lines: records.map(({ cursor, text, step }) => ({
      key: `${cursor.seq}:${cursor.line}`,
      text,
      ...(step ? { step } : {}),
    })),
    finished: FINISHED_STATES.has(run.state),
  };
});

/** Follows a linked run's log tail, ending once a finished run has been read. */
export const logTail = (input: TiximWorkflowLogInput) =>
  Stream.fromEffectSchedule(safe(readLog(input)), Schedule.spaced("3 seconds")).pipe(
    Stream.takeUntil((tail) => tail.finished),
    Stream.changesWith(
      (a, b) => a.finished === b.finished && a.lines.at(-1)?.key === b.lines.at(-1)?.key,
    ),
  );

const encodeOverview = Schema.encodeSync(Schema.fromJsonString(TiximWorkflowOverview));

/** Every thread with linked runs, from saved state only, so it never reaches a daemon. */
export const overview = Effect.fn("TiximWorkflows.overview")(function* () {
  const sql = yield* SqlClient.SqlClient;
  // The wait sweep keeps `last_state` current for tracked runs; payloads refresh only on open.
  // A finished payload is final, while `last_state` goes stale for runs the sweep skips.
  const links = yield* sql<{
    thread_id: string;
    payload_json: string;
    last_state: string | null;
  }>`SELECT links.thread_id, links.payload_json, links.last_state FROM tixim_workflow_links links
    JOIN orchestration_v2_projection_threads thread ON thread.thread_id = links.thread_id
    WHERE links.excluded = 0 AND thread.deleted_at IS NULL AND thread.archived_at IS NULL
    ORDER BY links.thread_id`;
  const holds = yield* sql<{ thread_id: string; daemon_id: string; run_id: string }>`
    SELECT holds.thread_id, json_extract(target.value, '$.daemonId') AS daemon_id,
      json_extract(target.value, '$.runId') AS run_id
    FROM (SELECT thread_id, targets_json FROM tixim_workflow_snoozes
      UNION ALL SELECT thread_id, targets_json FROM tixim_workflow_waits WHERE wake_json IS NULL) holds,
      json_each(holds.targets_json) target`;
  const threads = new Map<string, { runs: TiximWorkflowRun[]; waitingOn: string[] }>();
  for (const row of links) {
    const run = decodeRun(row.payload_json);
    const entry = threads.get(row.thread_id) ?? { runs: [], waitingOn: [] };
    entry.runs.push(
      row.last_state === null || FINISHED_STATES.has(run.state)
        ? run
        : { ...run, state: row.last_state },
    );
    threads.set(row.thread_id, entry);
  }
  for (const hold of holds) {
    const entry = threads.get(hold.thread_id);
    const key = `${hold.daemon_id}/${hold.run_id}`;
    // A detached target wakes its hold on the next sweep, so it is not waited on.
    if (
      entry?.runs.some((run) => run.daemonId === hold.daemon_id && run.runId === hold.run_id) &&
      !entry.waitingOn.includes(key)
    )
      entry.waitingOn.push(key);
  }
  return {
    threads: Array.from(threads, ([threadId, entry]): TiximThreadWorkflows => ({
      threadId,
      ...entry,
    })),
  };
});

export const liveOverview = () =>
  Stream.fromEffectSchedule(safe(overview()), Schedule.spaced("5 seconds")).pipe(
    Stream.changesWith((a, b) => encodeOverview(a) === encodeOverview(b)),
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
  "ListWorkflows",
  "SubscribeWorkflowListChanges",
  "DescribeWorkflowDefinition",
]);
const CATALOG_READ_METHODS = new Set(["ListCatalogEntries", "GetCatalogEntry"]);
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
  "SubmitWorkflow",
]);
export function allowedFlowMethod(path: string, write: boolean) {
  const [service, method, extra] = path.split("/");
  if (extra !== undefined) return false;
  if (service === "tix.control.v1.CatalogControl")
    return !write && CATALOG_READ_METHODS.has(method ?? "");
  return (
    (service === "tix.control.v1.WorkflowsControl" ||
      service === "tix.control.v1.ApprovalsControl") &&
    (write ? WRITE_METHODS : READ_METHODS).has(method ?? "")
  );
}
export const rpc = (input: TiximFlowRpcInput, write: boolean) =>
  Stream.unwrap(
    safe(
      Effect.gen(function* () {
        if (!allowedFlowMethod(input.method, write)) return yield* failure();
        if (input.threadId !== undefined) {
          yield* thread(input.threadId);
          const sql = yield* SqlClient.SqlClient;
          const bound =
            yield* sql`SELECT 1 FROM tixim_workflow_links WHERE thread_id = ${input.threadId} AND daemon_id = ${input.daemonId} AND excluded = 0 LIMIT 1`;
          if (bound.length === 0) return yield* failure();
        }
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
    readonly readProgress: (
      connectionId: string,
      daemonId: string,
      runIds: ReadonlyArray<string>,
    ) => Effect.Effect<
      ReadonlyArray<{
        readonly runId: string;
        readonly state: string;
        readonly attention: boolean;
      }>,
      TiximCommandError
    >;
    readonly list: (
      threadId: string,
    ) => Effect.Effect<typeof TiximWorkflowListResult.Type, TiximCommandError>;
    readonly search: (
      input: TiximWorkflowSearchInput,
    ) => Effect.Effect<typeof TiximWorkflowListResult.Type, TiximCommandError>;
    readonly link: (
      input: TiximWorkflowLinkInput,
    ) => Effect.Effect<typeof TiximWorkflowListResult.Type, TiximCommandError>;
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
      readProgress: Effect.fn("WorkflowOperations.readProgress")(
        (connectionId: string, daemonId: string, runIds: ReadonlyArray<string>) =>
          safe(readProgress(connectionId, daemonId, runIds)).pipe(Effect.provide(context)),
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
