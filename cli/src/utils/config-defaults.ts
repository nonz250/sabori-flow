export function getDefaultLabels() {
  return {
    plan: {
      trigger: "claude/plan",
      in_progress: "claude/plan:in-progress",
      done: "claude/plan:done",
      failed: "claude/plan:failed",
    },
    impl: {
      trigger: "claude/impl",
      in_progress: "claude/impl:in-progress",
      done: "claude/impl:done",
      failed: "claude/impl:failed",
    },
  };
}

export function getDefaultPriorityLabels(): string[] {
  return ["priority:high", "priority:low"];
}

export function getDefaultExecution() {
  return { max_parallel: 1 };
}
