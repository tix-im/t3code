import * as FileSystem from "effect/FileSystem";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import {
  CommandId,
  ProjectId,
  TiximCommandError,
  TiximProject,
  repositoryGroupingKeyOf,
  type TiximProjectLinkInput,
  type TiximProjectImportInput,
  type TiximProjectUnlinkInput,
} from "@t3tools/contracts";
import { resolveTiximCommand } from "@t3tools/plugin-tixim-provider/server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Schedule from "effect/Schedule";
import { ProcessRunner, ProjectService, forkParked } from "../../src/plugins/host.ts";
import { connection } from "./TiximWorkflows.ts";

type LinkRow = {
  projectId: string;
  connectionId: string;
  daemonUrl: string;
  tiximProjectId: string;
  tiximProjectName: string;
  primaryPath: string;
  lastError: string | null;
};
const failure = (message: string) => new TiximCommandError({ message });
const decodeContextRows = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        url: Schema.optional(Schema.String),
        current: Schema.optional(Schema.String),
      }),
    ),
  ),
);
const decodeProjectList = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(TiximProject)));
const decodeProject = Schema.decodeEffect(Schema.fromJsonString(TiximProject));

const run = Effect.fn("TiximProjects.run")(function* (
  connectionId: string,
  args: readonly string[],
) {
  const selected = yield* connection(connectionId);
  const runner = yield* ProcessRunner.ProcessRunner;
  const output = yield* runner.run({
    command: resolveTiximCommand(selected.environment),
    args: [
      ...(selected.context ? ["--context", selected.context] : []),
      "-o",
      "json",
      "project",
      ...args,
    ],
    env: { ...selected.environment, TIX_WAIT_FOR_DAEMON: "0" },
    timeout: "20 seconds",
    maxOutputBytes: 8 * 1024 * 1024,
  });
  if (output.code !== 0) {
    const detail = output.stderr.trim().split("\n").at(-1) ?? "unknown error";
    return yield* failure(`Tixim project ${args[0]} failed: ${detail}`);
  }
  return output.stdout;
});

const canonical = Effect.fn(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .realPath(path)
    .pipe(Effect.mapError(() => failure(`Checkout does not exist: ${path}`)));
});
const canonicalKnown = Effect.fn(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.realPath(path).pipe(Effect.orElseSucceed(() => path));
});

const url = Effect.fn(function* (connectionId: string) {
  const selected = yield* connection(connectionId);
  const environment = selected.environment;
  const direct = environment.TIXIM_URL?.trim() || environment.TIX_DAEMON_URL?.trim();
  if (direct) return direct;
  const runner = yield* ProcessRunner.ProcessRunner;
  const output = yield* runner.run({
    command: resolveTiximCommand(environment),
    args: ["-o", "json", "context", "list"],
    env: { ...environment, TIX_WAIT_FOR_DAEMON: "0" },
    timeout: "20 seconds",
  });
  if (output.code !== 0) return yield* failure("Could not identify the Tixim daemon.");
  const rows = yield* decodeContextRows(output.stdout).pipe(
    Effect.mapError(() => failure("Invalid Tixim context list.")),
  );
  const context = rows.find(
    (row) => row.name === selected.context || (!selected.context && row.current === "*"),
  );
  if (!context?.url) return yield* failure("The selected Tixim connection has no daemon URL.");
  return context.url;
});

const projectList = Effect.fn(function* (connectionId: string) {
  const raw = yield* run(connectionId, ["list"]);
  return yield* decodeProjectList(raw).pipe(
    Effect.mapError(() => failure("Tixim returned an invalid project list.")),
  );
});

const links = Effect.fn(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<LinkRow>`SELECT project_id AS projectId, connection_id AS connectionId,
    daemon_url AS daemonUrl, tixim_project_id AS tiximProjectId,
    tixim_project_name AS tiximProjectName, primary_path AS primaryPath,
    last_error AS lastError FROM tixim_project_links`;
});
export const listLinks = Effect.fn("TiximProjects.listLinks")(function* () {
  return { links: yield* links() };
});

