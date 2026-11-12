import { workflowPattern } from "@t3tools/client-runtime/plugins/tixim/references";
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export function rehypeWorkflowReferences() {
  return (tree: HastNode) => {
    const visit = (parent: HastNode) => {
      if (parent.type === "element" && parent.tagName === "a") {
        const label = parent.children?.length === 1 ? parent.children[0] : undefined;
        if (
          label?.type === "text" &&
          typeof label.value === "string" &&
          label.value.match(workflowPattern)?.[0] === label.value
        ) {
          parent.properties = { ...parent.properties, dataWorkflowHid: label.value };
        }
        return;
      }
      if (parent.type === "element" && ["pre", "script", "style"].includes(parent.tagName ?? ""))
        return;
      parent.children = (parent.children ?? []).flatMap((child): HastNode[] => {
        if (child.type === "element") visit(child);
        if (child.type !== "text" || child.value === undefined) return [child];
        const parts: HastNode[] = [];
        let offset = 0;
        for (const match of child.value.matchAll(workflowPattern)) {
          if (match.index > offset)
            parts.push({ type: "text", value: child.value.slice(offset, match.index) });
          parts.push({
            type: "element",
            tagName: "a",
            properties: { href: `#${match[0]}`, dataWorkflowHid: match[0] },
            children: [{ type: "text", value: match[0] }],
          });
          offset = match.index + match[0].length;
        }
        if (offset === 0) return [child];
        if (offset < child.value.length)
          parts.push({ type: "text", value: child.value.slice(offset) });
        return parts;
      });
    };
    visit(tree);
  };
}
