import { TrimmedString, makeProviderSettingsSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** How long a tix worker outlives the T3 thread that started it. */
export const TiximLinger = Schema.Literals(["4h", "off", "15m", "1h", "12h", "24h"]);
export type TiximLinger = typeof TiximLinger.Type;

export const TIXIM_LINGER_SECONDS: Readonly<Record<TiximLinger, number>> = {
  off: 0,
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "12h": 12 * 60 * 60,
  "24h": 24 * 60 * 60,
};

const TIXIM_LINGER_LABELS: Readonly<Record<TiximLinger, string>> = {
  "4h": "4 hours",
  off: "Stop with the thread",
  "15m": "15 minutes",
  "1h": "1 hour",
  "12h": "12 hours",
  "24h": "24 hours",
};

/** Where a new worker's model calls go; each thread can change it in its options. */
export const TiximRouting = Schema.Literals(["default", "gateway", "native"]);
export type TiximRouting = typeof TiximRouting.Type;

const TIXIM_ROUTING_LABELS: Readonly<Record<TiximRouting, string>> = {
  default: "Harness default",
  gateway: "Tix gateway",
  native: "Harness login",
};

export const TiximSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(true)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    context: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Tixim context",
        description:
          "The tix context whose daemon runs the agent. Default is this environment's current context.",
        providerSettingsForm: { control: "select", clearWhenEmpty: "omit" },
      }),
    ),
    harness: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Harness",
        description: "Catalog harness started inside the context's session workflow.",
        providerSettingsForm: { control: "select", clearWhenEmpty: "omit" },
      }),
    ),
    linger: TiximLinger.pipe(
      Schema.withDecodingDefault(Effect.succeed("4h")),
      Schema.annotateKey({
        title: "Keep worker",
        description:
          "How long the tix worker keeps running after its thread disconnects, so the thread can resume it.",
        providerSettingsForm: {
          control: "select",
          clearWhenEmpty: "omit",
          options: TiximLinger.literals.map((value) => ({
            value,
            label: TIXIM_LINGER_LABELS[value],
          })),
        },
      }),
    ),
    model: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Initial model",
        description:
          "A model ID for the selected harness and routing, or `profile/<name>`. Each thread can pick another.",
        providerSettingsForm: { placeholder: "Harness default", clearWhenEmpty: "omit" },
      }),
    ),
    routing: TiximRouting.pipe(
      Schema.withDecodingDefault(Effect.succeed("default")),
      Schema.annotateKey({
        title: "Initial routing",
        description: "Whether new workers use the tix gateway or the harness's own login.",
        providerSettingsForm: {
          control: "select",
          clearWhenEmpty: "omit",
          options: TiximRouting.literals.map((value) => ({
            value,
            label: TIXIM_ROUTING_LABELS[value],
          })),
        },
      }),
    ),
    workflow: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Session workflow",
        description: "Workflow the worker runs in. Empty uses tix's session workflow.",
        providerSettingsForm: { placeholder: "catalog:tixim/acp-session", clearWhenEmpty: "omit" },
      }),
    ),
    customModels: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["context", "harness", "routing", "model", "linger", "workflow"],
  },
);
export type TiximSettings = typeof TiximSettings.Type;
