import type { Agent } from "./models.js";

/**
 * Tracks which agents have hit their usage limit during one worker run.
 *
 * Shared across repositories processed in parallel so that once an agent is
 * out of quota, later issues go straight to the next agent instead of
 * spending a worktree and a CLI launch to rediscover the limit. Scoped to a
 * single run: the next launchd cycle starts from the full priority list
 * again, which is how a reset quota gets picked back up.
 */
export class AgentPool {
  private readonly exhausted = new Set<Agent>();

  constructor(private readonly priority: readonly Agent[]) {}

  /** Agents still worth trying, in priority order */
  available(): readonly Agent[] {
    return this.priority.filter((agent) => !this.exhausted.has(agent));
  }

  next(): Agent | undefined {
    return this.available()[0];
  }

  markExhausted(agent: Agent): void {
    this.exhausted.add(agent);
  }
}
