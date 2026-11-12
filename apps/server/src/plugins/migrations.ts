import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";
import { mergeMigrations } from "./registry.ts";

const CORE_TABLE = "effect_sql_migrations";

/** A plugin's migrations, numbered from 1 in the plugin's own history table so core ids stay free. */
export interface PluginMigrationTrack {
  readonly table: string;
  readonly migrations: ReadonlyArray<
    readonly [number, string, Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>]
  >;
}

export function definePluginMigrationTracks(
  ...tracks: ReadonlyArray<PluginMigrationTrack>
): ReadonlyArray<PluginMigrationTrack> {
  const tables = new Set<string>([CORE_TABLE]);
  const names = new Set<string>();
  for (const track of tracks) {
    if (!/^\w+$/.test(track.table) || tables.has(track.table)) {
      throw new Error(`Conflicting plugin migration table: ${track.table}`);
    }
    tables.add(track.table);
    mergeMigrations(track.migrations);
    // Legacy core rows are adopted by name, so names must be unique across tracks and core.
    for (const [id, name] of track.migrations) {
      if (names.has(name)) throw new Error(`Conflicting plugin migration: ${id}_${name}`);
      names.add(name);
    }
  }
  return tracks;
}

/** Core-history names that startup moves into a plugin table instead of treating as core ids. */
export const legacyPluginMigrationNames = (tracks: ReadonlyArray<PluginMigrationTrack>) =>
  new Set(tracks.flatMap((track) => track.migrations.map(([, name]) => name)));

const tableExists = (sql: SqlClient.SqlClient, table: string) =>
  Effect.map(
    sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${table}`,
    (rows) => rows.length > 0,
  );

const latestRecordedId = (sql: SqlClient.SqlClient, table: string) =>
  Effect.map(
    sql<{
      readonly latestId: number | null;
    }>`SELECT MAX(migration_id) AS latestId FROM ${sql(table)}`,
    (rows) => rows[0]?.latestId ?? 0,
  );

/**
 * Builds before plugin tables recorded plugin migrations in the core history, at ids core now
 * uses. The Migrator skips every id up to the highest recorded, so move those rows into their
 * plugin's table, keeping when they ran, before the core migrator reads its history.
 */
export const adoptLegacyPluginMigrations = Effect.fn("adoptLegacyPluginMigrations")(function* (
  tracks: ReadonlyArray<PluginMigrationTrack>,
) {
  const sql = yield* SqlClient.SqlClient;
  if (!(yield* tableExists(sql, CORE_TABLE))) return;
  const recorded = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
    readonly created_at: string;
  }>`SELECT migration_id, name, created_at FROM ${sql(CORE_TABLE)}`;
  for (const track of tracks) {
    const ids = new Map(track.migrations.map(([id, name]) => [name, id]));
    const legacy = recorded.filter((row) => ids.has(row.name));
    if (legacy.length === 0) continue;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`CREATE TABLE IF NOT EXISTS ${sql(track.table)} (
          migration_id integer PRIMARY KEY NOT NULL,
          created_at datetime NOT NULL DEFAULT current_timestamp,
          name VARCHAR(255) NOT NULL
        )`;
        for (const row of legacy) {
          yield* sql`INSERT OR IGNORE INTO ${sql(track.table)} (migration_id, created_at, name)
            VALUES (${ids.get(row.name)!}, ${row.created_at}, ${row.name})`;
          yield* sql`DELETE FROM ${sql(CORE_TABLE)}
            WHERE migration_id = ${row.migration_id} AND name = ${row.name}`;
        }
      }),
    );
    yield* Effect.log("Moved plugin migration history out of the core table").pipe(
      Effect.annotateLogs({
        table: track.table,
        migrations: legacy.map((row) => `${row.migration_id}_${row.name}`),
      }),
    );
  }
});

export const hasPendingPluginMigrations = Effect.fn("hasPendingPluginMigrations")(function* (
  tracks: ReadonlyArray<PluginMigrationTrack>,
) {
  const sql = yield* SqlClient.SqlClient;
  const legacyNames = [...legacyPluginMigrationNames(tracks)];
  if (
    legacyNames.length > 0 &&
    (yield* tableExists(sql, CORE_TABLE)) &&
    (yield* sql`SELECT 1 FROM ${sql(CORE_TABLE)} WHERE ${sql.in("name", legacyNames)} LIMIT 1`)
      .length > 0
  ) {
    return true;
  }
  for (const track of tracks) {
    const latest = Math.max(0, ...track.migrations.map(([id]) => id));
    if (latest === 0) continue;
    if (!(yield* tableExists(sql, track.table))) return true;
    if ((yield* latestRecordedId(sql, track.table)) < latest) return true;
  }
  return false;
});

const run = Migrator.make({});

/** Runs after core migrations, since plugin tables may reference core tables. */
export const runPluginMigrations = Effect.fn("runPluginMigrations")(function* (
  tracks: ReadonlyArray<PluginMigrationTrack>,
) {
  const executed: string[] = [];
  for (const track of tracks) {
    const ran = yield* run({
      table: track.table,
      loader: Migrator.fromRecord(
        Object.fromEntries(
          track.migrations.map(([id, name, migration]) => [`${id}_${name}`, migration]),
        ),
      ),
    });
    executed.push(...ran.map(([id, name]) => `${track.table}:${id}_${name}`));
  }
  return executed;
});
