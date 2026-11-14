import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE tixim_workflow_links (
    thread_id TEXT NOT NULL, daemon_id TEXT NOT NULL, run_id TEXT NOT NULL,
    connection_id TEXT NOT NULL, source TEXT NOT NULL, excluded INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL, PRIMARY KEY(thread_id, daemon_id, run_id)
  )`;
  yield* sql`CREATE TRIGGER tixim_workflow_links_thread_deleted AFTER UPDATE OF deleted_at
    ON orchestration_v2_projection_threads WHEN NEW.deleted_at IS NOT NULL
    BEGIN DELETE FROM tixim_workflow_links WHERE thread_id = NEW.thread_id; END`;
  yield* sql`CREATE TRIGGER tixim_workflow_links_thread_inserted_deleted AFTER INSERT
    ON orchestration_v2_projection_threads WHEN NEW.deleted_at IS NOT NULL
    BEGIN DELETE FROM tixim_workflow_links WHERE thread_id = NEW.thread_id; END`;
});
