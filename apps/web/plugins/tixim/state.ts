import { createWorkflowEnvironment } from "@t3tools/client-runtime/plugins/tixim/state";
import { connectionAtomRuntime } from "../../src/plugins/host";

export const workflowEnvironment = createWorkflowEnvironment(connectionAtomRuntime);
