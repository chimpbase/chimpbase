import { describe, expect, test } from "bun:test";

import {
  compareWorkflowContracts,
  versionWorkflow,
  workflowActionStep,
  workflowSleepStep,
  workflowWaitForSignalStep,
} from "../packages/runtime/index.ts";

const onboardingInputSchema = {
  properties: {
    customerId: { type: "string" },
  },
  required: ["customerId"],
  type: "object",
} as const;

const onboardingStateSchema = {
  properties: {
    customerId: { type: "string" },
    kickoffCompletedAt: { type: "string" },
  },
  required: ["customerId"],
  type: "object",
} as const;

function createWorkflowDraft() {
  return {
    initialState(input: { customerId: string }) {
      return {
        customerId: input.customerId,
        kickoffCompletedAt: null as string | null,
      };
    },
    inputSchema: onboardingInputSchema,
    name: "customer.onboarding",
    signalSchemas: {
      "kickoff.completed": {
        properties: {
          completedAt: { type: "string" },
        },
        required: ["completedAt"],
        type: "object",
      },
    },
    stateSchema: onboardingStateSchema,
    steps: [
      workflowActionStep("create-account", "createCustomerRecord"),
      workflowSleepStep("wait-7-days", 7 * 24 * 60 * 60 * 1000),
      workflowWaitForSignalStep("wait-kickoff", "kickoff.completed", {
        timeoutMs: 14 * 24 * 60 * 60 * 1000,
      }),
      workflowActionStep("activate-account", "activateCustomer"),
    ],
  };
}

describe("workflow contracts", () => {
  test("assigns version 1 for the first generated contract and reuses it when unchanged", () => {
    const first = versionWorkflow(createWorkflowDraft());
    expect(first.definition.version).toBe(1);
    expect(first.compatibility).toBe("additive");
    expect(first.changed).toBe(true);
    expect(first.contract.hash).toBeString();

    const second = versionWorkflow(createWorkflowDraft(), first.contract);
    expect(second.definition.version).toBe(1);
    expect(second.compatibility).toBe("identical");
    expect(second.changed).toBe(false);
    expect(second.contract.hash).toBe(first.contract.hash);
  });

  test("bumps version for additive changes", () => {
    const first = versionWorkflow(createWorkflowDraft());
    const second = versionWorkflow(
      {
        ...createWorkflowDraft(),
        stateSchema: {
          ...onboardingStateSchema,
          properties: {
            ...onboardingStateSchema.properties,
            activationRate30d: { type: "number" },
          },
        },
        steps: [
          ...createWorkflowDraft().steps,
          workflowActionStep("evaluate-30-day-adoption", "evaluateActivation"),
        ],
      },
      first.contract,
    );

    expect(second.definition.version).toBe(2);
    expect(second.compatibility).toBe("additive");
    expect(second.changed).toBe(true);
  });

  test("flags breaking schema changes and inserted middle steps", () => {
    const first = versionWorkflow(createWorkflowDraft());

    const breaking = versionWorkflow(
      {
        ...createWorkflowDraft(),
        stateSchema: {
          ...onboardingStateSchema,
          properties: {
            ...onboardingStateSchema.properties,
            ownerEmail: { type: "string" },
          },
          required: ["customerId", "ownerEmail"],
        },
      },
      first.contract,
    );

    expect(breaking.definition.version).toBe(2);
    expect(breaking.compatibility).toBe("breaking");

    const requiresMigration = versionWorkflow(
      {
        ...createWorkflowDraft(),
        steps: [
          workflowActionStep("create-account", "createCustomerRecord"),
          workflowActionStep("send-welcome-email", "sendWelcomeEmail"),
          workflowSleepStep("wait-7-days", 7 * 24 * 60 * 60 * 1000),
          workflowWaitForSignalStep("wait-kickoff", "kickoff.completed", {
            timeoutMs: 14 * 24 * 60 * 60 * 1000,
          }),
          workflowActionStep("activate-account", "activateCustomer"),
        ],
      },
      first.contract,
    );

    expect(requiresMigration.compatibility).toBe("requires_migration");
    expect(
      compareWorkflowContracts(first.contract, requiresMigration.contract),
    ).toBe("requires_migration");
  });

  test("supports imperative workflow definitions without step arrays", () => {
    const first = versionWorkflow({
      initialState(input: { customerId: string }): { customerId: string; phase: "done" | "provision" } {
        return {
          customerId: input.customerId,
          phase: "provision" as const,
        };
      },
      inputSchema: onboardingInputSchema,
      name: "customer.lifecycle",
      stateSchema: {
        properties: {
          customerId: { type: "string" },
          phase: { enum: ["provision", "done"] },
        },
        required: ["customerId", "phase"],
        type: "object",
      },
      run(wf) {
        switch (wf.state.phase) {
          case "provision":
            return wf.transition({
              customerId: wf.state.customerId,
              phase: "done",
            });
          default:
            return wf.complete(wf.state);
        }
      },
    });

    expect(first.contract.mode).toBe("run");
    expect(first.contract.steps).toEqual([]);

    const second = versionWorkflow({
      ...first.definition,
      stateSchema: {
        properties: {
          customerId: { type: "string" },
          phase: { enum: ["provision", "done"] },
          syncedAt: { type: "string" },
        },
        required: ["customerId", "phase"],
        type: "object",
      },
    }, first.contract);

    expect(second.definition.version).toBe(2);
    expect(second.compatibility).toBe("additive");
  });
});
