import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE tixim_workflow_snoozes (
    thread_id TEXT PRIMARY KEY, snooze_id TEXT NOT NULL, targets_json TEXT NOT NULL,
    snoozed_until_ms INTEGER NOT NULL
  )`;
  yield* sql`CREATE TRIGGER tixim_workflow_snoozes_thread_deleted AFTER UPDATE OF deleted_at
    ON orchestration_v2_projection_threads WHEN NEW.deleted_at IS NOT NULL
    BEGIN DELETE FROM tixim_workflow_snoozes WHERE thread_id = NEW.thread_id; END`;
});
