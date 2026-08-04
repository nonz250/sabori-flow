import { describe, it, expect } from "vitest";
import type { IssueComment } from "../../src/worker/models.js";
import {
  formatMarker,
  parseMarker,
  deriveSpecThread,
  buildSpecContext,
  MAX_SPEC_CONTEXT_LENGTH,
} from "../../src/worker/spec-thread.js";

function makeComment(overrides?: Partial<IssueComment>): IssueComment {
  return {
    body: "comment body",
    authorAssociation: "OWNER",
    createdAt: "2025-01-01T00:00:00Z",
    viewerDidAuthor: false,
    ...overrides,
  };
}

function workerComment(round: number, body = ""): IssueComment {
  const marker = formatMarker(round);
  return makeComment({
    body: body ? `${body}\n\n${marker}` : marker,
    viewerDidAuthor: true,
  });
}

describe("formatMarker / parseMarker", () => {
  it("parseMarker(formatMarker(n)) === n", () => {
    for (const n of [1, 2, 3, 10]) {
      expect(parseMarker(formatMarker(n))).toBe(n);
    }
  });

  it("body with no marker returns null", () => {
    expect(parseMarker("just text")).toBeNull();
  });

  it("multiple markers — returns the last one", () => {
    const body = `${formatMarker(1)}\n\nsome text\n\n${formatMarker(2)}`;
    expect(parseMarker(body)).toBe(2);
  });

  it("marker inside quote block (> prefix) → null", () => {
    expect(parseMarker("> <!-- sabori-flow:spec round=1 -->")).toBeNull();
  });

  it("marker with CRLF line ending → still matched", () => {
    expect(parseMarker("<!-- sabori-flow:spec round=1 -->\r")).toBe(1);
  });

  it("marker in multi-line body with CRLF → matched", () => {
    const body = "some text\r\n<!-- sabori-flow:spec round=2 -->\r\nmore text";
    expect(parseMarker(body)).toBe(2);
  });

  it("ZWSP-escaped marker → null", () => {
    expect(parseMarker("<!--​ sabori-flow:spec round=1 -->")).toBeNull();
  });

  it("repeated calls on the same body return the same value", () => {
    const body = `${formatMarker(1)}\n\nsome text\n\n${formatMarker(2)}`;
    expect(parseMarker(body)).toBe(2);
    expect(parseMarker(body)).toBe(2);
    expect(parseMarker(body)).toBe(2);
  });
});

