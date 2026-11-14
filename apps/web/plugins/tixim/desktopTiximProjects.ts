import type { DesktopBridge, DesktopTiximProject } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

type DesktopTiximDiscoveryBridge = Pick<DesktopBridge, "discoverTiximProjects">;

/** Strips the Electron IPC and tagged-error prefixes from a bridge failure. */
export function formatDesktopTiximError(error: unknown, fallback: string): string {
  const rawMessage = error instanceof Error ? error.message : fallback;
  const message = rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*/u, "")
    .replace(/^[A-Za-z]+Error:\s*/u, "")
    .trim();
  if (message.includes("[tix_not_found]")) {
    return "tix CLI not found. Install tix or set T3_TIX_BIN for the desktop app.";
  }
  return message || fallback;
}

class DesktopTiximDiscoveryUnavailableError extends Schema.TaggedError<DesktopTiximDiscoveryUnavailableError>()(
  "DesktopTiximDiscoveryUnavailableError",
  {},
) {
  override get message(): string {
    return "Desktop tixim project discovery is unavailable.";
  }
}

class DesktopTiximDiscoveryError extends Schema.TaggedError<DesktopTiximDiscoveryError>()(
  "DesktopTiximDiscoveryError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return formatDesktopTiximError(this.cause, "Failed to discover tixim projects.");
  }
}

function getDesktopTiximDiscoveryBridge(): DesktopTiximDiscoveryBridge | undefined {
  return typeof window === "undefined" ? undefined : window.desktopBridge;
}

function createDesktopTiximProjectsStateAtom(
  getBridge: () => DesktopTiximDiscoveryBridge | undefined,
) {
  const discoverDesktopTiximProjects = Effect.fn("discoverDesktopTiximProjects")(function* () {
    const discover = getBridge()?.discoverTiximProjects;
    if (!discover) {
      return yield* new DesktopTiximDiscoveryUnavailableError();
    }
    return yield* Effect.tryPromise({
      try: (): Promise<ReadonlyArray<DesktopTiximProject>> => discover(),
      catch: (cause) => new DesktopTiximDiscoveryError({ cause }),
    });
  });

  return Atom.make(discoverDesktopTiximProjects()).pipe(
    Atom.swr({ staleTime: 30_000, revalidateOnMount: true }),
    Atom.keepAlive,
    Atom.withLabel("desktop:tixim-projects"),
  );
}

export const desktopTiximProjectsStateAtom = createDesktopTiximProjectsStateAtom(
  getDesktopTiximDiscoveryBridge,
);
