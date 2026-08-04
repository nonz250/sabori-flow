import type { SpecThread, SpecPhaseLabels } from "./models.js";

export const MAX_SPEC_ROUNDS = 3;

export type SpecResumeAction = "approve" | "revise" | "escalate" | "wait";

export interface SpecResumeDecision {
  readonly action: SpecResumeAction;
  readonly reason: string;
}

export interface SpecReviewState {
  readonly thread: SpecThread;
  readonly labels: readonly string[];
  readonly specLabels: SpecPhaseLabels;
}

/**
 * spec review の再開条件を評価する。
 *
 * 承認を最初に判定する。承認ラベルと差し戻しコメントが同時にある場合、
 * 承認を勝たせるため。
 */
export function evaluateSpecResume(state: SpecReviewState): SpecResumeDecision {
  const { thread, labels, specLabels } = state;

  if (labels.includes(specLabels.approved)) {
    return { action: "approve", reason: "approval label is present" };
  }
  if (thread.round === 0) {
    return { action: "escalate", reason: "no proposal marker found in the thread" };
  }
  if (thread.feedback.length === 0) {
    return { action: "wait", reason: "no feedback since the latest proposal" };
  }
  if (thread.round >= MAX_SPEC_ROUNDS) {
    return { action: "escalate", reason: "revision limit reached" };
  }
  return { action: "revise", reason: "feedback received since the latest proposal" };
}
