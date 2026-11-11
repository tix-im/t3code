import { expect, it } from "vite-plus/test";
import {
  allowedWorkflowRunActions,
  encodeWorkflowIdRequest,
  grpcWebStatus,
} from "./workflowActions";

const frame = (flag: number, payload: string) => {
  const bytes = new TextEncoder().encode(payload);
  const header = [flag, 0, 0, bytes.length >> 8, bytes.length & 0xff];
  return btoa(String.fromCharCode(...header, ...bytes));
};

it("encodes the run ID as field 1 with a varint length", () => {
  expect(atob(encodeWorkflowIdRequest("wf-a"))).toBe("\x0a\x04wf-a");
  const long = atob(encodeWorkflowIdRequest("x".repeat(200)));
  expect(Array.from(long.slice(0, 3), (char) => char.charCodeAt(0))).toEqual([0x0a, 0xc8, 0x01]);
});

it("reads the status from the trailer after any data frames", () => {
  expect(grpcWebStatus([frame(0, "data"), frame(0x80, "grpc-status: 0\r\n")])).toBe(0);
  expect(grpcWebStatus([frame(0x80, "grpc-message: nope\r\ngrpc-status:9\r\n")])).toBe(9);
  expect(grpcWebStatus([frame(0, "data")])).toBeNull();
});

it("offers the actions Tix Flow offers for each state", () => {
  expect(allowedWorkflowRunActions("running")).toEqual(["suspend", "freeze", "cancel"]);
  expect(allowedWorkflowRunActions("frozen")).toEqual(["thaw", "cancel"]);
  expect(allowedWorkflowRunActions("suspended")).toEqual(["resume", "cancel"]);
  expect(allowedWorkflowRunActions("cancelling")).toEqual([]);
  expect(allowedWorkflowRunActions("failed")).toEqual(["restart"]);
});
