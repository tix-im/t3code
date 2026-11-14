import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

import { TiximSettings } from "./settings.ts";

export const tiximClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("tixim"),
  label: "Tixim",
  settingsSchema: TiximSettings,
  hasDefaultInstance: false,
  icon: {
    viewBox: "0 0 24 24",
    // The TiX mark (i-dot and pointer), tixim's `tix` harness icon.
    fill: { light: "#4A3CD6", dark: "#8478F0" },
    paths: [
      { d: "M0 6.52a4.15 4.15 0 1 0 8.3 0 4.15 4.15 0 1 0-8.3 0" },
      {
        d: "M19.56 12.44c-2.37 0-11.26 2.97-11.26 4.45s8.89 4.44 11.26 4.44a4.44 4.44 0 0 0 0-8.89",
      },
    ],
  },
});
