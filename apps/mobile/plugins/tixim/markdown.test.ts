import { expect, it } from "vite-plus/test";
import { workflowReferences, decorateWorkflowReferences } from "./markdown";

it("decorates prose, inline HIDs and named links while leaving code blocks and URL targets intact", () => {
  const hid = "wf-calm-river-a12b";
  const source = `Follow ${hid}, \`${hid}\`, [${hid}](https://example.com), [site](https://example.com/${hid}).\n\n\`\`\`\n${hid}\n\`\`\``;
  const references = workflowReferences(source);
  expect(references).toHaveLength(3);
  const link = `[▶ ${hid}](t3-workflow:${hid})`;
  expect(decorateWorkflowReferences(source, references, () => "▶")).toBe(
    `Follow ${link}, ${link}, ${link}, [site](https://example.com/${hid}).\n\n\`\`\`\n${hid}\n\`\`\``,
  );
});
