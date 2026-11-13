// @effect-diagnostics-next-line nodeBuiltinImport:off -- This test exercises Node-only dev middleware.
import * as NodeFSP from "node:fs/promises";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- This test exercises Node-only dev middleware.
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- This test exercises Node-only dev middleware.
import * as NodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Connect, ViteDevServer } from "vite-plus";
import { tixFlowDevPlugin } from "./viteDevServer";

describe("tixFlowDevPlugin", () => {
  let directory: string;
  let originalRoot: string | undefined;

  beforeEach(async () => {
    originalRoot = process.env.T3CODE_TIX_FLOW_DIR;
    directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tix-flow-test-"));
    await NodeFSP.mkdir(NodePath.join(directory, "assets"));
    await NodeFSP.writeFile(NodePath.join(directory, "index.html"), "flow index");
    await NodeFSP.writeFile(NodePath.join(directory, "assets", "x.js"), "export default 42;");
    process.env.T3CODE_TIX_FLOW_DIR = directory;
  });

  afterEach(async () => {
    if (originalRoot === undefined) delete process.env.T3CODE_TIX_FLOW_DIR;
    else process.env.T3CODE_TIX_FLOW_DIR = originalRoot;
    await NodeFSP.rm(directory, { recursive: true, force: true });
  });

  async function withServer(
    run: (
      get: (
        path: string,
        method?: string,
      ) => Promise<{
        status: number | undefined;
        headers: NodeHttp.IncomingMessage["headers"];
        body: string;
      }>,
    ) => Promise<void>,
  ) {
    let handler: Connect.NextHandleFunction | undefined;
    const plugin = tixFlowDevPlugin();
    const configure = plugin.configureServer;
    if (typeof configure !== "function") throw new Error("Missing configureServer hook");
    configure.call(
      {} as ThisParameterType<typeof configure>,
      {
        middlewares: {
          use: (_route: string, middleware: Connect.NextHandleFunction) => {
            handler = middleware;
          },
        },
      } as unknown as ViteDevServer,
    );
    const server = NodeHttp.createServer((req, res) => {
      const url = req.url ?? "/";
      if (url === "/tix-flow" || /^\/tix-flow[/?#]/.test(url)) {
        req.url = url.slice("/tix-flow".length) || "/";
        handler?.(req, res, () => {
          res.statusCode = 404;
          res.end("fallback");
        });
      } else {
        res.statusCode = 404;
        res.end("fallback");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server address");
    try {
      await run(
        (path, method = "GET") =>
          new Promise((resolve, reject) => {
            const req = NodeHttp.request(
              { hostname: "127.0.0.1", port: address.port, path, method },
              (res) => {
                let body = "";
                res.setEncoding("utf8");
                res.on("data", (chunk: string) => {
                  body += chunk;
                });
                res.on("end", () =>
                  resolve({ status: res.statusCode, headers: res.headers, body }),
                );
              },
            );
            req.on("error", reject);
            req.end();
          }),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  }

  it("serves module assets, index routes and HEAD with scoped headers", async () => {
    await withServer(async (get) => {
      const asset = await get("/tix-flow/assets/x.js?version=1");
      expect(asset.status).toBe(200);
      expect(asset.body).toBe("export default 42;");
      expect(asset.headers["content-type"]).toMatch(/javascript/);
      expect(asset.headers["access-control-allow-origin"]).toBe("*");
      expect(asset.headers["cache-control"]).toBe("no-cache");
      expect(asset.headers["content-length"]).toBe(String(Buffer.byteLength(asset.body)));
      expect((await get("/tix-flow/")).body).toBe("flow index");
      expect((await get("/tix-flow/some/route")).body).toBe("flow index");
      const head = await get("/tix-flow/assets/x.js", "HEAD");
      expect(head.status).toBe(200);
      expect(head.body).toBe("");
      expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(asset.body)));
    });
  });

  it("rejects traversal, NUL and malformed encodings", async () => {
    await withServer(async (get) => {
      for (const path of [
        "/tix-flow/../secret",
        "/tix-flow/%2e%2e/secret",
        "/tix-flow/%2e%2e%2fsecret",
        "/tix-flow/a%00.js",
        "/tix-flow/%zz",
      ]) {
        const response = await get(path);
        expect(response.status).toBe(400);
        expect(response.headers["access-control-allow-origin"]).toBe("*");
      }
    });
  });

  it("falls through missing assets and leaves unrelated routes untouched", async () => {
    await withServer(async (get) => {
      const missing = await get("/tix-flow/missing.js");
      expect(missing.status).toBe(404);
      expect(missing.headers["access-control-allow-origin"]).toBe("*");
      for (const path of ["/", "/tix-flow-other/file.js"]) {
        expect((await get(path)).headers["access-control-allow-origin"]).toBeUndefined();
      }
    });
    delete process.env.T3CODE_TIX_FLOW_DIR;
    await withServer(async (get) => {
      const response = await get("/tix-flow/index.html");
      expect(response.status).toBe(404);
      expect(response.headers["access-control-allow-origin"]).toBe("*");
    });
  });
});
