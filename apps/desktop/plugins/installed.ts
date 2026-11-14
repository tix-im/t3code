import { pluginContract } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { register } from "./tixim/register.ts";
export const registerPluginIpc = pluginContract.enabled ? register : Effect.void;
