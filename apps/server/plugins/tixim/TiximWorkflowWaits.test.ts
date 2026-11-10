import { describe, expect, it } from "@effect/vitest";
import { type OrchestrationV2ServerCommand, TiximCommandError } from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import * as Orchestrator from "../../src/orchestration-v2/Orchestrator.ts";
import Migration from "./migrations/001_TiximWorkflowLinks.ts";
import RelationshipsMigration from "./migrations/002_TiximWorkflowRelationships.ts";
import InactivityMigration from "./migrations/003_TiximWorkflowWaitInactivity.ts";
import NotificationsMigration from "./migrations/004_TiximWorkflowNotifications.ts";
import SnoozesMigration from "./migrations/005_TiximWorkflowSnoozes.ts";
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
  yield* NotificationsMigration;
  yield* SnoozesMigration;
});
const addLink = (
  daemonId: string,
  options: { lastState?: string | null; relationship?: string } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO tixim_workflow_links (thread_id, daemon_id, run_id, connection_id, source, relationship, payload_json, last_state)
      VALUES ('thread', ${daemonId}, 'wf-same-run-1234', ${daemonId}, 'automatic', ${options.relationship ?? "owner"}, '{}',
        ${options.lastState === undefined ? "running" : options.lastState})`;
  });
const fixture = () => {
  const state = {
    runs: [task("one"), task("two")],
    messages: [] as OrchestrationV2ServerCommand[],
    failDispatch: false,
    shell: {
      activeRunId: null as string | null,
      lineage: { relationshipToParent: "root" },
      snoozedUntil: null as DateTime.Utc | null,
    },
  };
  const layer = Layer.mergeAll(
    NodeSqliteClient.layer({ filename: ":memory:" }),
    NodeServices.layer,
    NodeCrypto.layer,
    Layer.mock(TiximWorkflows.WorkflowOperations)({
      list: () => Effect.sync(() => ({ runs: state.runs, connections: [] })),
      observe: () => Effect.sync(() => state.runs),
      readProgress: (_connectionId, daemonId) =>
        Effect.sync(() => state.runs.filter((run) => run.daemonId === daemonId)),
    }),
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadShell: () => Effect.sync(() => state.shell as never),
      dispatch: (command) =>
        Effect.gen(function* () {
          state.messages.push(command);
          if (state.failDispatch) return yield* Effect.die("transient dispatch failure");
          if (command.type === "thread.snooze")
            state.shell.snoozedUntil = DateTime.makeUnsafe(command.snoozedUntil);
          if (command.type === "thread.unsnooze") state.shell.snoozedUntil = null;
          return { sequence: 1, storedEvents: [] };
        }),
    }),
  );
  return { state, layer };
};

describe("snoozing until workflows settle", () => {
  const types = (messages: ReadonlyArray<OrchestrationV2ServerCommand>) =>
    messages.map((message) => message.type);

  it.effect("starts one turn for tracked runs once all settle, and survives a restart", () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      yield* setup;
      const waits = yield* make;
      expect(yield* waits.snooze({ threadId: "thread", snoozing: true })).toEqual({
        status: "snoozed",
        runCount: 2,
      });
      state.runs = [task("one", { state: "completed" }), task("two")];
      yield* addLink("one");
      yield* addLink("two");
      yield* waits.sweep;
      yield* TestClock.adjust("1 minute");
      yield* waits.sweep;
      expect(types(state.messages)).toEqual(["thread.snooze"]);
      state.runs = [task("one", { state: "completed" }), task("two", { state: "completed" })];
      const restarted = yield* make;
      yield* restarted.sweep;
      yield* TestClock.adjust("1 minute");
      yield* restarted.sweep;
      expect(types(state.messages)).toEqual([
        "thread.snooze",
        "message.dispatch",
        "thread.unsnooze",
      ]);
      expect(state.shell.snoozedUntil).toBeNull();
    }).pipe(Effect.provide(layer));
  });

  it.effect("wakes on untracked runs without a turn, even beside a running tracked run", () => {
    const { state, layer } = fixture();
    const untracked = { relationship: "untracked" as const };
    return Effect.gen(function* () {
      yield* setup;
      const waits = yield* make;
      state.runs = [task("one", untracked), task("two")];
      yield* waits.snooze({ threadId: "thread", snoozing: true });
      state.runs = [task("one", { ...untracked, state: "failed" }), task("two")];
      yield* waits.sweep;
      expect(types(state.messages)).toEqual(["thread.snooze", "thread.unsnooze"]);

      state.messages = [];
      state.runs = [task("one", untracked)];
      yield* waits.snooze({ threadId: "thread", snoozing: true });
      state.runs = [task("one", { ...untracked, state: "completed" })];
      yield* waits.sweep;
      expect(types(state.messages)).toEqual(["thread.snooze", "thread.unsnooze"]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("leaves the turn to an agent's own wait on the same runs", () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      yield* setup;
      const waits = yield* make;
      yield* waits.wait({ threadId: "thread" });
      yield* waits.snooze({ threadId: "thread", snoozing: true });
      state.runs = state.runs.map((run) => ({ ...run, state: "completed" }));
      yield* waits.sweep;
      expect(types(state.messages)).toEqual([
        "thread.snooze",
        "thread.unsnooze",
        "message.dispatch",
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("does not touch an agent's wait, and refuses when nothing can wake it", () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* setup;
      const waits = yield* make;
      yield* waits.wait({ threadId: "thread" });
      yield* waits.snooze({ threadId: "thread", snoozing: true });
      expect(yield* sql`SELECT 1 FROM tixim_workflow_waits`).toHaveLength(1);
      yield* waits.snooze({ threadId: "thread", snoozing: false });
      expect(yield* sql`SELECT 1 FROM tixim_workflow_waits`).toHaveLength(1);
      expect(types(state.messages)).toEqual(["thread.snooze", "thread.unsnooze"]);
      state.runs = state.runs.map((run) => ({ ...run, state: "completed" }));
      expect(yield* waits.snooze({ threadId: "thread", snoozing: true })).toEqual({
        status: "settled",
        runCount: 0,
      });
      expect(state.shell.snoozedUntil).toBeNull();
    }).pipe(Effect.provide(layer));
  });

  it.effect("drops the wake when the thread was woken or re-snoozed another way", () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* setup;
      const waits = yield* make;
      yield* waits.snooze({ threadId: "thread", snoozing: true });
      const later = DateTime.makeUnsafe("2030-01-01T00:00:00.000Z");
      state.shell.snoozedUntil = later;
      state.runs = state.runs.map((run) => ({ ...run, state: "completed" }));
      yield* waits.sweep;
      expect(types(state.messages)).toEqual(["thread.snooze"]);
      expect(state.shell.snoozedUntil).toBe(later);
      expect(yield* sql`SELECT 1 FROM tixim_workflow_snoozes`).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("forgets the record when the snooze command fails", () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* setup;
      const waits = yield* make;
      state.failDispatch = true;
      yield* Effect.exit(waits.snooze({ threadId: "thread", snoozing: true }));
      expect(yield* sql`SELECT 1 FROM tixim_workflow_snoozes`).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  });
});

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
            readProgress: () => Effect.die("unused"),
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
            readProgress: () => Effect.die("unused"),
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
  it.effect("does not wake for untracked runs or attention raised before the wait", () => {
    const { state, layer } = fixture();
    state.runs = [task("one", { attention: true }), task("two", { relationship: "untracked" })];
    return Effect.gen(function* () {
      yield* setup;
      const waits = yield* make;
      expect(yield* waits.wait({ threadId: "thread" })).toMatchObject({ runCount: 1 });
      yield* waits.sweep;
      expect(state.messages).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  });
});

describe("workflow notification queue", () => {
  const complete = (state: ReturnType<typeof fixture>["state"], daemonId: string) => {
    state.runs = state.runs.map((run) =>
      run.daemonId === daemonId ? { ...run, state: "completed" } : run,
    );
  };

  it.effect("batches terminal transitions once after the grace period", () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      yield* setup;
      yield* addLink("one");
      yield* addLink("two");
      const waits = yield* make;
      complete(state, "one");
      yield* waits.sweep;
      yield* TestClock.adjust("20 seconds");
      complete(state, "two");
      yield* waits.sweep;
      expect(state.messages).toHaveLength(0);
      yield* TestClock.adjust("10 seconds");
      yield* waits.sweep;
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toMatchObject({
        dispatchMode: { type: "queue_after_active" },
        text: expect.stringMatching(/one\/wf-same-run-1234: completed\ntwo\/wf-same-run-1234/),
      });
      yield* TestClock.adjust("1 hour");
      yield* waits.sweep;
      expect(state.messages).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("stays silent for untracked runs and a migrated link's first observation", () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      yield* setup;
      yield* addLink("one", { lastState: null });
      yield* addLink("two", { relationship: "untracked" });
      const waits = yield* make;
      complete(state, "one");
      complete(state, "two");
      yield* waits.sweep;
      yield* TestClock.adjust("1 hour");
      yield* waits.sweep;
      expect(state.messages).toHaveLength(0);
      expect((yield* waits.poll("thread")).notifications).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("queues attention once per raise", () => {
    const { state, layer } = fixture();
    const setAttention = (attention: boolean) => {
      state.runs = [task("one", { attention })];
    };
    return Effect.gen(function* () {
      yield* setup;
      yield* addLink("one");
      const waits = yield* make;
      setAttention(true);
      yield* waits.sweep;
      yield* waits.sweep;
      expect((yield* waits.poll("thread")).notifications).toMatchObject([{ kind: "attention" }]);
      yield* waits.sweep;
      expect((yield* waits.poll("thread")).notifications).toHaveLength(0);
      setAttention(false);
      yield* waits.sweep;
      setAttention(true);
      yield* waits.sweep;
      expect((yield* waits.poll("thread")).notifications).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("keeps updates pollable during a turn and wakes only with what is left", () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      yield* setup;
      yield* addLink("one");
      yield* addLink("two");
      const waits = yield* make;
      state.shell.activeRunId = "run";
      complete(state, "one");
      yield* waits.sweep;
      yield* TestClock.adjust("1 minute");
      yield* waits.sweep;
      expect(state.messages).toHaveLength(0);
      expect((yield* waits.poll("thread")).notifications).toMatchObject([
        { daemonId: "one", kind: "terminal", state: "completed" },
      ]);
      complete(state, "two");
      yield* waits.sweep;
      yield* TestClock.adjust("1 minute");
      yield* waits.sweep;
      expect(state.messages).toHaveLength(0);
      state.shell.activeRunId = null;
      yield* waits.sweep;
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toMatchObject({ text: expect.not.stringContaining("one/") });
    }).pipe(Effect.provide(layer));
  });

  it.effect("never wakes a delegated child but leaves its updates pollable", () => {
    const { state, layer } = fixture();
    state.shell.lineage.relationshipToParent = "subagent";
    return Effect.gen(function* () {
      yield* setup;
      yield* addLink("one");
      const waits = yield* make;
      complete(state, "one");
      yield* waits.sweep;
      yield* TestClock.adjust("1 hour");
      yield* waits.sweep;
      expect(state.messages).toHaveLength(0);
      expect((yield* waits.poll("thread")).notifications).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("holds awaited runs for their wait, which reports them exactly once", () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      yield* setup;
      yield* addLink("one");
      yield* addLink("two");
      const waits = yield* make;
      yield* waits.wait({ threadId: "thread" });
      complete(state, "one");
      yield* waits.sweep;
      yield* TestClock.adjust("1 minute");
      yield* waits.sweep;
      expect(state.messages).toHaveLength(0);
      complete(state, "two");
      yield* waits.sweep;
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toMatchObject({
        text: expect.stringContaining("All awaited workflows have settled"),
      });
      yield* TestClock.adjust("1 hour");
      yield* waits.sweep;
      expect(state.messages).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("replays a claimed batch unchanged after dispatch failure and restart", () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      yield* setup;
      yield* addLink("one");
      yield* addLink("two");
      const waits = yield* make;
      complete(state, "one");
      yield* waits.sweep;
      yield* TestClock.adjust("30 seconds");
      state.failDispatch = true;
      yield* waits.sweep;
      state.failDispatch = false;
      complete(state, "two");
      expect((yield* waits.poll("thread")).notifications).toHaveLength(0);
      const restarted = yield* make;
      yield* restarted.sweep;
      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toEqual(state.messages[0]);
      yield* TestClock.adjust("30 seconds");
      yield* restarted.sweep;
      expect(state.messages).toHaveLength(3);
      expect(state.messages[2]).toMatchObject({ text: expect.stringContaining("two/") });
    }).pipe(Effect.provide(layer));
  });
});
