import { unified } from "unified";
import remarkParse from "remark-parse";
import type { RootContent } from "mdast";
import { workflowPattern } from "@t3tools/client-runtime/plugins/tixim/references";

const parser = unified().use(remarkParse);
export function workflowReferences(markdown: string) {
  const references: Array<{ start: number; end: number; hid: string }> = [];
  const visit = (node: RootContent) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === "inlineCode" || node.type === "link") {
      const label =
        node.type === "inlineCode"
          ? node.value
          : node.children.length === 1 && node.children[0]?.type === "text"
            ? node.children[0].value
            : "";
      if (label.match(workflowPattern)?.[0] === label && label)
        references.push({ start, end, hid: label });
    } else if (node.type === "text") {
      const source = markdown.slice(start, end);
      for (const match of source.matchAll(workflowPattern)) {
        references.push({
          start: start + match.index,
          end: start + match.index + match[0].length,
          hid: match[0],
        });
      }
    } else if (node.type !== "linkReference" && "children" in node) {
      for (const child of node.children) visit(child);
    }
  };
  for (const node of parser.parse(markdown).children) visit(node);
  return references;
}
export function decorateWorkflowReferences(
  markdown: string,
  references: ReturnType<typeof workflowReferences>,
  symbol: (hid: string) => string,
) {
  let result = markdown;
  for (const ref of [...references].reverse()) {
    result = `${result.slice(0, ref.start)}[${symbol(ref.hid)} ${ref.hid}](t3-workflow:${ref.hid})${result.slice(ref.end)}`;
  }
  return result;
}
