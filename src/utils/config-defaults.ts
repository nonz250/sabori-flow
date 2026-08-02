export function getDefaultPriorityLabels(): string[] {
  return ["priority:high", "priority:low"];
}

export function getDefaultExecution() {
  return {
    max_parallel: 1,
    max_issues_per_repo: 1,
    autonomy: "interactive",
    interval_minutes: 10,
    timeout_minutes: 60,
  };
}
