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
    fill: { light: "#000000", dark: "#FFFFFF" },
    paths: [
      {
        // A "t" inside a rounded frame.
        d: "M6 2h12a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Zm0 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6Zm4.5 2.5h2.25v3h3.75v2.25h-3.75v3.5c0 .69.56 1.25 1.25 1.25h2.5v2.25h-2.5a3.5 3.5 0 0 1-3.5-3.5v-3.5H8V9.5h2.5v-3Z",
        fillRule: "evenodd",
      },
    ],
  },
});
