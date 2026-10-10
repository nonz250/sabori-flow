import { describe, it, expect } from "vitest";

import { AgentPool } from "../../src/worker/agent-pool.js";
import { Agent } from "../../src/worker/models.js";

describe("AgentPool", () => {
  it("初期状態では設定された優先度順にすべてのエージェントを返す", () => {
    const pool = new AgentPool([Agent.CODEX, Agent.CLAUDE]);

    expect(pool.available()).toEqual([Agent.CODEX, Agent.CLAUDE]);
    expect(pool.next()).toBe(Agent.CODEX);
  });

  it("上限到達としたエージェントを除き、残りを優先度順に返す", () => {
    const pool = new AgentPool([Agent.CLAUDE, Agent.CODEX]);

    pool.markExhausted(Agent.CLAUDE);

    expect(pool.available()).toEqual([Agent.CODEX]);
    expect(pool.next()).toBe(Agent.CODEX);
  });

  it("全エージェントが上限到達すると next は undefined を返す", () => {
    const pool = new AgentPool([Agent.CLAUDE, Agent.CODEX]);

    pool.markExhausted(Agent.CLAUDE);
    pool.markExhausted(Agent.CODEX);

    expect(pool.available()).toEqual([]);
    expect(pool.next()).toBeUndefined();
  });

  it("同じエージェントを二度上限到達としても結果は変わらない", () => {
    const pool = new AgentPool([Agent.CLAUDE, Agent.CODEX]);

    pool.markExhausted(Agent.CLAUDE);
    pool.markExhausted(Agent.CLAUDE);

    expect(pool.available()).toEqual([Agent.CODEX]);
  });

  it("優先度リストにないエージェントを上限到達としても影響しない", () => {
    const pool = new AgentPool([Agent.CLAUDE]);

    pool.markExhausted(Agent.CODEX);

    expect(pool.available()).toEqual([Agent.CLAUDE]);
  });
});
