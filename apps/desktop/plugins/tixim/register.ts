import * as Effect from "effect/Effect";
import { DesktopIpc } from "../../src/plugins/host.ts";
import { discoverTiximProjects, installTiximSshConfig } from "./ipc.ts";
export const register = Effect.gen(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  yield* ipc.handle(discoverTiximProjects);
  yield* ipc.handle(installTiximSshConfig);
});
