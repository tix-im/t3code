import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Migrator from "effect/sql/Migrator";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import { runServicePreflight } from "../src/cloud/servicePreflight.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "../src/cloud/serviceProtocol.ts";
import {
  BUILD_MIGRATION_HEAD,
  databaseMigrationHead,
} from "../src/persistence/databaseMigrationHead.ts";
import {
  hasPendingMigrations,
  migrationManifest,
  runMigrations,
} from "../src/persistence/Migrations.ts";
import { definePluginMigrationTracks } from "../src/plugins/migrations.ts";
import { pluginMigrationTracks } from "./installed-migrations.ts";
import { migrationTrack } from "./tixim/migrations.ts";

// The last core id builds before plugin tables shipped; they recorded Tixim at 73-78.
const LEGACY_CORE_HEAD = 72;

const coreHistory = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

const tiximHistory = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    readonly migration_id: number;
    readonly name: string;
    readonly created_at: string;
  }>`
    SELECT migration_id, name, created_at FROM tixim_sql_migrations ORDER BY migration_id
  `;
});

const tiximManifest = migrationTrack.migrations.map(([id, name]) => [id, name] as const);

describe("plugin migrations", () => {
  it.effect("keeps plugin history in its own table on a new database", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      assert.deepStrictEqual(yield* coreHistory, migrationManifest);
      assert.deepStrictEqual(
        (yield* tiximHistory).map((row) => [row.migration_id, row.name] as const),
        tiximManifest,
      );
      assert.isFalse(yield* hasPendingMigrations());
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("adopts Tixim history recorded at core ids and runs the core migrations it hid", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const filename = path.join(yield* fs.makeTempDirectoryScoped(), "legacy.sqlite");
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: LEGACY_CORE_HEAD });
        for (const [index, [, name, migration]] of migrationTrack.migrations.entries()) {
          yield* migration;
          yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at)
            VALUES (${LEGACY_CORE_HEAD + 1 + index}, ${name}, '2026-01-02 03:04:05')`;
        }
        yield* sql`INSERT INTO tixim_workflow_links
          (thread_id, daemon_id, run_id, connection_id, source, payload_json)
          VALUES ('existing-thread', 'daemon', 'wf-existing-run-1234', 'connection', 'automatic', '{}')`;
        assert.isTrue(yield* hasPendingMigrations());
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));

      // Read before startup, so these see the history startup will have after adopting.
      assert.strictEqual(databaseMigrationHead(filename), BUILD_MIGRATION_HEAD);
      assert.strictEqual(
        runServicePreflight({ databasePath: filename, launcherProtocol: SERVICE_LAUNCHER_PROTOCOL })
          .status,
        "ready",
      );

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const ran = yield* runMigrations();
        assert.deepStrictEqual(
          ran,
          migrationManifest.filter(([id]) => id > LEGACY_CORE_HEAD),
        );
        assert.deepStrictEqual(yield* coreHistory, migrationManifest);
        const adopted = yield* tiximHistory;
        assert.deepStrictEqual(
          adopted.map((row) => [row.migration_id, row.name] as const),
          tiximManifest,
        );
        assert.isTrue(adopted.every((row) => row.created_at === "2026-01-02 03:04:05"));
        assert.deepStrictEqual(yield* sql`SELECT thread_id FROM tixim_workflow_links`, [
          { thread_id: "existing-thread" },
        ]);
        assert.isFalse(yield* hasPendingMigrations());
        assert.deepStrictEqual(yield* runMigrations(), []);
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("upgrades and reopens plugin data without replaying plugin migrations", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const filename = path.join(yield* fs.makeTempDirectoryScoped(), "plugin-upgrade.sqlite");
      const [first] = migrationTrack.migrations;
      yield* Effect.gen(function* () {
        yield* runMigrations({ toMigrationInclusive: LEGACY_CORE_HEAD });
        yield* Migrator.make({})({
          table: migrationTrack.table,
          loader: Migrator.fromRecord({ [`${first[0]}_${first[1]}`]: first[2] }),
        });
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO tixim_workflow_links
          (thread_id, daemon_id, run_id, connection_id, source, payload_json)
          VALUES ('existing-thread', 'daemon', 'wf-existing-run-1234', 'connection', 'automatic', '{}')`;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
      yield* Effect.gen(function* () {
        yield* runMigrations();
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(
          yield* sql`SELECT relationship, json_extract(payload_json, '$.relationship') AS payload_relationship FROM tixim_workflow_links`,
          [{ relationship: "owner", payload_relationship: "owner" }],
        );
        yield* sql`INSERT INTO tixim_workflow_waits (thread_id, wait_id, targets_json, timeout_ms, progress_json)
          VALUES ('existing-thread', 'durable-wait', '[]', 60000, '[]')`;
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
      yield* Effect.gen(function* () {
        assert.deepStrictEqual(yield* runMigrations(), []);
        const sql = yield* SqlClient.SqlClient;
        assert.deepStrictEqual(yield* sql`SELECT wait_id, timeout_ms FROM tixim_workflow_waits`, [
          { wait_id: "durable-wait", timeout_ms: 60000 },
        ]);
        assert.deepStrictEqual(
          (yield* tiximHistory).map((row) => [row.migration_id, row.name] as const),
          tiximManifest,
        );
      }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it("rejects plugin tracks that share a table or a migration name", () => {
    const track = { table: "a_sql_migrations", migrations: [[1, "A", Effect.void]] } as const;
    assert.throws(
      () => definePluginMigrationTracks(track, { ...track, migrations: [] }),
      "Conflicting plugin migration table",
    );
    assert.throws(
      () =>
        definePluginMigrationTracks(track, {
          table: "b_sql_migrations",
          migrations: [[1, "A", Effect.void]],
        }),
      "Conflicting plugin migration: 1_A",
    );
    assert.throws(
      () => definePluginMigrationTracks({ ...track, table: "effect_sql_migrations" }),
      "Conflicting plugin migration table",
    );
  });
});

it.effect("registers every plugin migration file", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = (yield* fs.readDirectory(path.join(import.meta.dirname, "tixim", "migrations")))
      .flatMap((name) => {
        const match = /^(\d+)_(\w+)\.ts$/.exec(name);
        return match ? [[Number(match[1]), match[2]] as const] : [];
      })
      .toSorted((a, b) => a[0] - b[0]);
    assert.deepStrictEqual(files, tiximManifest);
    assert.deepStrictEqual(
      pluginMigrationTracks.map((track) => track.table),
      [migrationTrack.table],
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
