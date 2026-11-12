import { pluginContract } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import { mergeContributions } from "../src/plugins/registry.ts";
import * as TiximRpc from "./tixim/rpc.ts";
import * as TiximLifecycle from "./tixim/lifecycle.ts";

export const makePluginRpcHandlers = Effect.map(
  TiximRpc.makeRpcHandlersFor(pluginContract.enabled),
  (handlers) => mergeContributions(handlers),
);
export const pluginServices = TiximLifecycle.services;
export const pluginStartup = pluginContract.enabled ? TiximLifecycle.startup : Layer.empty;
