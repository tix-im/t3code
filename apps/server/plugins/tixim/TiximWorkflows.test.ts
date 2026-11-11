import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { tiximHostEnvironment } from "@t3tools/plugin-tixim-provider/server";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Settings from "../../src/serverSettings.ts";
import * as ProcessRunner from "../../src/processRunner.ts";
import Migration from "./migrations/001_TiximWorkflowLinks.ts";
import RelationshipsMigration from "./migrations/002_TiximWorkflowRelationships.ts";
import InactivityMigration from "./migrations/003_TiximWorkflowWaitInactivity.ts";
import NotificationsMigration from "./migrations/004_TiximWorkflowNotifications.ts";
import SnoozesMigration from "./migrations/005_TiximWorkflowSnoozes.ts";
import * as TiximWorkflows from "./TiximWorkflows.ts";
import {
  list,
  listConnections,
  live,
  link,
  search,
  rpc,
  allowedFlowMethod,
  mentionedWorkflowIds,
} from "./TiximWorkflows.ts";

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const run = (runId: string, extra: Record<string, unknown> = {}) => ({
  runId,
  name: runId,
  state: "running",
  parentRunId: "",
  submittedAt: 1,
  startedAt: 2,
  finishedAt: null,
  attention: false,
  automatic: true,
  hosting: false,
  ...extra,
});
const setup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT PRIMARY KEY, deleted_at TEXT)`;
  yield* sql`INSERT INTO orchestration_v2_projection_threads VALUES ('thread-a', NULL), ('thread-b', NULL)`;
  yield* sql`CREATE TABLE orchestration_v2_projection_provider_threads(thread_id TEXT, payload_json TEXT)`;
  yield* Migration;
  yield* RelationshipsMigration;
  yield* NotificationsMigration;
  yield* SnoozesMigration;
  yield* sql`CREATE TABLE orchestration_v2_projection_messages(thread_id TEXT, role TEXT, payload_json TEXT)`;
});
const base = Layer.mergeAll(
  NodeSqliteClient.layer({ filename: ":memory:" }),
  Settings.layerTest({
    providerInstances: {
      [ProviderInstanceId.make("tix-one")]: {
        driver: ProviderDriverKind.make("tixim"),
        displayName: "Tixim One",
        config: { context: "one" },
      },
      [ProviderInstanceId.make("tix-two")]: {
        driver: ProviderDriverKind.make("tixim"),
        config: { context: "two" },
      },
    },
  }),
);
const runner = (read: (input: ProcessRunner.ProcessRunInput) => string) =>
  Layer.succeed(ProcessRunner.ProcessRunner, {
    run: Effect.fn((input: ProcessRunner.ProcessRunInput) =>
      Effect.succeed({
        stdout: read(input),
        stderr: "",
        code: 0 as never,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      }),
    ),
  });

describe("thread workflows", () => {
  it.effect("lists configured connections before requesting their workflow history", () => {
    const requests: ProcessRunner.ProcessRunInput[] = [];
    return Effect.gen(function* () {
      yield* setup;
      const updates = yield* live("thread-a").pipe(Stream.take(1), Stream.runCollect);
      expect(updates[0]?.connections).toEqual([
        { id: "tix-one", label: "Tixim One", daemonId: "", available: false, loading: true },
        { id: "tix-two", label: "tix-two", daemonId: "", available: false, loading: true },
      ]);
      expect(requests).toHaveLength(0);
      const unavailable = yield* list("thread-a").pipe(
        Effect.provide(runner(() => "unreadable daemon response")),
      );
      expect(unavailable.connections[0]).toMatchObject({
        id: "tix-one",
        label: "Tixim One",
        available: false,
        loading: false,
        error: "The workflow connection is unavailable or access was denied.",
      });
      const timedOut = yield* list("thread-a").pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, {
          run: () =>
            Effect.fail(
              new ProcessRunner.ProcessTimeoutError({
                command: "/private/command",
                argumentCount: 0,
                timeoutMs: 120_000,
              }),
            ),
        }),
      );
      expect(timedOut.connections[0]?.error).toBe(
        "Loading workflows timed out. Reload the connection to try again.",
      );
    }).pipe(
      Effect.provide(
        Layer.merge(
          base,
          runner((input) => {
            requests.push(input);
            return encode({ daemonId: "one", runs: [] });
          }),
        ),
      ),
    );
  });
  it.effect("migrates saved relationships without changing links or detach exclusions", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT PRIMARY KEY, deleted_at TEXT)`;
      yield* Migration;
      yield* sql`INSERT INTO tixim_workflow_links (thread_id, daemon_id, run_id, connection_id, source, excluded, payload_json)
      VALUES ('thread', 'daemon', 'auto', 'connection', 'automatic', 0, '{"runId":"auto"}'),
      ('thread', 'daemon', 'host', 'connection', 'agent_session', 0, '{"runId":"host"}'),
      ('thread', 'daemon', 'manual', 'connection', 'manual', 1, '{"runId":"manual"}')`;
      yield* RelationshipsMigration;
      expect(
        yield* sql`SELECT run_id, relationship, excluded, json_extract(payload_json, '$.relationship') AS cached FROM tixim_workflow_links ORDER BY run_id`,
      ).toEqual([
        { run_id: "auto", relationship: "owner", excluded: 0, cached: "owner" },
        { run_id: "host", relationship: "owner", excluded: 0, cached: "owner" },
        { run_id: "manual", relationship: "tracking", excluded: 1, cached: "tracking" },
      ]);
      yield* sql`INSERT INTO tixim_workflow_waits (thread_id, wait_id, targets_json, deadline_ms) VALUES ('thread', 'saved-wait', '[]', 2000)`;
      yield* InactivityMigration;
      expect(
        yield* sql`SELECT wait_id, deadline_ms, timeout_ms, progress_json FROM tixim_workflow_waits`,
      ).toEqual([
        { wait_id: "saved-wait", deadline_ms: 2000, timeout_ms: null, progress_json: "[]" },
      ]);
      yield* NotificationsMigration;
      expect(
        yield* sql`SELECT run_id, relationship, json_extract(payload_json, '$.relationship') AS cached, last_state FROM tixim_workflow_links ORDER BY run_id`,
      ).toEqual([
        { run_id: "auto", relationship: "owner", cached: "owner", last_state: null },
        { run_id: "host", relationship: "owner", cached: "owner", last_state: null },
        { run_id: "manual", relationship: "untracked", cached: "untracked", last_state: null },
      ]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
  it.effect("baselines newly tracked runs, drops updates on untrack, and re-arms a restart", () => {
    let state = "running";
    return Effect.gen(function* () {
      yield* setup;
      const sql = yield* SqlClient.SqlClient;
      const binding = {
        threadId: "thread-a",
        connectionId: "tix-one",
        daemonId: "daemon-one",
        runId: "task",
        attach: true,
      };
      const lastState = sql<{
        last_state: string | null;
      }>`SELECT last_state FROM tixim_workflow_links`;
      yield* list("thread-a");
      yield* sql`INSERT INTO tixim_workflow_notifications (thread_id, daemon_id, run_id, kind, state, created_at_ms)
        VALUES ('thread-a', 'daemon-one', 'task', 'terminal', 'completed', 1)`;
      yield* link({ ...binding, relationship: "untracked" });
      expect(yield* sql`SELECT * FROM tixim_workflow_notifications`).toHaveLength(0);
      state = "completed";
      yield* link({ ...binding, relationship: "tracking" });
      expect(yield* lastState).toEqual([{ last_state: "completed" }]);
      state = "running";
      yield* list("thread-a");
      expect(yield* lastState).toEqual([{ last_state: "running" }]);
    }).pipe(
      Effect.provide(
        Layer.merge(
          base,
          runner(() => encode({ daemonId: "daemon-one", runs: [run("task", { state })] })),
        ),
      ),
    );
  });
  it.effect(
    "reads progress only for linked targets and refuses another daemon's observations",
    () => {
      let replaced = false;
      let snapshots = 0;
      const requests: string[] = [];
      const dependencies = Layer.merge(
        base,
        runner((input) => {
          const daemonId = input.args.includes("one") ? "daemon-one" : "daemon-two";
          if (input.args.includes("progress")) {
            requests.push(input.args.at(-1)!);
            expect(JSON.parse(input.stdin ?? "{}")).toEqual({ runIds: ["task"] });
            return encode({
              daemonId: replaced ? "replacement-daemon" : daemonId,
              runs: [
                {
                  runId: "task",
                  state: "running",
                  attention: false,
                  progress: { executing: true, revision: "step-2" },
                },
              ],
            });
          }
          snapshots++;
          return encode({ daemonId, runs: [run("task")] });
        }),
      );
      return Effect.gen(function* () {
        yield* setup;
        const service = yield* TiximWorkflows.WorkflowOperations;
        const targets = (yield* service.list("thread-a")).runs;
        snapshots = 0;
        const observed = yield* service.observe("thread-a", targets);
        expect(observed.every((run) => run.progress?.revision === "step-2")).toBe(true);
        expect(requests).toEqual(["daemon-one", "daemon-two"]);
        expect(snapshots).toBe(0);
        replaced = true;
        expect(
          (yield* service.observe("thread-a", targets)).every(
            (run) => run.availability === "unavailable" && run.progress === undefined,
          ),
        ).toBe(true);
        replaced = false;
        yield* service.link({
          threadId: "thread-a",
          connectionId: "tix-one",
          daemonId: "daemon-one",
          runId: "task",
          attach: false,
        });
        requests.length = 0;
        expect((yield* service.observe("thread-a", targets)).map((run) => run.daemonId)).toEqual([
          "daemon-two",
        ]);
        expect(requests).toEqual(["daemon-two"]);
      }).pipe(Effect.provide(TiximWorkflows.layer.pipe(Layer.provideMerge(dependencies))));
    },
  );
  it("recognizes complete execution mentions without interpreting prose as ownership", () => {
    expect([
      ...mentionedWorkflowIds(
        "Run `wf-calm-river-a12b`, then https://flow/runs/wf-fresh-bay-321a. Duplicate wf-calm-river-a12b. Not wf-… or prefix-wf-bad-match or wf-bad_name.",
      ),
    ]).toEqual(["wf-calm-river-a12b", "wf-fresh-bay-321a"]);
  });
  it.effect("suggests only accessible exact mentions from this chat without attaching them", () => {
    const searches: unknown[] = [];
    return Effect.gen(function* () {
      yield* setup;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO orchestration_v2_projection_messages VALUES
      ('thread-a', 'assistant', ${encode({ text: "Submitted wf-calm-river-a12b. Also wf-private-bay-1111." })}),
      ('thread-a', 'user', ${encode({ text: "Watch wf-calm-river-a12b" })}),
      ('thread-b', 'assistant', ${encode({ text: "wf-other-chat-1234" })})`;
      const mentioned = {
        threadId: "thread-a",
        connectionId: "tix-one",
        query: "",
        mentionedOnly: true,
      };
      const result = yield* search(mentioned);
      expect(searches).toEqual([{ references: ["wf-calm-river-a12b", "wf-private-bay-1111"] }]);
      expect(result.runs.map((r) => r.runId)).toEqual(["calm-uuid"]);
      expect(result.runs[0]?.relationship).toBe("tracking");
      expect((yield* list("thread-a")).runs).toHaveLength(0);
      yield* sql`DELETE FROM orchestration_v2_projection_messages`;
      searches.length = 0;
      expect((yield* search(mentioned)).runs).toEqual([]);
      expect(searches).toEqual([]);
    }).pipe(
      Effect.provide(
        Layer.merge(
          base,
          runner((input) => {
            if (input.args.at(-1) === "search") searches.push(JSON.parse(input.stdin ?? "{}"));
            return encode({
              daemonId: "one",
              runs: [
                run("calm-uuid", { hid: "wf-calm-river-a12b", automatic: false }),
                run("other-uuid", { hid: "wf-other-chat-1234", automatic: false }),
              ],
            });
          }),
        ),
      ),
    );
  });
  it.effect(
    "answers searches from a cached recent page and asks the daemon only when needed",
    () => {
      const searches: unknown[] = [];
      const layer = Layer.merge(
        base,
        runner((input) => {
          if (input.args.at(-1) === "search") searches.push(JSON.parse(input.stdin ?? "{}"));
          return encode({
            daemonId: "one",
            runs: [
              run("finished", {
                hid: "wf-tidy-cove-0001",
                definitionName: "release-train",
                state: "completed",
                submittedAt: 30,
              }),
              run("older", { hid: "wf-calm-river-a12b", submittedAt: 10 }),
              run("newer", { hid: "wf-fresh-bay-321a", submittedAt: 20 }),
            ],
          });
        }),
      );
      return Effect.gen(function* () {
        yield* setup;
        const cachedSearch = yield* TiximWorkflows.makeCachedSearch;
        const ids = (query: string, includeHistory?: boolean) =>
          cachedSearch({
            threadId: "thread-a",
            connectionId: "tix-one",
            query,
            ...(includeHistory === undefined ? {} : { includeHistory }),
          }).pipe(Effect.map((result) => result.runs.map((r) => r.runId)));
        expect(yield* ids("")).toEqual(["newer", "older", "finished"]);
        expect(yield* ids("RELEASE")).toEqual(["finished"]);
        expect(yield* ids("wf-calm")).toEqual(["older"]);
        expect(searches).toEqual([{ limit: 200 }]);
        searches.length = 0;
        expect(yield* ids("wf-fresh-bay-321a")).toEqual(["newer"]);
        expect(searches).toEqual([{ references: ["wf-fresh-bay-321a"] }]);
        searches.length = 0;
        // The daemon decides what matches, including fields a run row does not carry.
        expect(yield* ids("Zebra", true)).toEqual(["newer", "older", "finished"]);
        expect(searches).toEqual([{ query: "Zebra", limit: 100 }]);
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect("reads saved runs until they settle and keeps settled runs available", () => {
    const requested: string[][] = [];
    let reachable = true;
    return Effect.gen(function* () {
      yield* setup;
      const binding = {
        threadId: "thread-a",
        connectionId: "tix-one",
        daemonId: "daemon-one",
        attach: true,
      };
      yield* link({ ...binding, runId: "settled" });
      yield* link({ ...binding, runId: "saved-before-counts" });
      requested.length = 0;
      const online = yield* list("thread-a");
      expect(requested).toEqual([["saved-before-counts"]]);
      expect(new Map(online.runs.map((r) => [r.runId, r.availability]))).toEqual(
        new Map([
          ["settled", "available"],
          ["saved-before-counts", "available"],
        ]),
      );
      reachable = false;
      expect((yield* list("thread-a")).runs.every((r) => r.availability === "unavailable")).toBe(
        true,
      );
    }).pipe(
      Effect.provide(
        Layer.merge(
          base,
          runner((input) => {
            if (!reachable || !input.args.includes("one")) return "unreadable daemon response";
            const { runIds } = JSON.parse(input.stdin ?? "{}") as { runIds: string[] };
            requested.push(runIds);
            return encode({
              daemonId: "daemon-one",
              runs: runIds.map((id) =>
                run(id, {
                  automatic: false,
                  state: "completed",
                  ...(id === "settled"
                    ? {
                        steps: {
                          running: 0,
                          failed: 0,
                          waiting: 0,
                          queued: 0,
                          succeeded: 3,
                          skipped: 0,
                        },
                      }
                    : {}),
                }),
              ),
            });
          }),
        ),
      ),
    );
  });
  it.effect(
    "preserves independent relationships across reconciliation, duplicate attachment and shared links",
    () =>
      Effect.gen(function* () {
        yield* setup;
        expect((yield* list("thread-a")).runs.every((r) => r.relationship === "owner")).toBe(true);
        const binding = {
          threadId: "thread-a",
          connectionId: "tix-one",
          daemonId: "daemon-one",
          runId: "task",
          attach: true,
        };
        yield* link({ ...binding, relationship: "waiting_on" });
        yield* link(binding);
        yield* link({ ...binding, threadId: "thread-b", relationship: "tracking" });
        const first = (yield* list("thread-a")).runs;
        expect(first.find((r) => r.daemonId === "daemon-one")?.relationship).toBe("waiting_on");
        expect(first.find((r) => r.daemonId === "daemon-two")?.relationship).toBe("owner");
        expect(
          (yield* list("thread-b")).runs.find((r) => r.daemonId === "daemon-one")?.relationship,
        ).toBe("tracking");
        expect(first.every((r) => r.source === "automatic")).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.merge(
            base,
            runner((input) =>
              encode({
                daemonId: input.args.includes("one") ? "daemon-one" : "daemon-two",
                runs: [run("task")],
              }),
            ),
          ),
        ),
      ),
  );
  it.effect("does not reintroduce host credentials in an inherited child environment", () => {
    const original = process.env.TIX_AUTH_TOKEN;
    const restore = () => {
      if (original === undefined) delete process.env.TIX_AUTH_TOKEN;
      else process.env.TIX_AUTH_TOKEN = original;
    };
    process.env.TIX_AUTH_TOKEN = "synthetic-host-token";
    return Effect.gen(function* () {
      const processRunner = yield* ProcessRunner.ProcessRunner;
      const result = yield* processRunner.run({
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write(process.env.TIX_AUTH_TOKEN === undefined ? 'clean' : 'leaked')",
        ],
        env: tiximHostEnvironment(process.env, { context: "other-daemon" }),
        timeout: "5 seconds",
      });
      expect(result.stdout).toBe("clean");
    }).pipe(
      Effect.ensuring(Effect.sync(restore)),
      Effect.provide(ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer))),
    );
  });
  it.effect("uses the packaged CLI independently of the login PATH", () =>
    Effect.gen(function* () {
      yield* setup;
      expect((yield* list("thread-a")).connections.every((c) => c.available)).toBe(true);
    }).pipe(
      Effect.provide(
        Layer.merge(
          base,
          runner((input) => {
            expect(input.command).toBe("/pinned/tix");
            return encode({ daemonId: "daemon", runs: [] });
          }),
        ),
      ),
      Effect.provideService(HostProcess.Environment, {
        PATH: "/old/login/path",
        T3_TIXIM_CLI_PATH: "/pinned/tix",
      }),
    ),
  );
  it.effect(
    "reconciles hosting and nested runs, preserves exclusions and shares manual links",
    () => {
      let connected = true;
      const layer = Layer.merge(
        base,
        runner((input) =>
          encode({
            daemonId: input.args.includes("one") ? "daemon-one" : "daemon-two",
            runs: connected
              ? [run("same-id", { hosting: true }), run("child", { parentRunId: "same-id" })]
              : [],
          }),
        ),
      );
      return Effect.gen(function* () {
        yield* setup;
        expect(yield* list("unsaved-thread")).toEqual({ runs: [], connections: [] });
        expect(
          (yield* Effect.result(
            link({
              threadId: "unsaved-thread",
              connectionId: "tix-one",
              daemonId: "daemon-one",
              runId: "same-id",
              attach: true,
            }),
          ))._tag,
        ).toBe("Failure");
        const first = yield* list("thread-a");
        expect(first.runs).toHaveLength(4);
        expect(first.runs.filter((r) => r.source === "agent_session")).toHaveLength(2);
        const binding = {
          threadId: "thread-a",
          connectionId: "tix-one",
          daemonId: "daemon-one",
          runId: "same-id",
        };
        yield* link({ ...binding, attach: false });
        expect(
          (yield* list("thread-a")).runs.some(
            (r) => r.daemonId === "daemon-one" && r.runId === "same-id",
          ),
        ).toBe(false);
        yield* link({ ...binding, threadId: "thread-b", attach: true });
        expect((yield* list("thread-a")).runs).toHaveLength(3);
        yield* link({ ...binding, attach: true });
        yield* link({ ...binding, attach: true });
        expect((yield* list("thread-a")).runs).toHaveLength(4);
        const inputHosts: unknown[] = [];
        // Saved hosting links are daemon-qualified so reconnect reconciliation
        // can discover later descendants even after the live ACP registry expires.
        yield* list("thread-a").pipe(
          Effect.provide(
            runner((input) => {
              inputHosts.push(...JSON.parse(input.stdin ?? "{}").knownHosts);
              return encode({ daemonId: "daemon-one", runs: [] });
            }),
          ),
        );
        expect(inputHosts).toContainEqual({ daemonId: "daemon-one", runId: "same-id" });
        expect(inputHosts).toContainEqual({ daemonId: "daemon-two", runId: "same-id" });
        connected = false;
        const disconnected = yield* list("thread-a");
        expect(disconnected.runs.every((r) => r.availability === "unavailable")).toBe(true);
        connected = true;
        expect(
          (yield* search({
            threadId: "thread-a",
            connectionId: "tix-one",
            query: "child",
          })).runs.map((r) => r.runId),
        ).toEqual(["child"]);
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE orchestration_v2_projection_threads SET deleted_at = 'now' WHERE thread_id = 'thread-a'`;
        expect(
          yield* sql`SELECT 1 FROM tixim_workflow_links WHERE thread_id = 'thread-a'`,
        ).toHaveLength(0);
        expect(
          yield* sql`SELECT 1 FROM tixim_workflow_links WHERE thread_id = 'thread-b'`,
        ).toHaveLength(4);
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect("rejects attachment after a connection switches daemon identity", () =>
    Effect.gen(function* () {
      yield* setup;
      const result = yield* Effect.result(
        link({
          threadId: "thread-a",
          connectionId: "tix-one",
          daemonId: "old-daemon",
          runId: "run",
          attach: true,
        }),
      );
      expect(result._tag).toBe("Failure");
    }).pipe(
      Effect.provide(
        Layer.merge(
          base,
          runner(() => encode({ daemonId: "new-daemon", runs: [run("run")] })),
        ),
      ),
    ),
  );
  it.effect("forwards split subprocess frames and closes completed requests", () =>
    Effect.gen(function* () {
      yield* setup;
      const overview = yield* list("thread-a");
      expect(overview.runs).toHaveLength(1);
      expect(overview.runs[0]?.source).toBe("agent_session");
      const frames = yield* rpc(
        {
          threadId: "thread-a",
          connectionId: "tix-two",
          daemonId: "daemon-one",
          method: "tix.control.v1.WorkflowsControl/GetWorkflowDetail",
          body: "",
        },
        false,
      ).pipe(Stream.runCollect);
      expect(frames).toEqual(["YQ==", "Yg=="]);
    }).pipe(
      Effect.provide(
        Layer.merge(
          base,
          runner((input) => {
            if (input.args.includes("rpc")) {
              input.onStdoutChunk?.(new TextEncoder().encode("YQ==\nYg"));
              input.onStdoutChunk?.(new TextEncoder().encode("==\n"));
              return "";
            }
            return encode({
              daemonId: "daemon-one",
              runs: [run("run", { hosting: input.args.includes("one") })],
            });
          }),
        ),
      ),
    ),
  );
  it("separates read and write methods and rejects unrelated services", () => {
    expect(allowedFlowMethod("tix.control.v1.WorkflowsControl/GetWorkflowDetail", false)).toBe(
      true,
    );
    expect(allowedFlowMethod("tix.control.v1.WorkflowsControl/CancelWorkflow", false)).toBe(false);
    expect(allowedFlowMethod("tix.control.v1.WorkflowsControl/CancelWorkflow", true)).toBe(true);
    expect(allowedFlowMethod("tix.control.v1.SecretsControl/GetWorkflowDetail", false)).toBe(false);
    expect(allowedFlowMethod("tix.control.v1.WorkflowsControl/SubmitWorkflow", false)).toBe(false);
    expect(allowedFlowMethod("tix.control.v1.WorkflowsControl/SubmitWorkflow", true)).toBe(true);
    expect(allowedFlowMethod("tix.control.v1.CatalogControl/ListCatalogEntries", false)).toBe(true);
    expect(allowedFlowMethod("tix.control.v1.CatalogControl/ListCatalogEntries", true)).toBe(false);
    expect(allowedFlowMethod("tix.control.v1.CatalogControl/SearchCatalog", false)).toBe(false);
  });
  it.effect("reports each connection's daemon and keeps an unreachable one listed", () =>
    Effect.gen(function* () {
      const { connections } = yield* listConnections();
      expect(connections).toEqual([
        { id: "tix-one", label: "Tixim One", daemonId: "daemon-one", available: true },
        {
          id: "tix-two",
          label: "tix-two",
          daemonId: "",
          available: false,
          error: "The workflow connection is unavailable or access was denied.",
        },
      ]);
    }).pipe(
      Effect.provide(
        Layer.merge(
          base,
          runner((input) =>
            input.args.includes("one") ? encode({ daemonId: "daemon-one", runs: [] }) : "not json",
          ),
        ),
      ),
    ),
  );
  it.effect("forwards a daemon-wide request without a thread but keeps thread requests bound", () =>
    Effect.gen(function* () {
      yield* setup;
      const request = {
        connectionId: "tix-two",
        daemonId: "unlinked-daemon",
        method: "tix.control.v1.WorkflowsControl/ListWorkflows",
        body: "",
      };
      expect(yield* rpc(request, false).pipe(Stream.runCollect)).toEqual(["YQ=="]);
      const refused = yield* rpc({ ...request, threadId: "thread-a" }, false).pipe(
        Stream.runCollect,
        Effect.flip,
      );
      expect(refused._tag).toBe("TiximCommandError");
    }).pipe(
      Effect.provide(
        Layer.merge(
          base,
          runner((input) => {
            input.onStdoutChunk?.(new TextEncoder().encode("YQ==\n"));
            return "";
          }),
        ),
      ),
    ),
  );
});
