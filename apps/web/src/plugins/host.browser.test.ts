import { expect, it, vi } from "vite-plus/test";

const plugins = vi.hoisted(() => ({ loaded: false }));

// Plugins import the host, so a host export that loads them closes an import cycle, and
// Vitest mocks that load the original module then deadlock before any test runs.
vi.mock(import("../../plugins/installed"), () => {
  plugins.loaded = true;
  return { installedWebPlugins: [] };
});

it("loads without loading the installed plugins", async () => {
  await import("./host");
  expect(plugins.loaded, "src/plugins/host must not import the plugin registry").toBe(false);
});
