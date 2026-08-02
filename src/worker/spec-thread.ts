import type { IssueComment, SpecThread } from "./models.js";
import { PERMITTED_ASSOCIATIONS } from "./models.js";

const WORKER_COMMENT_LINE_PATTERN = /^<!-- sabori-flow/m;
const SPEC_MARKER_PATTERN = /^<!-- sabori-flow:spec round=(\d+) -->\r?$/gm;

export const MAX_SPEC_CONTEXT_LENGTH = 60_000;

// ---------- Marker ----------

export function formatMarker(round: number): string {
  return `<!-- sabori-flow:spec round=${round} -->`;
}

export function parseMarker(body: string): number | null {
  let lastMatch: number | null = null;
  for (const match of body.matchAll(SPEC_MARKER_PATTERN)) {
    lastMatch = Number(match[1]);
  }
  return lastMatch;
}

// ---------- Thread derivation ----------

/**
 * Worker のコメントかどうかを判定する。
 *
 * viewerDidAuthor と marker の AND で判定する。
 * author_association だけでは worker 自身の OWNER コメントと区別できず、
 * marker だけでは第三者が marker を含むコメントを投稿して
 * latestProposal を乗っ取れる。両方を要求して双方の穴を塞ぐ。
 */
function isWorkerComment(comment: IssueComment): boolean {
  return comment.viewerDidAuthor && WORKER_COMMENT_LINE_PATTERN.test(comment.body);
}

export function deriveSpecThread(comments: readonly IssueComment[]): SpecThread {
  // Find the last round=1 marker to anchor the window
  let anchorIndex = -1;
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];
    if (isWorkerComment(c)) {
      const round = parseMarker(c.body);
      if (round === 1) {
        anchorIndex = i;
        break;
      }
    }
  }

  if (anchorIndex === -1) {
    return { round: 0, latestProposal: null, feedback: [] };
  }

  // Count marker comments from anchor onward
  let round = 0;
  let latestMarkerIndex = -1;
  let latestMarkerBody: string | null = null;

  for (let i = anchorIndex; i < comments.length; i++) {
    const c = comments[i];
    if (isWorkerComment(c) && parseMarker(c.body) !== null) {
      round++;
      latestMarkerIndex = i;
      latestMarkerBody = c.body;
    }
  }

  // Extract proposal text (marker removed)
  let latestProposal: string | null = null;
  if (latestMarkerBody !== null) {
    latestProposal = latestMarkerBody.replace(SPEC_MARKER_PATTERN, "").trim();
  }

  // Collect feedback: human comments after the latest marker
  const feedback: string[] = [];
  for (let i = latestMarkerIndex + 1; i < comments.length; i++) {
    const c = comments[i];
    if (isWorkerComment(c)) continue;
    if (!PERMITTED_ASSOCIATIONS.has(c.authorAssociation)) continue;
    if (c.authorAssociation === "") continue;
    feedback.push(c.body);
  }

  return { round, latestProposal, feedback };
}

// ---------- Spec context ----------

const PROPOSAL_HEADING = "## Latest specification proposal\n\n";
const FEEDBACK_HEADER =
  "## Subsequent feedback\n\n" +
  "The following comments were posted after the latest proposal.\n\n";

export function buildSpecContext(thread: SpecThread): string | null {
  if (thread.latestProposal === null && thread.feedback.length === 0) {
    return null;
  }

  const sections: string[] = [];

  if (thread.latestProposal !== null) {
    sections.push(PROPOSAL_HEADING + thread.latestProposal);
  }

  if (thread.feedback.length > 0) {
    sections.push(
      FEEDBACK_HEADER +
        thread.feedback.map((f, i) => `### Feedback ${i + 1}\n\n${f}`).join("\n\n"),
    );
  }

  let result = sections.join("\n\n");

  if (result.length > MAX_SPEC_CONTEXT_LENGTH) {
    result = truncateSpecContext(thread);
  }

  return result;
}

function truncateSpecContext(thread: SpecThread): string {
  const sections: string[] = [];

  // Feedback takes priority — truncate proposal first
  const feedbackBlock =
    thread.feedback.length > 0
      ? FEEDBACK_HEADER +
        thread.feedback.map((f, i) => `### Feedback ${i + 1}\n\n${f}`).join("\n\n")
      : "";

  const feedbackLen = feedbackBlock.length;

  if (feedbackLen >= MAX_SPEC_CONTEXT_LENGTH) {
    const kept: string[] = [];
    let keptLen = 0;

    for (let i = thread.feedback.length - 1; i >= 0; i--) {
      const entry = `### Feedback ${i + 1}\n\n${thread.feedback[i]}`;
      if (FEEDBACK_HEADER.length + keptLen + entry.length + 4 > MAX_SPEC_CONTEXT_LENGTH) {
        break;
      }
      kept.unshift(entry);
      keptLen += entry.length + 4;
    }
    return FEEDBACK_HEADER + kept.join("\n\n");
  }

  if (thread.latestProposal !== null) {
    const remaining = MAX_SPEC_CONTEXT_LENGTH - feedbackLen - 4;
    const maxProposalBody = remaining - PROPOSAL_HEADING.length;

    if (maxProposalBody > 0) {
      const truncated = thread.latestProposal.slice(0, maxProposalBody);
      sections.push(PROPOSAL_HEADING + truncated);
    }
  }

  if (feedbackBlock.length > 0) {
    sections.push(feedbackBlock);
  }

  return sections.join("\n\n");
}
