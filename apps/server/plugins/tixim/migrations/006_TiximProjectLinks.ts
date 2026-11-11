import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE tixim_project_links (
    project_id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    daemon_url TEXT NOT NULL,
    tixim_project_id TEXT NOT NULL,
    tixim_project_name TEXT NOT NULL,
    primary_path TEXT NOT NULL,
    last_error TEXT,
    updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX tixim_project_links_target
    ON tixim_project_links(connection_id, daemon_url, tixim_project_id)`;
  yield* sql`CREATE TABLE tixim_project_exclusions (
    daemon_url TEXT NOT NULL,
    tixim_project_id TEXT NOT NULL,
    path TEXT NOT NULL,
    PRIMARY KEY (daemon_url, tixim_project_id, path)
  )`;
});
