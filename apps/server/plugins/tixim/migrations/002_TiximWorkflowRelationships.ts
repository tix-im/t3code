import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE tixim_workflow_links ADD COLUMN relationship TEXT NOT NULL DEFAULT 'tracking'`;
  yield* sql`UPDATE tixim_workflow_links SET relationship = 'owner' WHERE source IN ('automatic', 'agent_session')`;
  yield* sql`UPDATE tixim_workflow_links SET payload_json = json_set(payload_json, '$.relationship', relationship)`;
  yield* sql`CREATE TABLE tixim_workflow_waits (
    thread_id TEXT PRIMARY KEY, wait_id TEXT NOT NULL, targets_json TEXT NOT NULL,
    deadline_ms INTEGER, wake_json TEXT
  )`;
  yield* sql`CREATE TRIGGER tixim_workflow_waits_thread_deleted AFTER UPDATE OF deleted_at
    ON orchestration_v2_projection_threads WHEN NEW.deleted_at IS NOT NULL
    BEGIN DELETE FROM tixim_workflow_waits WHERE thread_id = NEW.thread_id; END`;
});
