import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { WS_METHODS, ThreadId } from "@t3tools/contracts";
import { makeRpcHandlersFor } from "./rpc.ts";

it.effect("disabled RPCs return typed errors without acquiring database or process services", () =>
  Effect.gen(function* () {
    const handlers = yield* makeRpcHandlersFor(false);
    const threadId = ThreadId.make("thread");
    const error = yield* handlers[WS_METHODS.tiximWorkflowSearch]({
      threadId,
      connectionId: "remote",
      query: "wf-calm-river-a12b",
    }).pipe(Effect.flip);
    expect(error._tag).toBe("TiximCommandError");
    expect(error.message).toContain("disabled");
    const streamError = yield* handlers[WS_METHODS.tiximWorkflows]({ threadId }).pipe(
      Stream.runCollect,
      Effect.flip,
    );
    expect(streamError).toEqual(error);
    const mutationError = yield* handlers[WS_METHODS.tiximWorkflowLink]({
      threadId,
      connectionId: "remote",
      daemonId: "daemon",
      runId: "wf-calm-river-a12b",
      attach: true,
      relationship: "tracking",
    }).pipe(Effect.flip);
    expect(mutationError).toEqual(error);
    expect(yield* handlers[WS_METHODS.tiximProjectLinks]({}).pipe(Effect.flip)).toEqual(error);
    expect(
      yield* handlers[WS_METHODS.tiximProjectImport]({
        connectionId: "remote",
        tiximProjectId: "project",
      }).pipe(Effect.flip),
    ).toEqual(error);
  }),
);
