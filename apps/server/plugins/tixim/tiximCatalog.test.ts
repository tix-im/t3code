import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type * as ProcessRunner from "../../src/processRunner.ts";
import { listTiximContexts, listTiximHarnesses, listTiximModels } from "./tiximCatalog.ts";

function fakeRunner(
  respond: (input: ProcessRunner.ProcessRunInput) => {
    stdout: string;
    code?: number;
    stderr?: string;
  },
  calls: Array<ProcessRunner.ProcessRunInput> = [],
): ProcessRunner.ProcessRunner["Service"] {
  return {
    run: (input) => {
      calls.push(input);
      const { stdout, code = 0, stderr = "" } = respond(input);
      return Effect.succeed({
        stdout,
        stderr,
        code: code as never,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      });
    },
  };
}

const brandIcon = {
  viewBox: "0 0 24 24",
  fill: { light: "#000000", dark: "#FFFFFF" },
  paths: [{ d: "M0 0h24v24H0Z" }],
};
const harnessIcon = { id: "openai", label: "Codex", plain: brandIcon, tixim: brandIcon };

const CONTEXTS = JSON.stringify([
  { current: "", name: "dev-0", status: "running", url: "http://127.0.0.1:7280" },
  { current: "*", name: "server", status: "running", url: "http://127.0.0.1:7080" },
]);

describe("tixim catalog", () => {
  it.effect("lists contexts behind a default entry for the current one", () =>
    Effect.gen(function* () {
      const result = yield* listTiximContexts(
        fakeRunner(() => ({ stdout: CONTEXTS })),
        {},
      );
      expect(result.contexts.map((context) => [context.name, context.label])).toEqual([
        ["", "Default (server)"],
        ["dev-0", "dev-0"],
        ["server", "server"],
      ]);
    }),
  );

  it.effect("names the run's daemon as the default inside a run", () =>
    Effect.gen(function* () {
      const result = yield* listTiximContexts(
        fakeRunner(() => ({ stdout: "[]" })),
        {
          TIX_DAEMON_URL: "http://10.0.0.1:7080",
        },
      );
      expect(result.contexts).toEqual([
        {
          name: "",
          label: "Default (http://10.0.0.1:7080)",
          url: "http://10.0.0.1:7080",
          status: "running",
          current: true,
        },
      ]);
    }),
  );

  it.effect("lists only ACP harnesses and drops host credentials for another context", () =>
    Effect.gen(function* () {
      const calls: Array<ProcessRunner.ProcessRunInput> = [];
      const result = yield* listTiximHarnesses(
        fakeRunner(
          () => ({
            stdout: JSON.stringify([
              {
                name: "codex",
                description: "Codex",
                authenticated: "yes",
                has_acp: "yes",
                icon: harnessIcon,
              },
              {
                name: "hermes",
                description: "Hermes",
                authenticated: "no",
                has_acp: "yes",
                icon: { id: "broken" },
              },
              { name: "aider", description: "Aider", authenticated: "no", has_acp: "no" },
            ]),
          }),
          calls,
        ),
        { PATH: "/bin", TIX_DAEMON_AUTH_TOKEN: "secret" },
        "dev-0",
      );
      expect(result.harnesses).toEqual([
        { name: "codex", description: "Codex", authenticated: true, icon: harnessIcon },
        { name: "hermes", description: "Hermes", authenticated: false },
      ]);
      expect(calls[0]?.args).toEqual(["--context", "dev-0", "-o", "json", "harnesses", "list"]);
      expect(calls[0]?.env).toEqual({ PATH: "/bin", TIX_WAIT_FOR_DAEMON: "0" });
    }),
  );

  it.effect("lists gateway models without endpoint placeholders or duplicates", () =>
    Effect.gen(function* () {
      const result = yield* listTiximModels(
        fakeRunner(() => ({
          stdout: JSON.stringify([
            { model: "gateway-model", source: "registry", state: "approved" },
            { model: "gateway-model", source: "alias", state: "approved" },
            { model: "Endpoint", source: "endpoint", state: "approved" },
            { model: "disabled-model", source: "registry", state: "disabled" },
          ]),
        })),
        {},
        { context: "", harness: "codex", routing: "gateway" },
      );
      expect(result.models).toEqual([{ id: "gateway-model", name: "gateway-model" }]);
    }),
  );

  it.effect("uses the selected harness catalog for native and declared routing", () =>
    Effect.gen(function* () {
      for (const routing of ["native", "default"] as const) {
        const calls: Array<ProcessRunner.ProcessRunInput> = [];
        const result = yield* listTiximModels(
          fakeRunner(
            () => ({
              stdout: JSON.stringify({
                models: [{ id: "opus", name: "Opus" }],
              }),
            }),
            calls,
          ),
          { TIX_DAEMON_AUTH_TOKEN: "secret" },
          {
            context: "remote",
            harness: "claude-code",
            routing,
          },
        );
        expect(result.models).toEqual([{ id: "opus", name: "Opus" }]);
        expect(calls[0]?.args).toEqual([
          "--context",
          "remote",
          "-o",
          "json",
          "harnesses",
          "models",
          "claude-code",
          "--routing",
          routing,
        ]);
        expect(calls[0]?.env?.TIX_DAEMON_AUTH_TOKEN).toBeUndefined();
      }
    }),
  );

  it.effect("offers gateway models for declared routing until tix lists harness models", () =>
    Effect.gen(function* () {
      const calls: Array<ProcessRunner.ProcessRunInput> = [];
      const runner = fakeRunner(
        (input) =>
          input.args.includes("harnesses")
            ? { stdout: "", code: 2, stderr: "error: unrecognized subcommand 'models'\n" }
            : {
                stdout: JSON.stringify([
                  { model: "gateway-model", source: "registry", state: "approved" },
                ]),
              },
        calls,
      );
      const result = yield* listTiximModels(
        runner,
        {},
        { context: "remote", harness: "codex", routing: "default" },
      );
      expect(result.models).toEqual([{ id: "gateway-model", name: "gateway-model" }]);
      expect(calls.at(-1)?.args).toEqual([
        "--context",
        "remote",
        "-o",
        "json",
        "gateway",
        "models",
        "list",
      ]);

      const native = yield* listTiximModels(
        runner,
        {},
        { context: "remote", harness: "codex", routing: "native" },
      ).pipe(Effect.flip);
      expect(native.message).toBe(
        "This connection needs a newer Tixim daemon and tix CLI to list harness models.",
      );
    }),
  );

  it.effect("reports the last stderr line of a failing tix", () =>
    Effect.gen(function* () {
      const error = yield* listTiximHarnesses(
        fakeRunner(() => ({ stdout: "", code: 1, stderr: "warn\nError: unknown context 'x'\n" })),
        {},
        "x",
      ).pipe(Effect.flip);
      expect(error.message).toBe(
        "tix --context x -o json harnesses list failed: Error: unknown context 'x'",
      );
    }),
  );
});
