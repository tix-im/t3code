import {
  TiximWorkflowListResult,
  TiximWorkflowRelationship,
  TiximWorkflowWaitInput,
  TiximWorkflowWaitResult,
  OrchestratorMcpEnvironmentTarget,
  ThreadId,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext, ThreadManagementService } from "../../src/plugins/host.ts";

const ThreadWorkflowsTool = Tool.make("t3_thread_workflows", {
  description:
    "List linked Tixim executions, search accessible runs on a connection, or attach/detach a run. Omit threadId for this thread. attach also updates relationship: owner for work this thread submitted, tracking for observation (manual default), waiting_on for a dependency. Relationships grant no run permissions. Chat mentions are only suggestions; mentionedOnly searches exact wf-… IDs mentioned in the chat. Detach removes only this thread's link and never cancels a run. Use t3_workflows_wait to sleep until linked work finishes.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    threadId: Schema.optional(ThreadId),
    action: Schema.Literals(["list", "search", "attach", "detach"]),
    connectionId: Schema.optional(Schema.String),
    daemonId: Schema.optional(Schema.String),
    runId: Schema.optional(Schema.String),
    query: Schema.optional(Schema.String),
    mentionedOnly: Schema.optional(Schema.Boolean),
    relationship: Schema.optional(TiximWorkflowRelationship),
  }),
  success: TiximWorkflowListResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
});

const WorkflowWaitTool = Tool.make("t3_workflows_wait", {
  description:
    "Sleep on linked unfinished task workflows; hosting sessions are excluded. timeoutSeconds is per-run inactivity: counted only during execution, renewed by step/agent progress; queue/build phases do not count. Omit for no timeout. Filter with relationships. T3 persists the wait and wakes on completion, failure/approval, detachment or timeout. Connection loss stays pending. End your turn after status=waiting; do not poll. A new call replaces the wait; waiting=false cancels only the wait. Newly attached runs need a new wait.",
  parameters: Schema.Struct({
    ...TiximWorkflowWaitInput.fields,
    threadId: Schema.optional(ThreadId),
    environmentId: OrchestratorMcpEnvironmentTarget,
  }),
  success: TiximWorkflowWaitResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
});

export const toolkit = Toolkit.make(ThreadWorkflowsTool, WorkflowWaitTool);
