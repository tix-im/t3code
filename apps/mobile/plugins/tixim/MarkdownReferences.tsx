import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { workflowStateSymbol } from "@t3tools/client-runtime/plugins/tixim/references";
import type { PluginMarkdownProps } from "../../src/plugins/api";
import { workflowEnvironment } from "./state";
import { ThreadWorkflows } from "./ThreadWorkflows";
import { workflowReferences, decorateWorkflowReferences } from "./markdown";

export function MarkdownReferences(props: PluginMarkdownProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const references = workflowReferences(props.markdown);
  const markdownAtom = Atom.make((get) =>
    decorateWorkflowReferences(props.markdown, references, (hid) => {
      const state = get(workflowEnvironment.reference(props.environmentId)(props.threadId)(hid));
      return workflowStateSymbol(
        state.runs.length === 1 && state.runs[0]?.availability === "available"
          ? state.runs[0].state
          : "unknown",
      );
    }),
  );
  const markdown = useAtomValue(markdownAtom);
  return (
    <>
      {props.renderMarkdown(markdown, (href) => {
        const reference = references.find((ref) => `t3-workflow:${ref.hid}` === href);
        if (reference) setSelected(reference.hid);
        else props.onLinkPress?.(href);
      })}
      {selected ? (
        <ThreadWorkflows
          key={selected}
          environmentId={props.environmentId}
          threadId={props.threadId}
          referenceHid={selected}
          onDismiss={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