const save = Effect.fn(function* (
  projectId: string,
  connectionId: string,
  daemonUrl: string,
  project: typeof TiximProject.Type,
) {
  const sql = yield* SqlClient.SqlClient;
  const now = DateTime.formatIso(yield* DateTime.now);
  yield* sql`INSERT INTO tixim_project_links
    (project_id, connection_id, daemon_url, tixim_project_id, tixim_project_name, primary_path, last_error, updated_at)
    VALUES (${projectId}, ${connectionId}, ${daemonUrl}, ${project.project_id}, ${project.name}, ${project.directory}, NULL, ${now})
    ON CONFLICT(project_id) DO UPDATE SET connection_id = excluded.connection_id,
    daemon_url = excluded.daemon_url, tixim_project_id = excluded.tixim_project_id,
    tixim_project_name = excluded.tixim_project_name, primary_path = excluded.primary_path,
    last_error = NULL, updated_at = excluded.updated_at`;
});

export const list = Effect.fn("TiximProjects.list")(function* (connectionId: string) {
  const daemonUrl = yield* url(connectionId);
  const projects = yield* projectList(connectionId);
  const allLinks = yield* links();
  return { projects, links: allLinks, daemonUrl };
});

export const unlink = Effect.fn("TiximProjects.unlink")(function* (input: TiximProjectUnlinkInput) {
  const sql = yield* SqlClient.SqlClient;
  const existing = (yield* links()).find((row) => row.projectId === input.projectId);
  if (!existing) return yield* failure("Project is not linked to Tixim.");
  yield* sql`DELETE FROM tixim_project_links WHERE project_id = ${input.projectId}`;
  return { projects: [], links: yield* links(), daemonUrl: existing.daemonUrl };
});

