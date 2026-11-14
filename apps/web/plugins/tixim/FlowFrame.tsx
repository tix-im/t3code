import { RegistryContext } from "@effect/atom-react";
import { type EnvironmentId, type ThreadId, WS_METHODS } from "@t3tools/contracts";
import { runStreamGuarded } from "@t3tools/client-runtime/rpc";
import {
  createPermissionAwareRuntimeCommand,
  runAtomCommand,
  runStreamInEnvironment,
} from "@t3tools/client-runtime/state/runtime";
import { htmlRenderThemeMessage } from "@t3tools/shared/htmlRender";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { useContext, useEffect, useRef, useState } from "react";
import { cn, connectionAtomRuntime, useHtmlRenderTheme } from "../../src/plugins/host";

const writeMethods = new Set([
  "CancelWorkflow",
  "SuspendWorkflowRun",
  "ResumeWorkflowRun",
  "FreezeWorkflowRun",
  "ThawWorkflowRun",
  "RestartWorkflowRun",
  "SetWorkflowTitle",
  "SetWorkflowMeta",
  "SubmitPendingApproval",
  "AnswerWorkflowInput",
  "TopUpRunBudget",
  "MutatePlannerDag",
  "SubmitWorkflow",
]);
const bridge = createPermissionAwareRuntimeCommand(connectionAtomRuntime, {
  label: "tix-flow transport",
  execute: (input: {
    environmentId: EnvironmentId;
    threadId: ThreadId | undefined;
    connectionId: string;
    daemonId: string;
    method: string;
    body: string;
    signal: AbortSignal;
    chunk: (value: string) => void;
  }) => {
    const tag = writeMethods.has(input.method.split("/")[1] ?? "")
      ? WS_METHODS.tiximFlowWrite
      : WS_METHODS.tiximFlowRead;
    const request = runStreamInEnvironment(
      input.environmentId,
      runStreamGuarded(tag, {
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        connectionId: input.connectionId,
        daemonId: input.daemonId,
        method: input.method,
        body: input.body,
      }),
    ).pipe(Stream.runForEach((value) => Effect.sync(() => input.chunk(value))));
    const cancelled = Effect.callback<void>((resume) => {
      const abort = () => resume(Effect.void);
      input.signal.addEventListener("abort", abort, { once: true });
      if (input.signal.aborted) abort();
      return Effect.sync(() => input.signal.removeEventListener("abort", abort));
    });
    return Effect.raceFirst(request, cancelled);
  },
});

function send(port: MessagePort | undefined, value: unknown) {
  port?.postMessage(value);
}
function encoded(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
function decoded(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

export function FlowFrame({
  environmentId,
  threadId,
  connectionId,
  daemonId,
  title,
  path,
}: {
  environmentId: EnvironmentId;
  threadId?: ThreadId;
  connectionId: string;
  daemonId: string;
  title: string;
  path: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const registry = useContext(RegistryContext);
  const theme = useHtmlRenderTheme();
  const [loads, setLoads] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Posts the theme to the sandboxed iframe on each load and change, kept apart from the effect below so a theme change does not abort its streams.
  useEffect(() => {
    if (loads > 0) frame.current?.contentWindow?.postMessage(htmlRenderThemeMessage(theme), "*");
  }, [loads, theme]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keeps the iframe message port and its cancellable RPC streams alive only while this view is mounted.
  useEffect(() => {
    const pending = new Map<number, AbortController>();
    let port: MessagePort | undefined;
    const stop = () => {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
      port?.close();
    };
    const ready = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.type !== "t3-flow-ready"
      )
        return;
      stop();
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = (message) => {
        const value = message.data;
        if (!Number.isSafeInteger(value?.id)) return;
        if (value.type === "cancel") {
          pending.get(value.id)?.abort();
          pending.delete(value.id);
          return;
        }
        if (
          value.type !== "request" ||
          typeof value.method !== "string" ||
          !(value.bytes instanceof Uint8Array) ||
          value.bytes.length > 8 * 1024 * 1024 ||
          pending.has(value.id)
        )
          return;
        const controller = new AbortController();
        pending.set(value.id, controller);
        const target = port;
        void runAtomCommand(
          registry,
          bridge,
          {
            environmentId,
            threadId,
            connectionId,
            daemonId,
            method: value.method,
            body: encoded(value.bytes),
            signal: controller.signal,
            chunk: (text) => send(target, { type: "chunk", id: value.id, bytes: decoded(text) }),
          },
          { reportFailure: false, reportDefect: false },
        ).then((result) => {
          pending.delete(value.id);
          send(target, { type: result._tag === "Success" ? "end" : "error", id: value.id });
        });
      };
      port.start();
      frame.current?.contentWindow?.postMessage({ type: "t3-flow-port" }, "*", [channel.port2]);
      setLoads((count) => count + 1);
    };
    window.addEventListener("message", ready);
    return () => {
      window.removeEventListener("message", ready);
      stop();
    };
  }, [registry, environmentId, threadId, connectionId, daemonId]);
  return (
    <iframe
      ref={frame}
      title={title}
      sandbox="allow-scripts"
      className={cn("min-h-0 w-full flex-1 border-0 bg-background", loads === 0 && "invisible")}
      style={{ colorScheme: theme.appearance }}
      src={`/tix-flow/index.html#${path}`}
    />
  );
}
