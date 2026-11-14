import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // NULL last_state records the first observation silently, so upgrades cannot wake old threads.
  yield* sql`ALTER TABLE tixim_workflow_links ADD COLUMN last_state TEXT`;
  yield* sql`ALTER TABLE tixim_workflow_links ADD COLUMN attention_seen INTEGER NOT NULL DEFAULT 0`;
  yield* sql`UPDATE tixim_workflow_links SET relationship = 'untracked', payload_json = json_set(payload_json, '$.relationship', 'untracked')
    WHERE source = 'manual' AND relationship = 'tracking'`;
  yield* sql`CREATE TABLE tixim_workflow_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, daemon_id TEXT NOT NULL,
    run_id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL, wake_id TEXT
  )`;
  yield* sql`CREATE INDEX tixim_workflow_notifications_thread ON tixim_workflow_notifications (thread_id, id)`;
  yield* sql`CREATE TRIGGER tixim_workflow_notifications_thread_deleted AFTER UPDATE OF deleted_at
    ON orchestration_v2_projection_threads WHEN NEW.deleted_at IS NOT NULL
    BEGIN DELETE FROM tixim_workflow_notifications WHERE thread_id = NEW.thread_id; END`;
});