export const link = Effect.fn("TiximProjects.link")(function* (input: TiximProjectLinkInput) {
  const service = yield* ProjectService.ProjectService;
  const current = yield* list(input.connectionId);
  const uniqueIds = [...new Set(input.projectIds)];
  if (uniqueIds.length === 0) return yield* failure("Select at least one T3 checkout.");
  const selected = yield* Effect.forEach(uniqueIds, (id) => service.getById(ProjectId.make(id)));
  if (selected.some(Option.isNone))
    return yield* failure("A selected T3 checkout no longer exists.");
  const checkouts = selected.map((value) => Option.getOrThrow(value));
  const paths = yield* Effect.forEach(checkouts, (project) => canonical(project.workspaceRoot));
  if (new Set(paths).size !== paths.length)
    return yield* failure("The selected checkouts contain duplicate paths.");
  const existingLinks = current.links.filter((row) => uniqueIds.includes(row.projectId));
  if (existingLinks.length)
    return yield* failure("One of these checkouts is already linked to Tixim.");
  let target = current.projects.find((project) => project.project_id === input.tiximProjectId);
  if (input.create) {
    if (input.tiximProjectId)
      return yield* failure("Choose either create or an existing Tixim project.");
    const raw = yield* run(input.connectionId, [
      "create",
      checkouts[0]!.title,
      "--directory",
      paths[0]!,
      ...paths.slice(1).flatMap((path) => ["--add-directory", path]),
    ]);
    target = yield* decodeProject(raw).pipe(
      Effect.mapError(() =>
        failure("Tixim created a project but returned invalid details. Refresh before retrying."),
      ),
    );
  }
  if (!target) return yield* failure("Tixim project was not found on this connection.");
  const targetPaths = new Set(
    yield* Effect.forEach(target.directories, (dir) => canonicalKnown(dir.path)),
  );
  const foreignPaths = yield* Effect.forEach(
    current.projects
      .filter((project) => project.project_id !== target!.project_id)
      .flatMap((project) => project.directories.map((dir) => dir.path)),
    canonicalKnown,
  );
  if (paths.some((path) => foreignPaths.includes(path)))
    return yield* failure("A checkout belongs to another Tixim project.");
  for (const path of paths) {
    if (!targetPaths.has(path)) {
      yield* run(input.connectionId, ["add-dir", target.project_id, path]);
      targetPaths.add(path);
    }
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM tixim_project_exclusions WHERE daemon_url = ${current.daemonUrl}
      AND tixim_project_id = ${target.project_id} AND path = ${path}`;
  }
  for (const project of checkouts)
    yield* save(project.id, input.connectionId, current.daemonUrl, target);
  return yield* importProject({
    connectionId: input.connectionId,
    tiximProjectId: target.project_id,
  });
});

export const importProject = Effect.fn("TiximProjects.import")(function* (
  input: TiximProjectImportInput,
) {
  const service = yield* ProjectService.ProjectService;
  const random = yield* SecureRandom.SecureRandom;
  const current = yield* list(input.connectionId);
  const target = current.projects.find((project) => project.project_id === input.tiximProjectId);
  if (!target) return yield* failure("Tixim project was not found on this connection.");
  const paths = yield* Effect.forEach(target.directories, (dir) => canonical(dir.path));
  if (new Set(paths).size !== paths.length)
    return yield* failure("Tixim has duplicate checkout paths for this project.");
  for (const path of paths) {
    const existing = yield* service.getByWorkspaceRoot(path);
    const linked = Option.isSome(existing)
      ? current.links.find((row) => row.projectId === existing.value.id)
      : undefined;
    if (
      linked &&
      (linked.daemonUrl !== current.daemonUrl || linked.tiximProjectId !== target.project_id)
    )
      return yield* failure(`Checkout ${path} is linked to another Tixim project.`);
  }
  for (const path of paths) {
    const existing = yield* service.getByWorkspaceRoot(path);
    if (
      Option.isSome(existing) &&
      !current.links.some((row) => row.projectId === existing.value.id) &&
      existing.value.title !== target.name
    ) {
      yield* service.update({
        commandId: CommandId.make(yield* random.uuidV4()),
        projectId: existing.value.id,
        title: target.name,
      });
    }
    const project = Option.isSome(existing)
      ? existing.value
      : (yield* service.bootstrap({
          commandId: CommandId.make(yield* random.uuidV4()),
          projectId: ProjectId.make(yield* random.uuidV4()),
          title: target.name,
          workspaceRoot: path,
        })).project;
    yield* save(project.id, input.connectionId, current.daemonUrl, target);
  }
  return yield* sync(input.connectionId);
});

/** Reconcile only explicit links. A missing counterpart never creates a new link. */
const reconcile = Effect.fn("TiximProjects.reconcile")(function* (connectionId: string) {
  const sql = yield* SqlClient.SqlClient;
  const service = yield* ProjectService.ProjectService;
  const random = yield* SecureRandom.SecureRandom;
  const current = yield* list(connectionId);
  const activeLinks = current.links.filter(
    (row) => row.connectionId === connectionId && row.daemonUrl === current.daemonUrl,
  );
  const projectIds = [...new Set(activeLinks.map((row) => row.tiximProjectId))];
  const allProjects = (yield* service.snapshot).projects;
  for (const id of projectIds) {
    const target = current.projects.find((project) => project.project_id === id);
    const members = activeLinks.filter((row) => row.tiximProjectId === id);
    if (!target) {
      yield* sql`DELETE FROM tixim_project_links WHERE connection_id = ${connectionId} AND daemon_url = ${current.daemonUrl} AND tixim_project_id = ${id}`;
      continue;
    }
    const primaryPath = yield* canonicalKnown(target.directory);
    const primaryPaths = yield* Effect.forEach(
      allProjects.filter((project) => members.some((row) => row.projectId === project.id)),
      (project) => canonicalKnown(project.workspaceRoot),
    );
    if (!primaryPaths.includes(primaryPath)) {
      // T3's primary checkout was removed. Keep the Tixim project and stop syncing it.
      yield* sql`DELETE FROM tixim_project_links WHERE connection_id = ${connectionId} AND daemon_url = ${current.daemonUrl} AND tixim_project_id = ${id}`;
      continue;
    }
    const targetPaths = new Set(
      yield* Effect.forEach(target.directories, (dir) => canonicalKnown(dir.path)),
    );
    const exclusions = yield* sql<{ path: string }>`SELECT path FROM tixim_project_exclusions
      WHERE daemon_url = ${current.daemonUrl} AND tixim_project_id = ${id}`;
    const excludedPaths = new Set(exclusions.map((row) => row.path));
    const removedByTix = new Set<string>();
    for (const member of members) {
      const old = yield* service.getById(ProjectId.make(member.projectId), {
        includeDeleted: true,
      });
      if (Option.isNone(old) || old.value.deletedAt === null) continue;
      if (old.value.workspaceRoot !== target.directory) {
        yield* run(connectionId, ["rm-dir", id, old.value.workspaceRoot]);
        targetPaths.delete(old.value.workspaceRoot);
      }
      yield* sql`DELETE FROM tixim_project_links WHERE project_id = ${member.projectId}`;
    }
    const memberProjects = allProjects.filter((project) =>
      members.some((row) => row.projectId === project.id),
    );
    for (const project of memberProjects) {
      const path = yield* canonicalKnown(project.workspaceRoot);
      if (!targetPaths.has(path)) {
        removedByTix.add(path);
        yield* sql`INSERT OR IGNORE INTO tixim_project_exclusions
          (daemon_url, tixim_project_id, path) VALUES (${current.daemonUrl}, ${id}, ${path})`;
        yield* sql`DELETE FROM tixim_project_links WHERE project_id = ${project.id}`;
      }
    }
    const repoKeys = new Set(
      memberProjects.flatMap((project) =>
        project.repositoryIdentity ? [repositoryGroupingKeyOf(project.repositoryIdentity)] : [],
      ),
    );
    const candidates = allProjects.filter(
      (project) =>
        project.deletedAt === null &&
        !members.some((row) => row.projectId === project.id) &&
        project.repositoryIdentity &&
        repoKeys.has(repositoryGroupingKeyOf(project.repositoryIdentity)),
    );
    for (const project of candidates) {
      if (current.links.some((row) => row.projectId === project.id)) continue;
      const path = yield* canonical(project.workspaceRoot);
      if (removedByTix.has(path) || excludedPaths.has(path)) continue;
      if (!targetPaths.has(path)) {
        yield* run(connectionId, ["add-dir", id, path]);
        targetPaths.add(path);
      }
      yield* save(project.id, connectionId, current.daemonUrl, target);
    }
    for (const dir of target.directories) {
      const path = yield* canonicalKnown(dir.path);
      if (!targetPaths.has(path)) continue;
      const already = yield* service.getByWorkspaceRoot(path);
      if (Option.isSome(already)) {
        const foreign = current.links.find(
          (row) =>
            row.projectId === already.value.id &&
            (row.daemonUrl !== current.daemonUrl || row.tiximProjectId !== id),
        );
        if (foreign) return yield* failure(`Checkout ${path} is linked to another Tixim project.`);
        if (!current.links.some((row) => row.projectId === already.value.id))
          yield* save(already.value.id, connectionId, current.daemonUrl, target);
        continue;
      }
      const created = yield* service.bootstrap({
        commandId: CommandId.make(yield* random.uuidV4()),
        projectId: ProjectId.make(yield* random.uuidV4()),
        title: target.name,
        workspaceRoot: path,
      });
      yield* save(created.project.id, connectionId, current.daemonUrl, target);
    }
    yield* sql`UPDATE tixim_project_links SET last_error = NULL WHERE connection_id = ${connectionId} AND daemon_url = ${current.daemonUrl} AND tixim_project_id = ${id}`;
  }
  return yield* list(connectionId);
});

export const sync = Effect.fn("TiximProjects.sync")(function* (connectionId: string) {
  const sql = yield* SqlClient.SqlClient;
  return yield* reconcile(connectionId).pipe(
    Effect.tapError(
      (error) =>
        sql`UPDATE tixim_project_links SET last_error = ${String(error)} WHERE connection_id = ${connectionId}`,
    ),
  );
});

export const start = Effect.fn("TiximProjects.start")(function* () {
  const sweep = Effect.gen(function* () {
    const connectionIds = [...new Set((yield* links()).map((row) => row.connectionId))];
    yield* Effect.forEach(connectionIds, (id) => sync(id).pipe(Effect.ignore), { concurrency: 2 });
  }).pipe(Effect.ignore);
  yield* forkParked(Effect.repeat(sweep, Schedule.spaced("1 minute")));
});
