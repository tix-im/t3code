import { expect, it } from "vite-plus/test";
import { registerPluginMethods } from "./registry.ts";

it("rejects core method replacement and wire aliases before registration", () => {
  const core = { read: "core.read" };
  expect(registerPluginMethods(core, {})).toEqual(core);
  expect(registerPluginMethods(core, { extra: "plugin.extra" })).toEqual({
    ...core,
    extra: "plugin.extra",
  });
  expect(() => registerPluginMethods(core, { read: "plugin.read" })).toThrow(
    "Duplicate plugin RPC method",
  );
  expect(() => registerPluginMethods(core, { other: "core.read" })).toThrow(
    "Duplicate plugin RPC method",
  );
  expect(() =>
    registerPluginMethods(core, { first: "plugin.read", second: "plugin.read" }),
  ).toThrow("Duplicate plugin RPC method");
});
