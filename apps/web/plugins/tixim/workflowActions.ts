import { type EnvironmentId, type ThreadId, WS_METHODS } from "@t3tools/contracts";
import { runStreamGuarded } from "@t3tools/client-runtime/rpc";
import {
  createPermissionAwareRuntimeCommand,
  runStreamInEnvironment,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { connectionAtomRuntime } from "../../src/plugins/host";
import { isFinishedWorkflowState } from "./workflowPresentation";

export type WorkflowRunAction = "suspend" | "resume" | "freeze" | "thaw" | "restart" | "cancel";

export const WORKFLOW_RUN_ACTION_LABELS: Record<WorkflowRunAction, string> = {
  suspend: "Suspend",
  resume: "Resume",
  freeze: "Freeze",
  thaw: "Thaw",
  restart: "Restart",
  cancel: "Cancel run",
};

const METHODS: Record<WorkflowRunAction, string> = {
  suspend: "SuspendWorkflowRun",
  resume: "ResumeWorkflowRun",
  freeze: "FreezeWorkflowRun",
  thaw: "ThawWorkflowRun",
  restart: "RestartWorkflowRun",
  cancel: "CancelWorkflow",
};

/** Mirrors Tix Flow's `allowedRunActions`, so both offer the same actions for a state. */
export function allowedWorkflowRunActions(state: string): WorkflowRunAction[] {
  if (isFinishedWorkflowState(state)) return ["restart"];
  const actions: WorkflowRunAction[] = [];
  if (state === "running" || state === "awaiting_input") actions.push("suspend", "freeze");
  if (state === "frozen") actions.push("thaw");
  if (state === "suspended" || state === "paused") actions.push("resume");
  if (state !== "cancelling") actions.push("cancel");
  return actions;
}

// Every action request carries the run ID as field 1 and leaves the rest at defaults.
export function encodeWorkflowIdRequest(workflowId: string): string {
  const id = new TextEncoder().encode(workflowId);
  const length: number[] = [];
  for (let rest = id.length; ; rest >>>= 7) {
    if (rest < 0x80) {
      length.push(rest);
      break;
    }
    length.push((rest & 0x7f) | 0x80);
  }
  return btoa(String.fromCharCode(0x0a, ...length, ...id));
}

/** Reads `grpc-status` from the gRPC-web trailer frame among the bridge's base64 chunks. */
export function grpcWebStatus(chunks: ReadonlyArray<string>): number | null {
  const bytes = Uint8Array.from(chunks.map((chunk) => atob(chunk)).join(""), (char) =>
    char.charCodeAt(0),
  );
  const view = new DataView(bytes.buffer);
  for (let offset = 0; offset + 5 <= bytes.length;) {
    const length = view.getUint32(offset + 1);
    if ((bytes[offset]! & 0x80) !== 0) {
      const trailer = new TextDecoder().decode(bytes.subarray(offset + 5, offset + 5 + length));
      const status = /^grpc-status:\s*(\d+)/im.exec(trailer)?.[1];
      return status === undefined ? null : Number(status);
    }
    offset += 5 + length;
  }
  return null;
}

class WorkflowRunActionError extends Schema.TaggedError<WorkflowRunActionError>()(
  "WorkflowRunActionError",
  { status: Schema.NullOr(Schema.Number) },
) {}

export const workflowRunAction = createPermissionAwareRuntimeCommand(connectionAtomRuntime, {
  label: "workflow run action",
  execute: (input: {
    environmentId: EnvironmentId;
    threadId: ThreadId;
    connectionId: string;
    daemonId: string;
    runId: string;
    action: WorkflowRunAction;
  }) =>
    runStreamInEnvironment(
      input.environmentId,
      runStreamGuarded(WS_METHODS.tiximFlowWrite, {
        threadId: input.threadId,
        connectionId: input.connectionId,
        daemonId: input.daemonId,
        method: `tix.control.v1.WorkflowsControl/${METHODS[input.action]}`,
        body: encodeWorkflowIdRequest(input.runId),
      }),
    ).pipe(
      Stream.runCollect,
      Effect.flatMap((chunks) => {
        const status = grpcWebStatus(chunks);
        return status === 0 ? Effect.void : Effect.fail(new WorkflowRunActionError({ status }));
      }),
    ),
});
