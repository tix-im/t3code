import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ProcessRunner } from "../../src/plugins/host.ts";
import * as TiximWorkflows from "./TiximWorkflows.ts";
import * as TiximWorkflowWaits from "./TiximWorkflowWaits.ts";

export const services = TiximWorkflowWaits.layer.pipe(
  Layer.provideMerge(TiximWorkflows.layer.pipe(Layer.provide(ProcessRunner.layer))),
);
export const startup = Layer.effectDiscard(
  TiximWorkflowWaits.WorkflowWaits.pipe(Effect.flatMap((waits) => waits.start())),
);
