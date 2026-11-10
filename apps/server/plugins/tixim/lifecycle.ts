import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ProcessRunner } from "../../src/plugins/host.ts";
import * as TiximWorkflows from "./TiximWorkflows.ts";
import * as TiximWorkflowWaits from "./TiximWorkflowWaits.ts";

export const services = TiximWorkflowWaits.layer.pipe(
  Layer.provideMerge(TiximWorkflows.layer.pipe(Layer.provide(ProcessRunner.layer))),
);
export const startup = Layer.effectDiscard(
  TiximWorkflowWaits.WorkflowWaits.pipe(Effect.flatMap((waits) => waits.start())),
);
/** RPC handlers are built per connection, outside the layer that holds these services. */
export const rpcContext = Effect.serviceOption(TiximWorkflowWaits.WorkflowWaits).pipe(
  Effect.map(
    Option.match({
      onNone: () => Context.empty() as Context.Context<TiximWorkflowWaits.WorkflowWaits>,
      onSome: (waits) => Context.make(TiximWorkflowWaits.WorkflowWaits, waits),
    }),
  ),
);
