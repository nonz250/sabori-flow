import { describe, it, expect } from "vitest";
import type { SpecThread, SpecPhaseLabels } from "../../src/worker/models.js";
import {
  evaluateSpecResume,
  MAX_SPEC_ROUNDS,
} from "../../src/worker/spec-review.js";

const specLabels: SpecPhaseLabels = {
  trigger: "ai/spec",
  inProgress: "ai/spec/in-progress",
  done: "ai/spec/done",
  failed: "ai/spec/failed",
  review: "ai/spec/review",
  approved: "ai/spec/approved",
  needsHuman: "ai/spec/needs-human",
};

function makeThread(overrides?: Partial<SpecThread>): SpecThread {
  return {
    round: 1,
    latestProposal: "proposal",
    feedback: [],
    ...overrides,
  };
}

describe("evaluateSpecResume", () => {
  it("approved label present + feedback → approve", () => {
    const result = evaluateSpecResume({
      thread: makeThread({ feedback: ["some feedback"] }),
      labels: [specLabels.review, specLabels.approved],
      specLabels,
    });
    expect(result.action).toBe("approve");
  });

  it("approved label present + no feedback → approve", () => {
    const result = evaluateSpecResume({
      thread: makeThread(),
      labels: [specLabels.review, specLabels.approved],
      specLabels,
    });
    expect(result.action).toBe("approve");
  });

  it("round 0, no feedback → escalate", () => {
    const result = evaluateSpecResume({
      thread: makeThread({ round: 0, feedback: [] }),
      labels: [specLabels.review],
      specLabels,
    });
    expect(result.action).toBe("escalate");
  });

  it("round 0, feedback present → escalate", () => {
    const result = evaluateSpecResume({
      thread: makeThread({ round: 0, feedback: ["fb"] }),
      labels: [specLabels.review],
      specLabels,
    });
    expect(result.action).toBe("escalate");
  });

  it("round 1, feedback present → revise", () => {
    const result = evaluateSpecResume({
      thread: makeThread({ round: 1, feedback: ["fix this"] }),
      labels: [specLabels.review],
      specLabels,
    });
    expect(result.action).toBe("revise");
  });

  it("round 1, no feedback → wait", () => {
    const result = evaluateSpecResume({
      thread: makeThread({ round: 1, feedback: [] }),
      labels: [specLabels.review],
      specLabels,
    });
    expect(result.action).toBe("wait");
  });

  it("round MAX_SPEC_ROUNDS, feedback present → escalate", () => {
    const result = evaluateSpecResume({
      thread: makeThread({ round: MAX_SPEC_ROUNDS, feedback: ["fb"] }),
      labels: [specLabels.review],
      specLabels,
    });
    expect(result.action).toBe("escalate");
    expect(result.reason).toContain("revision limit");
  });

  it("round MAX_SPEC_ROUNDS, no feedback → wait", () => {
    const result = evaluateSpecResume({
      thread: makeThread({ round: MAX_SPEC_ROUNDS, feedback: [] }),
      labels: [specLabels.review],
      specLabels,
    });
    expect(result.action).toBe("wait");
  });

  it("round MAX_SPEC_ROUNDS+1, feedback present → escalate", () => {
    const result = evaluateSpecResume({
      thread: makeThread({ round: MAX_SPEC_ROUNDS + 1, feedback: ["fb"] }),
      labels: [specLabels.review],
      specLabels,
    });
    expect(result.action).toBe("escalate");
  });

  it("MAX_SPEC_ROUNDS is 3", () => {
    expect(MAX_SPEC_ROUNDS).toBe(3);
  });

  it("all decisions include a reason string", () => {
    const scenarios = [
      { thread: makeThread(), labels: [specLabels.approved] },
      { thread: makeThread({ round: 0 }), labels: [] as string[] },
      { thread: makeThread({ feedback: ["f"] }), labels: [] as string[] },
      { thread: makeThread({ round: MAX_SPEC_ROUNDS, feedback: ["f"] }), labels: [] as string[] },
    ];
    for (const s of scenarios) {
      const result = evaluateSpecResume({ ...s, specLabels });
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
