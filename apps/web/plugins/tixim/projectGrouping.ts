import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { workflowEnvironment } from "./state";

const groupsAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const groups = new Map<string, string>();
    for (const id of key.split("\n").filter(Boolean)) {
      const result = get(
        workflowEnvironment.tiximProjectLinks({
          environmentId: id as EnvironmentId,
          input: {},
        }),
      );
      for (const link of AsyncResult.getOrElse(result, () => null)?.links ?? []) {
        groups.set(`${id}\0${link.projectId}`, `tixim:${link.daemonUrl}:${link.tiximProjectId}`);
      }
    }
    return groups;
  }),
);

export function useTiximProjectGrouping(environmentIds: ReadonlyArray<EnvironmentId>) {
  return useAtomValue(groupsAtom(environmentIds.toSorted().join("\n")));
}
