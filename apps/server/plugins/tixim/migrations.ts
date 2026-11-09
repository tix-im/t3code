import Links from "./migrations/001_TiximWorkflowLinks.ts";
import Relationships from "./migrations/002_TiximWorkflowRelationships.ts";
import Inactivity from "./migrations/003_TiximWorkflowWaitInactivity.ts";
import Notifications from "./migrations/004_TiximWorkflowNotifications.ts";

// Builds before the separate table recorded these names as core ids 73-76; startup adopts them by name.
export const migrationTrack = {
  table: "tixim_sql_migrations",
  migrations: [
    [1, "TiximWorkflowLinks", Links],
    [2, "TiximWorkflowRelationships", Relationships],
    [3, "TiximWorkflowWaitInactivity", Inactivity],
    [4, "TiximWorkflowNotifications", Notifications],
  ],
} as const;
