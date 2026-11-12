import { describe, expect, it } from "@effect/vitest";
import { type OrchestrationV2ServerCommand, TiximCommandError } from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import * as Orchestrator from "../../src/orchestration-v2/Orchestrator.ts";
import Migration from "./migrations/001_TiximWorkflowLinks.ts";
import RelationshipsMigration from "./migrations/002_TiximWorkflowRelationships.ts";
import InactivityMigration from "./migrations/003_TiximWorkflowWaitInactivity.ts";
import * as TiximWorkflows from "./TiximWorkflows.ts";
import { make } from "./TiximWorkflowWaits.ts";

const task = (
  daemonId: string,
  extra: Partial<TiximWorkflows.WorkflowObservation> = {},
): TiximWorkflows.WorkflowObservation => ({
  daemonId,
  connectionId: daemonId,
  runId: "wf-same-run-1234",
  name: "Task",
  source: "automatic",
  relationship: "owner",
  availability: "available",
  state: "running",
  parentRunId: "",
  submittedAt: 1,
  startedAt: 2,
  finishedAt: null,
  attention: false,
  progress: { executing: true, revision: "first-step" },
  ...extra,
});
const setup = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, archived_at TEXT, deleted_at TEXT)`;
  yield* sql`INSERT INTO orchestration_v2_projection_threads VALUES ('thread', NULL, NULL)`;
  yield* Migration;
  yield* RelationshipsMigration;
  yield* InactivityMigration;
});
const fixture = () => {
  const state = {
    runs: [task("one"), task("two")],
    messages: [] as OrchestrationV2ServerCommand[],
    failDispatch: false,
  };
  const layer = Layer.mergeAll(
    NodeSqliteClient.layer({ filename: ":memory:" }),
    NodeServices.layer,
    NodeCrypto.layer,
    Layer.mock(TiximWorkflows.WorkflowOperations)({
      list: () => Effect.sync(() => ({ runs: state.runs, connections: [] })),
      observe: () => Effect.sync(() => state.runs),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      dispatch: (command) =>
        Effect.gen(function* () {
          state.messages.push(command);
          if (state.failDispatch) return yield* Effect.die("transient dispatch failure");
          return { sequence: 1, storedEvents: [] };
        }),
    }),
  );
  return { state, layer };
};

describe("durable workflow waiting", () => {
  it.effect(
    "pauses during preparation and does not let a progressing sibling hide a stalled run",
    () => {
      const { state, layer } = fixture();
      return Effect.gen(function* () {
        yield* setup;
        const waits = yield* make;
        yield* waits.wait({ threadId: "thread", timeoutSeconds: 2 });
        yield* TestClock.adjust("1 second");
        state.runs = state.runs.map((run) => ({
          ...run,
          progress: { executing: false, revision: "building-next-step" },
        }));
        yield* waits.sweep;
        yield* TestClock.adjust("1 hour");
        const restarted = yield* make;
        yield* restarted.sweep;
        expect(state.messages).toHaveLength(0);
        state.runs = [task("one"), task("two")];
        yield* restarted.sweep;
        yield* TestClock.adjust("1 second");
        state.runs[0] = task("one", { progress: { executing: true, revision: "more-progress" } });
        yield* restarted.sweep;
        yield* TestClock.adjust("1 second");
        yield* restarted.sweep;
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0]).toMatchObject({
          text: expect.stringContaining("two/wf-same-run-1234: running (inactivity timeout)"),
        });
        expect(state.messages[0]).toMatchObject({
          text: expect.not.stringContaining("one/wf-same-run-1234: running (inactivity timeout)"),
        });
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect("cancellation wins while a daemon status read is in flight", () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      yield* setup;
      const reading = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let delayRead = false;
      const waits = yield* make.pipe(
        Effect.provideService(
          TiximWorkflows.WorkflowOperations,
          TiximWorkflows.WorkflowOperations.of({
            list: () => Effect.sync(() => ({ runs: state.runs, connections: [] })),
            observe: () =>
              Effect.gen(function* () {
                const runs = state.runs;
                if (delayRead) {
                  yield* Deferred.succeed(reading, undefined);
                  yield* Deferred.await(release);
                }
                return runs;
              }),
            search: () => Effect.die("unused"),
            link: () => Effect.die("unused"),
          }),
        ),
      );
      yield* waits.wait({ threadId: "thread" });
      state.runs = state.runs.map((run) => ({ ...run, state: "completed" }));
      delayRead = true;
      const sweep = yield* Effect.forkScoped(waits.sweep);
      yield* Deferred.await(reading);
      yield* waits.wait({ threadId: "thread", waiting: false });
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(sweep);
      expect(state.messages).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  });
  it.effect(
    "excludes hosting sessions and waits for every daemon-qualified target across restart and disconnect",
    () => {
      const { state, layer } = fixture();
      state.runs.push(task("host", { source: "agent_session" }));
      return Effect.gen(function* () {
        yield* setup;
        const first = yield* make;
        expect(yield* first.wait({ threadId: "thread" })).toMatchObject({
          status: "waiting",
          runCount: 2,
          deadline: null,
        });
        const restarted = yield* make;
        state.runs = [
          task("one", { state: "completed" }),
          task("two", { availability: "unavailable" }),
        ];
        yield* restarted.sweep;
        expect(state.messages).toHaveLength(0);
        state.runs = [task("one", { state: "completed" }), task("two", { state: "completed" })];
        yield* restarted.sweep;
        yield* restarted.sweep;
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0]).toMatchObject({
          type: "message.dispatch",
          dispatchMode: { type: "queue_after_active" },
          text: expect.stringContaining("All awaited workflows have settled"),
        });
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect(
    "starts only with execution, renews on progress, and preserves the timer across restart and disconnect",
    () => {
      const { state, layer } = fixture();
      state.runs = [
        task("one", {
          relationship: "waiting_on",
          state: "pending",
          progress: { executing: false, revision: "preparing" },
        }),
        task("two", { relationship: "tracking" }),
      ];
      return Effect.gen(function* () {
        yield* setup;
        const waits = yield* make;
        expect(
          yield* waits.wait({
            threadId: "thread",
            relationships: ["waiting_on"],
            timeoutSeconds: 2,
          }),
        ).toMatchObject({ runCount: 1, deadline: null });
        yield* TestClock.adjust("1 hour");
        yield* waits.sweep;
        expect(state.messages).toHaveLength(0);
        state.runs[0] = task("one", { relationship: "waiting_on" });
        yield* waits.sweep;
        yield* TestClock.adjust("1 second");
        state.runs[0] = task("one", {
          relationship: "waiting_on",
          progress: { executing: true, revision: "second-step" },
        });
        yield* waits.sweep;
        const restarted = yield* make;
        yield* TestClock.adjust("1 second");
        yield* restarted.sweep;
        expect(state.messages).toHaveLength(0);
        state.runs[0] = task("one", { relationship: "waiting_on", availability: "unavailable" });
        yield* TestClock.adjust("1 second");
        yield* restarted.sweep;
        expect(state.messages[0]).toMatchObject({
          text: expect.stringContaining("Workflow wait timed out"),
        });
        expect(state.messages[0]).toMatchObject({
          text: expect.stringContaining("unavailable (still pending)"),
        });
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect.each(["failed", "approval", "detached"] as const)(
    "wakes for %s while other tasks are still running",
    (cause) => {
      const { state, layer } = fixture();
      return Effect.gen(function* () {
        yield* setup;
        const waits = yield* make;
        yield* waits.wait({ threadId: "thread" });
        state.runs =
          cause === "detached"
            ? [task("two")]
            : [
                task("one", cause === "failed" ? { state: "failed" } : { attention: true }),
                task("two"),
              ];
        yield* waits.sweep;
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0]).toMatchObject({
          text: expect.stringContaining(cause === "detached" ? "detached" : "needs attention"),
        });
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect(
    "cancels and replaces waits without cancelling workflows, and keeps archived threads asleep",
    () => {
      const { state, layer } = fixture();
      return Effect.gen(function* () {
        yield* setup;
        const waits = yield* make;
        yield* waits.wait({ threadId: "thread" });
        expect(yield* waits.wait({ threadId: "thread", waiting: false })).toMatchObject({
          status: "cancelled",
        });
        yield* waits.sweep;
        expect(state.messages).toHaveLength(0);
        yield* waits.wait({ threadId: "thread", timeoutSeconds: 1 });
        yield* waits.wait({ threadId: "thread" });
        yield* TestClock.adjust("2 seconds");
        yield* waits.sweep;
        expect(state.messages).toHaveLength(0);
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE orchestration_v2_projection_threads SET archived_at = 'now'`;
        state.runs = state.runs.map((r) => ({ ...r, state: "completed" }));
        yield* waits.sweep;
        expect(state.messages).toHaveLength(0);
        yield* sql`UPDATE orchestration_v2_projection_threads SET archived_at = NULL`;
        yield* waits.sweep;
        expect(state.messages).toHaveLength(1);
        expect(yield* waits.wait({ threadId: "thread" })).toMatchObject({ status: "settled" });
        state.runs = [task("one")];
        yield* waits.wait({ threadId: "thread" });
        yield* sql`UPDATE orchestration_v2_projection_threads SET deleted_at = 'now'`;
        expect(yield* sql`SELECT * FROM tixim_workflow_waits`).toHaveLength(0);
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect("retries the exact persisted wake command after dispatch failure and restart", () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      yield* setup;
      const waits = yield* make;
      yield* waits.wait({ threadId: "thread" });
      state.runs = state.runs.map((r) => ({ ...r, state: "completed" }));
      state.failDispatch = true;
      yield* waits.sweep;
      state.failDispatch = false;
      state.runs = [];
      const restarted = yield* make;
      yield* restarted.sweep;
      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toEqual(state.messages[0]);
      yield* restarted.sweep;
      expect(state.messages).toHaveLength(2);
    }).pipe(Effect.provide(layer));
  });
  it.effect("does not replace a registered wait when run lookup fails", () => {
    const { layer } = fixture();
    return Effect.gen(function* () {
      yield* setup;
      const waits = yield* make;
      yield* waits.wait({ threadId: "thread" });
      const failed = yield* make.pipe(
        Effect.provideService(
          TiximWorkflows.WorkflowOperations,
          TiximWorkflows.WorkflowOperations.of({
            list: () => Effect.fail(new TiximCommandError({ message: "offline" })),
            observe: () => Effect.die("unused"),
            search: () => Effect.die("unused"),
            link: () => Effect.die("unused"),
          }),
        ),
      );
      expect((yield* Effect.result(failed.wait({ threadId: "thread" })))._tag).toBe("Failure");
      const sql = yield* SqlClient.SqlClient;
      expect(yield* sql`SELECT * FROM tixim_workflow_waits`).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });
});
