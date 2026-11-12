import Links from "./migrations/001_TiximWorkflowLinks.ts";
import Relationships from "./migrations/002_TiximWorkflowRelationships.ts";
import Inactivity from "./migrations/003_TiximWorkflowWaitInactivity.ts";
import Notifications from "./migrations/004_TiximWorkflowNotifications.ts";
import Snoozes from "./migrations/005_TiximWorkflowSnoozes.ts";
import ProjectLinks from "./migrations/006_TiximProjectLinks.ts";

// Builds before the separate table recorded these names as core ids 73-78; startup adopts them by name.
export const migrationTrack = {
  table: "tixim_sql_migrations",
  migrations: [
    [1, "TiximWorkflowLinks", Links],
    [2, "TiximWorkflowRelationships", Relationships],
    [3, "TiximWorkflowWaitInactivity", Inactivity],
    [4, "TiximWorkflowNotifications", Notifications],
    [5, "TiximWorkflowSnoozes", Snoozes],
    [6, "TiximProjectLinks", ProjectLinks],
  ],
} as const;
