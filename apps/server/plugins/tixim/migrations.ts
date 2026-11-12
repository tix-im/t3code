import Links from "./migrations/001_TiximWorkflowLinks.ts";
import Relationships from "./migrations/002_TiximWorkflowRelationships.ts";
import Inactivity from "./migrations/003_TiximWorkflowWaitInactivity.ts";

// Builds before the separate table recorded these names as core ids 73-75; startup adopts them by name.
export const migrationTrack = {
  table: "tixim_sql_migrations",
  migrations: [
    [1, "TiximWorkflowLinks", Links],
    [2, "TiximWorkflowRelationships", Relationships],
    [3, "TiximWorkflowWaitInactivity", Inactivity],
  ],
} as const;
