// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite middleware runs in Node before the Effect runtime.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite middleware runs in Node before the Effect runtime.
import * as NodeFSP from "node:fs/promises";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite middleware runs in Node before the Effect runtime.
import * as NodePath from "node:path";
import type { Plugin } from "vite-plus";

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

export function tixFlowDevPlugin(): Plugin {
  return {
    name: "tix-flow-dev",
    apply: "serve",
    configureServer(server) {
      const root = process.env.T3CODE_TIX_FLOW_DIR;
      server.middlewares.use("/tix-flow", (req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        let pathname: string;
        try {
          pathname = decodeURIComponent((req.url ?? "/").split(/[?#]/, 1)[0] ?? "/");
        } catch {
          res.statusCode = 400;
          res.end();
          return;
        }
        if (
          pathname.includes("\0") ||
          pathname.includes("\\") ||
          pathname.split("/").includes("..")
        ) {
          res.statusCode = 400;
          res.end();
          return;
        }
        if (!root || (req.method !== "GET" && req.method !== "HEAD")) {
          next();
          return;
        }
        const base = NodePath.resolve(root);
        const file = NodePath.resolve(
          base,
          NodePath.extname(pathname) ? `.${pathname}` : "index.html",
        );
        const withinRoot = NodePath.relative(base, file);
        if (
          withinRoot === ".." ||
          withinRoot.startsWith(`..${NodePath.sep}`) ||
          NodePath.isAbsolute(withinRoot)
        ) {
          res.statusCode = 400;
          res.end();
          return;
        }
        void NodeFSP.stat(file)
          .then((info) => {
            if (!info.isFile()) {
              next();
              return;
            }
            res.setHeader(
              "Content-Type",
              mimeTypes[NodePath.extname(file).toLowerCase()] ?? "application/octet-stream",
            );
            res.setHeader("Content-Length", info.size);
            res.setHeader("Cache-Control", "no-cache");
            if (req.method === "HEAD") {
              res.end();
            } else {
              NodeFS.createReadStream(file).on("error", next).pipe(res);
            }
          })
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT" || error.code === "ENOTDIR") next();
            else next(error);
          });
      });
    },
  };
}
