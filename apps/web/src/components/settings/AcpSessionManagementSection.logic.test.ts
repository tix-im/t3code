import { describe, expect, it } from "vite-plus/test";

import { projectPickerLabels } from "./AcpSessionManagementSection.logic";

describe("projectPickerLabels", () => {
  it("tells projects with the same title apart by folder, then by full path", () => {
    const labels = projectPickerLabels([
      { id: "a", title: "tix.im", workspaceRoot: "/home/u/tix/tixim" },
      { id: "b", title: "tix.im", workspaceRoot: "/home/u/tix/tixim-stable/" },
      { id: "c", title: "nix", workspaceRoot: "/home/u/nix" },
      { id: "d", title: "app", workspaceRoot: "/one/app" },
      { id: "e", title: "app", workspaceRoot: "/two/app" },
    ]);

    expect([...labels.values()]).toEqual([
      "tix.im (tixim)",
      "tix.im (tixim-stable)",
      "nix",
      "app (/one/app)",
      "app (/two/app)",
    ]);
  });
});
