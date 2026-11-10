import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { TiximSettings } from "./settings.ts";
import {
  TIXIM_DRIVER_KIND,
  TiximDriver,
  tiximAcpSettings,
  tiximBranding,
  tiximCommandArgs,
  tiximHostEnvironment,
} from "./driver.ts";

const decodeSettings = Schema.decodeSync(TiximSettings);
const decodeUnknownSettings = Schema.decodeUnknownSync(TiximSettings);

describe("Tixim driver", () => {
  it("defaults to the current context with a four hour linger", () => {
    const settings = decodeSettings({});
    expect(settings).toMatchObject({
      context: "",
      harness: "",
      model: "",
      routing: "default",
      linger: "4h",
      workflow: "",
    });
    expect(TiximDriver.driverKind).toBe(TIXIM_DRIVER_KIND);
  });

  it("serves the harness on the selected context", () => {
    expect(
      tiximCommandArgs(decodeSettings({ context: "dev-0", harness: "codex", linger: "1h" })),
    ).toEqual(["--context", "dev-0", "acp", "serve", "--harness", "codex", "--linger", "3600"]);
  });

  it("passes the initial model and routing", () => {
    expect(
      tiximCommandArgs(
        decodeSettings({
          harness: "codex",
          model: "profile/fast",
          routing: "gateway",
          linger: "off",
        }),
      ),
    ).toEqual(["acp", "serve", "--harness", "codex", "--model", "profile/fast", "--gateway"]);
    expect(
      tiximCommandArgs(decodeSettings({ harness: "codex", routing: "native", linger: "off" })),
    ).toEqual(["acp", "serve", "--harness", "codex", "--native"]);
  });

  it("omits linger when the worker stops with the thread and passes a workflow", () => {
    expect(
      tiximCommandArgs(
        decodeSettings({ harness: "claude-code", linger: "off", workflow: "catalog:x/y" }),
      ),
    ).toEqual(["acp", "serve", "--harness", "claude-code", "--workflow", "catalog:x/y"]);
  });

  it("runs tix as a local ACP agent and stays unconfigured without a harness", () => {
    expect(tiximAcpSettings(decodeSettings({ harness: "codex" }), {})).toMatchObject({
      source: "local",
      commandPath: "tix",
      commandArgs: ["acp", "serve", "--harness", "codex", "--linger", "14400"],
    });
    expect(tiximAcpSettings(decodeSettings({}), {})).toMatchObject({
      source: "local",
      commandPath: "",
      commandArgs: [],
    });
  });

  it("keeps the packaged CLI ahead of a hydrated login PATH", () => {
    expect(
      tiximAcpSettings(decodeSettings({ harness: "codex" }), {
        PATH: "/old/login/path",
        T3_TIXIM_CLI_PATH: "/pinned/tix",
      }).commandPath,
    ).toBe("/pinned/tix");
  });

  it("brands the instance with the picked harness and accepts only inert icons", () => {
    const icon = {
      viewBox: "0 0 24 24",
      fill: { light: "#4A3CD6", dark: "#8478F0" },
      paths: [{ d: "M0 0h24v24H0Z", fillRule: "evenodd" }],
    };
    expect(
      tiximBranding(
        decodeUnknownSettings({
          harness: "claude-code",
          harnessLabel: "Claude",
          harnessIcon: icon,
        }),
      ),
    ).toEqual({ displayName: "Tixim Claude", icon });
    expect(tiximBranding(decodeSettings({ harness: "hermes" }))).toEqual({
      displayName: "Tixim hermes",
      icon: undefined,
    });
    expect(tiximBranding(decodeSettings({}))).toEqual({});
    for (const harnessIcon of [
      { ...icon, fill: { light: "url(https://x/y)", dark: "#fff" } },
      { ...icon, paths: [{ d: "M0 0<script>" }] },
    ]) {
      expect(
        tiximBranding(decodeUnknownSettings({ harness: "x", harnessLabel: "X", harnessIcon })),
      ).toEqual({ displayName: "Tixim X", icon: undefined });
    }
  });

  it("rejects linger values outside the offered choices", () => {
    expect(() => decodeUnknownSettings({ linger: "7m" })).toThrow();
  });

  it("drops host tix credentials only for an explicit context", () => {
    const host = {
      PATH: "/bin",
      TIX_DAEMON_URL: "http://run",
      TIX_DAEMON_AUTH_TOKEN: "run-token",
      TIX_SERVICE_TOKEN: "service",
      TIXIM_URL: "http://run",
    };
    expect(tiximHostEnvironment(host, { context: "" })).toBe(host);
    expect(tiximHostEnvironment(host, { context: "server" })).toEqual({ PATH: "/bin" });
  });

  it("points the default context at the run's daemon", () => {
    expect(tiximHostEnvironment({ TIX_DAEMON_URL: "http://run" }, { context: "" })).toEqual({
      TIX_DAEMON_URL: "http://run",
      TIXIM_URL: "http://run",
    });
    const pinned = { TIX_DAEMON_URL: "http://run", TIXIM_URL: "http://other" };
    expect(tiximHostEnvironment(pinned, { context: "" })).toBe(pinned);
  });
});
