import { describe, expect, it } from "vite-plus/test";

import {
  tiximContextOptions,
  tiximHarnessOptions,
  tiximModelOptions,
  tiximRoutingOptions,
  withHarnessBranding,
} from "./tiximSettingsOptions.logic";

describe("tixim settings options", () => {
  it("leads with the default context and labels the others with their daemon", () => {
    expect(
      tiximContextOptions(
        [
          { name: "", label: "Default (server)", url: "", status: "", current: true },
          {
            name: "dev-0",
            label: "dev-0",
            url: "http://127.0.0.1:7280",
            status: "",
            current: false,
          },
        ],
        "",
      ),
    ).toEqual([
      { value: "", label: "Default (server)" },
      { value: "dev-0", label: "dev-0 (http://127.0.0.1:7280)" },
    ]);
  });

  it("keeps a configured context the daemon no longer lists", () => {
    expect(tiximContextOptions(null, "gone")).toEqual([
      { value: "", label: "Default" },
      { value: "gone", label: "gone (not listed)" },
    ]);
  });

  it("keeps exact model IDs and the configured model when a reload no longer lists it", () => {
    expect(
      tiximModelOptions([{ id: "provider/model", name: "Display name" }], "custom-model"),
    ).toEqual([
      { value: "", label: "Harness default" },
      { value: "provider/model", label: "Display name" },
      { value: "custom-model", label: "custom-model (not listed)" },
    ]);
    expect(tiximModelOptions(null, "opus")).toEqual([
      { value: "", label: "Harness default" },
      { value: "opus", label: "opus (not listed)" },
    ]);
  });

  it("labels models with their context window and reasoning variants", () => {
    expect(
      tiximModelOptions(
        [
          {
            id: "openai/gpt-5.5",
            name: "GPT-5.5",
            contextWindow: 400_000,
            variants: ["low", "medium", "high"],
          },
          { id: "anthropic/opus", name: "Opus", contextWindow: 1_000_000, variants: [] },
        ],
        "",
      ).map((option) => option.label),
    ).toEqual(["Harness default", "GPT-5.5 · 400K · low/medium/high", "Opus · 1M"]);
  });

  it("offers only the routings the harness supports behind its default", () => {
    const harness = (routing?: {
      default: "gateway" | "native";
      supported: Array<"gateway" | "native">;
    }) => ({
      name: "claude-code",
      description: "",
      authenticated: true,
      ...(routing ? { routing } : {}),
    });
    expect(
      tiximRoutingOptions(harness({ default: "native", supported: ["native", "gateway"] }), ""),
    ).toEqual([
      { value: "default", label: "Default (harness login)" },
      { value: "gateway", label: "Tix gateway" },
      { value: "native", label: "Harness login" },
    ]);
    expect(
      tiximRoutingOptions(harness({ default: "gateway", supported: ["gateway"] }), "native"),
    ).toEqual([
      { value: "default", label: "Default (Tix gateway)" },
      { value: "gateway", label: "Tix gateway" },
      { value: "native", label: "Harness login (not supported)" },
    ]);
    // A daemon that does not report routings keeps every choice.
    for (const listed of [harness(), undefined]) {
      expect(tiximRoutingOptions(listed, "gateway")).toEqual([
        { value: "default", label: "Harness default" },
        { value: "gateway", label: "Tix gateway" },
        { value: "native", label: "Harness login" },
      ]);
    }
  });

  it("starts the harness choices with a placeholder that reflects the listing", () => {
    const harnesses = [
      { name: "codex", description: "", authenticated: true },
      { name: "pi", description: "", authenticated: false },
    ];
    expect(tiximHarnessOptions(harnesses, "", { isPending: false, error: null })).toEqual([
      { value: "", label: "Select a harness" },
      { value: "codex", label: "codex" },
      { value: "pi", label: "pi (not signed in)" },
    ]);
    expect(tiximHarnessOptions(null, "", { isPending: true, error: null })[0]?.label).toBe(
      "Loading harnesses…",
    );
    expect(tiximHarnessOptions(null, "codex", { isPending: false, error: "boom" })).toEqual([
      { value: "", label: "Could not list harnesses" },
      { value: "codex", label: "codex (not listed)" },
    ]);
    expect(tiximHarnessOptions([], "", { isPending: false, error: null })[0]?.label).toBe(
      "No ACP harnesses on this daemon",
    );
  });

  it("stores the picked harness's label and merged icon, dropping a previous harness's", () => {
    const icon = (fill: string) => ({
      viewBox: "0 0 24 24",
      fill: { light: fill, dark: fill },
      paths: [{ d: "M0 0h24v24H0Z" }],
    });
    const harnesses = [
      {
        name: "claude-code",
        description: "",
        authenticated: true,
        icon: { id: "claude", label: "Claude", plain: icon("#111111"), tixim: icon("#222222") },
      },
      {
        name: "hermes",
        description: "",
        authenticated: true,
        icon: { id: "tix", label: "Tixim", plain: icon("#333333"), tixim: icon("#333333") },
      },
      {
        name: "evil",
        description: "",
        authenticated: true,
        icon: { id: "x", label: "X", plain: icon("red"), tixim: icon("url(https://x)") },
      },
      { name: "old", description: "", authenticated: true },
    ];
    const claude = { harness: "claude-code", harnessLabel: "Claude", harnessIcon: icon("#222222") };
    expect(withHarnessBranding({ harness: "claude-code" }, {}, harnesses)).toEqual(claude);
    expect(withHarnessBranding({ ...claude, harness: "hermes" }, claude, harnesses)).toEqual({
      harness: "hermes",
      harnessIcon: icon("#333333"),
    });
    expect(withHarnessBranding({ ...claude, harness: "evil" }, claude, harnesses)).toEqual({
      harness: "evil",
      harnessLabel: "X",
    });
    expect(withHarnessBranding({ ...claude, harness: "old" }, claude, harnesses)).toEqual({
      harness: "old",
    });
    // An unloaded listing must not wipe what the config already holds.
    expect(withHarnessBranding({ ...claude, model: "opus" }, claude, null)).toEqual({
      ...claude,
      model: "opus",
    });
  });
});