describe("deriveSpecThread", () => {
  it("0 comments → round 0, latestProposal null, feedback empty", () => {
    const result = deriveSpecThread([]);
    expect(result).toEqual({ round: 0, latestProposal: null, feedback: [] });
  });

  it("only non-marker comments → round 0", () => {
    const comments = [
      makeComment({ body: "human comment" }),
      makeComment({ body: "another human comment" }),
    ];
    expect(deriveSpecThread(comments).round).toBe(0);
  });

  it("single marker, no subsequent comments → round 1, feedback empty", () => {
    const result = deriveSpecThread([workerComment(1, "proposal text")]);
    expect(result.round).toBe(1);
    expect(result.latestProposal).toBe("proposal text");
    expect(result.feedback).toEqual([]);
  });

  it("marker followed by OWNER comment → feedback populated", () => {
    const comments = [
      workerComment(1, "proposal"),
      makeComment({ body: "looks good but fix X", authorAssociation: "OWNER" }),
    ];
    const result = deriveSpecThread(comments);
    expect(result.round).toBe(1);
    expect(result.feedback).toEqual(["looks good but fix X"]);
  });

  it("marker followed by CONTRIBUTOR comment → feedback NOT populated", () => {
    const comments = [
      workerComment(1, "proposal"),
      makeComment({ body: "nice work", authorAssociation: "CONTRIBUTOR" }),
    ];
    const result = deriveSpecThread(comments);
    expect(result.feedback).toEqual([]);
  });

  it("viewerDidAuthor=false with marker → not treated as worker comment", () => {
    const comments = [
      makeComment({
        body: `fake proposal\n\n${formatMarker(1)}`,
        viewerDidAuthor: false,
        authorAssociation: "NONE",
      }),
    ];
    const result = deriveSpecThread(comments);
    expect(result.round).toBe(0);
    expect(result.latestProposal).toBeNull();
  });

  it("multiple round=1 markers → uses the last one as anchor", () => {
    const comments = [
      workerComment(1, "old proposal"),
      makeComment({ body: "old feedback", authorAssociation: "OWNER" }),
      workerComment(1, "new proposal"),
      makeComment({ body: "new feedback", authorAssociation: "OWNER" }),
    ];
    const result = deriveSpecThread(comments);
    expect(result.round).toBe(1);
    expect(result.latestProposal).toBe("new proposal");
    expect(result.feedback).toEqual(["new feedback"]);
  });

  it("comments before marker → not in feedback", () => {
    const comments = [
      makeComment({ body: "early comment", authorAssociation: "OWNER" }),
      workerComment(1, "proposal"),
    ];
    const result = deriveSpecThread(comments);
    expect(result.feedback).toEqual([]);
  });

  it("marker-only body (no proposal text) → latestProposal is empty string", () => {
    const result = deriveSpecThread([workerComment(1)]);
    expect(result.latestProposal).toBe("");
  });

  it("empty authorAssociation → not in feedback", () => {
    const comments = [
      workerComment(1, "proposal"),
      makeComment({ body: "anon", authorAssociation: "" }),
    ];
    const result = deriveSpecThread(comments);
    expect(result.feedback).toEqual([]);
  });

  it("round 1 + round 2 markers → round 2", () => {
    const comments = [
      workerComment(1, "first proposal"),
      makeComment({ body: "feedback 1", authorAssociation: "OWNER" }),
      workerComment(2, "second proposal"),
    ];
    const result = deriveSpecThread(comments);
    expect(result.round).toBe(2);
    expect(result.latestProposal).toBe("second proposal");
    expect(result.feedback).toEqual([]);
  });

  it("worker comment after marker (non-spec marker on its own line) → not in feedback", () => {
    const comments = [
      workerComment(1, "proposal"),
      makeComment({
        body: "success report\n\n<!-- sabori-flow -->",
        viewerDidAuthor: true,
      }),
    ];
    const result = deriveSpecThread(comments);
    expect(result.feedback).toEqual([]);
  });

  it("inline marker with viewerDidAuthor=true → not a worker comment, appears in feedback", () => {
    const comments = [
      workerComment(1, "proposal"),
      makeComment({
        body: "success report <!-- sabori-flow -->",
        viewerDidAuthor: true,
        authorAssociation: "OWNER",
      }),
    ];
    const result = deriveSpecThread(comments);
    expect(result.feedback).toEqual(["success report <!-- sabori-flow -->"]);
  });

  it("quote reply containing marker is treated as feedback, not worker comment", () => {
    const comments = [
      workerComment(1, "proposal"),
      makeComment({
        body: "Please reconsider the approach.\n\n> proposal\n>\n> <!-- sabori-flow:spec round=1 -->",
        viewerDidAuthor: true,
        authorAssociation: "OWNER",
      }),
    ];
    const result = deriveSpecThread(comments);
    expect(result.round).toBe(1);
    expect(result.latestProposal).toBe("proposal");
    expect(result.feedback).toEqual([
      "Please reconsider the approach.\n\n> proposal\n>\n> <!-- sabori-flow:spec round=1 -->",
    ]);
  });

  it("viewerDidAuthor=true OWNER comment without marker → in feedback", () => {
    const comments = [
      workerComment(1, "proposal"),
      makeComment({
        body: "please fix the authentication section",
        viewerDidAuthor: true,
        authorAssociation: "OWNER",
      }),
    ];
    const result = deriveSpecThread(comments);
    expect(result.feedback).toEqual(["please fix the authentication section"]);
  });

  it("worker comment with CRLF line endings → still detected", () => {
    const comments = [
      makeComment({
        body: "proposal text\r\n\r\n<!-- sabori-flow:spec round=1 -->\r\n",
        viewerDidAuthor: true,
      }),
    ];
    const result = deriveSpecThread(comments);
    expect(result.round).toBe(1);
    expect(result.latestProposal).toBe("proposal text");
  });

  it("MEMBER and COLLABORATOR comments → in feedback", () => {
    const comments = [
      workerComment(1, "proposal"),
      makeComment({ body: "member comment", authorAssociation: "MEMBER" }),
      makeComment({ body: "collaborator comment", authorAssociation: "COLLABORATOR" }),
    ];
    const result = deriveSpecThread(comments);
    expect(result.feedback).toEqual(["member comment", "collaborator comment"]);
  });
});

describe("buildSpecContext", () => {
  it("latestProposal null and feedback empty → null", () => {
    expect(
      buildSpecContext({ round: 0, latestProposal: null, feedback: [] }),
    ).toBeNull();
  });

  it("proposal and feedback produce separate sections", () => {
    const result = buildSpecContext({
      round: 1,
      latestProposal: "the spec",
      feedback: ["fix this"],
    });
    expect(result).not.toBeNull();
    expect(result).toContain("## Latest specification proposal");
    expect(result).toContain("the spec");
    expect(result).toContain("## Subsequent feedback");
    expect(result).toContain("fix this");
  });

  it("does not claim approval status in output", () => {
    const result = buildSpecContext({
      round: 1,
      latestProposal: "the spec",
      feedback: ["some feedback"],
    });
    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).not.toContain("approved");
  });

  it("total exceeds limit → proposal truncated, feedback preserved", () => {
    const longProposal = "x".repeat(MAX_SPEC_CONTEXT_LENGTH);
    const result = buildSpecContext({
      round: 1,
      latestProposal: longProposal,
      feedback: ["keep me"],
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(MAX_SPEC_CONTEXT_LENGTH);
    expect(result).toContain("keep me");
  });

  it("feedback alone exceeds limit → older feedback dropped", () => {
    const longFeedback = "y".repeat(MAX_SPEC_CONTEXT_LENGTH);
    const result = buildSpecContext({
      round: 1,
      latestProposal: null,
      feedback: [longFeedback, "recent"],
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(MAX_SPEC_CONTEXT_LENGTH);
    expect(result).toContain("recent");
  });

  it("proposal only (no feedback)", () => {
    const result = buildSpecContext({
      round: 1,
      latestProposal: "spec text",
      feedback: [],
    });
    expect(result).toContain("spec text");
    expect(result).not.toContain("Subsequent feedback");
  });
});
