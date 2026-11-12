import { expect, it } from "vite-plus/test";
import { rehypeWorkflowReferences } from "./markdownWorkflowReferences";

it("detects every complete HID in prose and inline code without rewriting fenced code or nesting links", () => {
  const element = (tagName: string, value: string) => ({
    type: "element",
    tagName,
    properties: {} as Record<string, unknown>,
    children: [{ type: "text", value }],
  });
  const prose: Parameters<ReturnType<typeof rehypeWorkflowReferences>>[0] = element(
    "p",
    "(wf-calm-river-a12b), wf-brisk-reef-31b4. xwf-no-match wf-no-match_ wf-",
  );
  const code = element("code", "wf-calm-river-a12b");
  const pre = element("pre", "wf-calm-river-a12b");
  const link = element("a", "wf-calm-river-a12b");
  const tree = { type: "root", children: [prose, code, pre, link] };
  rehypeWorkflowReferences()(tree);
  expect(
    prose
      .children!.filter((node) => node.type === "element")
      .map((node) => node.properties?.dataWorkflowHid),
  ).toEqual(["wf-calm-river-a12b", "wf-brisk-reef-31b4"]);
  expect(code.children[0]).toMatchObject({
    tagName: "a",
    properties: { dataWorkflowHid: "wf-calm-river-a12b" },
  });
  expect(pre.children[0]?.type).toBe("text");
  expect(link.children[0]?.type).toBe("text");
  expect(link.properties.dataWorkflowHid).toBe("wf-calm-river-a12b");
  const once = JSON.stringify(tree);
  rehypeWorkflowReferences()(tree);
  expect(JSON.stringify(tree)).toBe(once);
});
