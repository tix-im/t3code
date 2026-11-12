import {
  TiximWorkflowListResult,
  TiximWorkflowPollResult,
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
    "List linked Tixim executions, search accessible runs on a connection, attach/detach a run, or poll for queued updates. Omit threadId for this thread. attach also updates relationship: owner for work this thread submitted, tracking for observation (default), waiting_on for a dependency, untracked for context that must never wake this thread. Relationships grant no run permissions. Tracked runs that finish or need attention are queued; poll consumes the queue mid-turn, and T3 wakes the idle thread with anything left unpolled. Chat mentions are only suggestions; mentionedOnly searches exact wf-… IDs mentioned in the chat. Detach removes only this thread's link and never cancels a run. Use t3_workflows_wait to sleep until linked work finishes.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    threadId: Schema.optional(ThreadId),
    action: Schema.Literals(["list", "search", "attach", "detach", "poll"]),
    connectionId: Schema.optional(Schema.String),
    daemonId: Schema.optional(Schema.String),
    runId: Schema.optional(Schema.String),
    query: Schema.optional(Schema.String),
    mentionedOnly: Schema.optional(Schema.Boolean),
    relationship: Schema.optional(TiximWorkflowRelationship),
  }),
  success: Schema.Union([TiximWorkflowListResult, TiximWorkflowPollResult]),
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
});

const WorkflowWaitTool = Tool.make("t3_workflows_wait", {
  description:
    "Sleep on linked unfinished task workflows; hosting sessions and untracked runs are excluded. Awaited runs only wake through this wait, not the update queue. timeoutSeconds is per-run inactivity: counted only during execution, renewed by step/agent progress; queue/build phases do not count. Omit for no timeout. Filter with relationships. T3 persists the wait and wakes on completion, failure/approval, detachment or timeout. Connection loss stays pending. End your turn after status=waiting; do not poll. A new call replaces the wait; waiting=false cancels only the wait. Newly attached runs need a new wait.",
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
