import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProjectId,
  type Project,
  type RepositoryIdentity,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { ProcessRunner, ProjectService, ServerSettings } from "../../src/plugins/host.ts";
import Migration from "./migrations/006_TiximProjectLinks.ts";
import { importProject, link, listLinks, sync, unlink } from "./TiximProjects.ts";

it.effect("persists one link per T3 checkout and distinguishes Tixim targets", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* Migration;
    yield* sql`INSERT INTO tixim_project_links
      (project_id, connection_id, daemon_url, tixim_project_id, tixim_project_name, primary_path, updated_at)
      VALUES ('checkout-a', 'connection', 'daemon-a', 'project', 'Example', '/repo', 'now'),
             ('checkout-b', 'connection', 'daemon-a', 'project', 'Example', '/repo', 'now'),
             ('checkout-c', 'connection', 'daemon-b', 'project', 'Other', '/other', 'now')`;
    const result = yield* listLinks();
    expect(result.links).toHaveLength(3);
    expect(
      result.links.filter((link) => link.daemonUrl === "daemon-a").map((link) => link.projectId),
    ).toEqual(["checkout-a", "checkout-b"]);
    expect(result.links[0]?.lastError).toBeNull();
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("imports attached directories into one linked Tixim group", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      const primary = `${root}/primary`;
      const attached = `${root}/attached`;
      const later = `${root}/later`;
      const newCheckout = `${root}/new-checkout`;
      yield* fs.makeDirectory(primary);
      yield* fs.makeDirectory(attached);
      yield* fs.makeDirectory(later);
      yield* fs.makeDirectory(newCheckout);
      const directories = [
        { path: primary, branch: null, is_primary: true, source: "explicit" },
        { path: attached, branch: null, is_primary: false, source: "explicit" },
      ];
      const commands: string[][] = [];
      let unavailable = false;
      let projectVisible = true;
      let nameConflict = false;
      const records = new Map<string, Project>();
      const projectService = Layer.mock(ProjectService.ProjectService)({
        getByWorkspaceRoot: (path) => Effect.succeed(Option.fromNullishOr(records.get(path))),
        getById: (id) =>
          Effect.succeed(
            Option.fromNullishOr([...records.values()].find((value) => value.id === id)),
          ),
        snapshot: Effect.sync(() => ({
          projects: [...records.values()].filter((project) => project.deletedAt === null),
          updatedAt: "2026-01-01T00:00:00Z",
        })),
        bootstrap: (input) =>
          Effect.sync(() => {
            const project = {
              id: input.projectId,
              title: input.title,
              workspaceRoot: input.workspaceRoot,
              repositoryIdentity: null,
              defaultModelSelection: null,
              scripts: [],
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
              deletedAt: null,
            } as Project;
            records.set(project.workspaceRoot, project);
            return { project, created: true };
          }),
        update: (input) =>
          Effect.sync(() => {
            const old = [...records.values()].find((project) => project.id === input.projectId)!;
            const project = { ...old, title: input.title ?? old.title };
            records.set(project.workspaceRoot, project);
            return project;
          }),
      });
      const runner = Layer.succeed(ProcessRunner.ProcessRunner, {
        run: Effect.fn((input: ProcessRunner.ProcessRunInput) =>
          Effect.sync(() => {
            commands.push([...input.args]);
            if (unavailable && input.args.includes("list") && input.args.includes("project"))
              return {
                stdout: "",
                stderr: "Tixim daemon is disconnected",
                code: 1 as never,
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                stdoutInvalidUtf8: false,
                stderrInvalidUtf8: false,
              };
            if (nameConflict && input.args.includes("create") && input.args.includes("project"))
              return {
                stdout: "",
                stderr: "Project name Example already exists",
                code: 1 as never,
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                stdoutInvalidUtf8: false,
                stderrInvalidUtf8: false,
              };
            if (input.args.includes("rm-dir")) {
              const path = input.args.at(-1);
              const index = directories.findIndex((dir) => dir.path === path);
              if (index >= 0) directories.splice(index, 1);
            }
            if (input.args.includes("add-dir")) {
              const path = input.args.at(-1)!;
              if (!directories.some((dir) => dir.path === path))
                directories.push({
                  path,
                  branch: null,
                  is_primary: false,
                  source: "explicit",
                });
            }
            return {
              stdout: input.args.includes("context")
                ? '[{"name":"test","url":"http://daemon","current":"*"}]'
                : JSON.stringify(
                    projectVisible
                      ? [
                          {
                            project_id: "tix-project",
                            name: "Example",
                            directory: primary,
                            workspace_id: "ws-default",
                            directories,
                          },
                        ]
                      : [],
                  ),
              stderr: "",
              code: 0 as never,
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            };
          }),
        ),
      });
      const layer = Layer.mergeAll(
        NodeSqliteClient.layer({ filename: ":memory:" }),
        NodeServices.layer,
        NodeCrypto.layer,
        projectService,
        runner,
        ServerSettings.layerTest({
          providerInstances: {
            [ProviderInstanceId.make("connection")]: {
              driver: ProviderDriverKind.make("tixim"),
              config: { context: "test" },
            },
          },
        }),
        Layer.succeed(HostProcess.Environment, {}),
      );
      yield* Effect.gen(function* () {
        yield* Migration;
        const result = yield* importProject({
          connectionId: "connection",
          tiximProjectId: "tix-project",
        });
        expect(result.links).toHaveLength(2);
        expect(new Set(result.links.map((link) => link.tiximProjectId))).toEqual(
          new Set(["tix-project"]),
        );
        expect([...records.values()].map((project) => project.title)).toEqual([
          "Example",
          "Example",
        ]);
        unavailable = true;
        const failedSync = yield* Effect.result(sync("connection"));
        expect(failedSync._tag).toBe("Failure");
        expect(
          (yield* listLinks()).links.every((row) => row.lastError?.includes("disconnected")),
        ).toBe(true);
        unavailable = false;
        const recovered = yield* sync("connection");
        expect(recovered.links).toHaveLength(2);
        expect(recovered.links.every((row) => row.lastError === null)).toBe(true);
        directories.push({ path: later, branch: null, is_primary: false, source: "explicit" });
        const afterTiximAdd = yield* sync("connection");
        expect(afterTiximAdd.links).toHaveLength(3);
        expect(records.has(later)).toBe(true);
        records.set(attached, { ...records.get(attached)!, deletedAt: "2026-01-02T00:00:00Z" });
        const afterT3Remove = yield* sync("connection");
        expect(afterT3Remove.links).toHaveLength(2);
        expect(commands.some((args) => args.includes("rm-dir") && args.includes(attached))).toBe(
          true,
        );
        const sameRepo = (rootPath: string): RepositoryIdentity => ({
          canonicalKey: "example.test/shared",
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://example.test/shared.git",
          },
          rootPath,
        });
        records.set(primary, { ...records.get(primary)!, repositoryIdentity: sameRepo(primary) });
        records.set(later, { ...records.get(later)!, repositoryIdentity: sameRepo(later) });
        directories.splice(
          directories.findIndex((dir) => dir.path === later),
          1,
        );
        const afterTiximRemove = yield* sync("connection");
        expect(afterTiximRemove.links).toHaveLength(1);
        const addCount = commands.filter((args) => args.includes("add-dir")).length;
        expect((yield* sync("connection")).links).toHaveLength(1);
        expect(commands.filter((args) => args.includes("add-dir"))).toHaveLength(addCount);
        directories.push({
          path: `${primary}/.`,
          branch: null,
          is_primary: false,
          source: "explicit",
        });
        const duplicate = yield* Effect.result(
          importProject({ connectionId: "connection", tiximProjectId: "tix-project" }),
        );
        expect(duplicate._tag).toBe("Failure");
        directories.pop();
        const commandCount = commands.length;
        const unlinked = yield* unlink({ projectId: afterTiximRemove.links[0]!.projectId });
        expect(unlinked.links).toHaveLength(0);
        expect(commands).toHaveLength(commandCount);
        expect((yield* sync("connection")).links).toHaveLength(0);
        records.set(attached, {
          ...records.get(attached)!,
          deletedAt: null,
          repositoryIdentity: {
            ...sameRepo(attached),
            canonicalKey: "example.test/other",
          },
        });
        const existing = yield* link({
          connectionId: "connection",
          projectIds: [records.get(primary)!.id, records.get(attached)!.id],
          tiximProjectId: "tix-project",
        });
        expect(existing.links).toHaveLength(2);
        expect(directories.some((dir) => dir.path === attached)).toBe(true);
        records.set(newCheckout, {
          ...records.get(primary)!,
          id: ProjectId.make("new-checkout"),
          workspaceRoot: newCheckout,
          repositoryIdentity: sameRepo(newCheckout),
        });
        expect((yield* sync("connection")).links).toHaveLength(3);
        expect(directories.some((dir) => dir.path === newCheckout)).toBe(true);
        records.set(newCheckout, {
          ...records.get(newCheckout)!,
          deletedAt: "2026-01-03T00:00:00Z",
        });
        expect((yield* sync("connection")).links).toHaveLength(2);
        expect(directories.some((dir) => dir.path === newCheckout)).toBe(false);
        projectVisible = false;
        expect((yield* sync("connection")).links).toHaveLength(0);
        expect(records.has(primary)).toBe(true);
        expect(records.has(attached)).toBe(true);
        projectVisible = true;
        records.set(primary, { ...records.get(primary)!, title: "Local title" });
        expect(
          (yield* importProject({ connectionId: "connection", tiximProjectId: "tix-project" }))
            .links,
        ).toHaveLength(2);
        expect(records.get(primary)?.title).toBe("Example");
        records.set(primary, { ...records.get(primary)!, title: "Renamed locally" });
        yield* sync("connection");
        expect(records.get(primary)?.title).toBe("Renamed locally");
        records.set(newCheckout, {
          ...records.get(primary)!,
          id: ProjectId.make("conflicting-checkout"),
          title: "Example",
          workspaceRoot: newCheckout,
          repositoryIdentity: null,
          deletedAt: null,
        });
        nameConflict = true;
        const conflict = yield* Effect.result(
          link({
            connectionId: "connection",
            projectIds: [records.get(newCheckout)!.id],
            create: true,
          }),
        );
        expect(conflict._tag).toBe("Failure");
        if (conflict._tag === "Failure")
          expect(String(conflict.failure)).toContain("already exists");
        expect((yield* listLinks()).links).toHaveLength(2);
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);
