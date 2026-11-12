import { expect, it, vi } from "vite-plus/test";
import type { WebPlugin } from "./api";
import { createWebPluginRegistry } from "./registry";

it("leaves Markdown and thread surfaces alone when no plugins are installed", () => {
  const registry = createWebPluginRegistry([]);
  expect(registry.rehypePlugins).toEqual([]);
  expect(registry.headers).toEqual([]);
  expect(registry.providerSettings).toEqual([]);
  expect(registry.threadDetails).toEqual([]);
  expect(
    registry.renderMarkdownAnchor({
      properties: {},
      children: "ordinary link",
      threadRef: undefined,
    }),
  ).toBeNull();
});

it("uses installation order for claimed anchors and falls through for ordinary links", () => {
  const transform = () => () => undefined;
  const element = <span>reference</span>;
  const first = vi.fn(({ properties }: { properties: Readonly<Record<string, unknown>> }) =>
    properties.reference ? element : null,
  );
  const second = vi.fn(() => null);
  const registry = createWebPluginRegistry([
    { id: "first", markdown: { rehypePlugins: [transform], renderAnchor: first } },
    { id: "second", markdown: { rehypePlugins: [], renderAnchor: second } },
  ]);
  expect(registry.rehypePlugins).toEqual([transform]);
  expect(
    registry.renderMarkdownAnchor({
      properties: { reference: "id" },
      children: "id",
      threadRef: undefined,
    }),
  ).toBe(element);
  expect(second).not.toHaveBeenCalled();
  expect(
    registry.renderMarkdownAnchor({ properties: {}, children: "link", threadRef: undefined }),
  ).toBeNull();
  expect(second).toHaveBeenCalledOnce();
});

it("rejects plugin and persisted section identity collisions", () => {
  const plugin: WebPlugin = {
    id: "example",
    threadDetails: {
      id: "example-section",
      label: "Example",
      defaultVisible: true,
      Component: () => null,
    },
  };
  expect(() => createWebPluginRegistry([plugin, plugin])).toThrow("Duplicate web plugin");
  expect(() => createWebPluginRegistry([plugin, { ...plugin, id: "other" }])).toThrow(
    "Duplicate plugin section",
  );
});

it("rejects competing settings implementations for the same provider", () => {
  const providerSettings = { driverKind: "example", Component: () => null };
  expect(() =>
    createWebPluginRegistry([
      { id: "one", providerSettings },
      { id: "two", providerSettings },
    ]),
  ).toThrow("Duplicate provider settings");
});
