import type { EnvironmentId, ThreadId, TiximWorkflowRun } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

export const sidebarWorkflowSelectionAtom = Atom.family((_environmentId: EnvironmentId) =>
  Atom.family((_threadId: ThreadId) => Atom.make<TiximWorkflowRun | null>(null)),
);
