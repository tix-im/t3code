import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import { mergeContributions } from "../src/plugins/registry.ts";
import { pluginActive } from "./active.ts";
import * as TiximRpc from "./tixim/rpc.ts";
import * as TiximLifecycle from "./tixim/lifecycle.ts";

export const makePluginRpcHandlers = Effect.map(
  TiximRpc.makeRpcHandlersFor(pluginActive),
  (handlers) => mergeContributions(handlers),
);
export const pluginServices = TiximLifecycle.services;
export const pluginRpcContext = TiximLifecycle.rpcContext;
export const pluginStartup = pluginActive ? TiximLifecycle.startup : Layer.empty;
