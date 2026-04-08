import { describe, it, expect, vi, beforeEach } from "vitest";

import { workerMain } from "../../src/worker/main.js";
import { Phase, Priority, Autonomy, Agent } from "../../src/worker/models.js";
import {
  makeRepoConfig,
  makeIssue,
  makeAppConfig,
} from "./helpers/factories.js";
import { createMockWorkerDeps } from "./helpers/mock-deps.js";
import type { WorkerDeps } from "../../src/worker/main.js";

const { mockLoggerInstance } = vi.hoisted(() => ({
  mockLoggerInstance: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// logger を抑制
vi.mock("../../src/worker/logger.js", () => ({
  createLogger: vi.fn(() => mockLoggerInstance),
  configureLogger: vi.fn(),
  rotateOldLogs: vi.fn(),
}));

describe("workerMain", () => {
  let deps: WorkerDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockWorkerDeps();
  });

  // -----------------------------------------------------------------------
  // config 読み込み失敗
  // -----------------------------------------------------------------------

  describe("config 読み込み失敗", () => {
    it("loadConfig が FileNotFoundError を投げると 1 が返る", async () => {
      vi.mocked(deps.loadConfig).mockImplementation(() => {
        throw new Error("not found");
      });

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(1);
    });

    it("loadConfig がバリデーションエラーを投げると 1 が返る", async () => {
      vi.mocked(deps.loadConfig).mockImplementation(() => {
        throw new Error("invalid config");
      });

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Issue 取得と処理
  // -----------------------------------------------------------------------

  describe("Issue 取得と処理", () => {
    it("Issue 取得成功かつ processIssue 成功時に 0 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      // plan フェーズで 1 件取得、impl フェーズは 0 件
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([
          makeIssue({ number: 42, title: "Feature request", priority: Priority.HIGH }),
        ])
        .mockResolvedValueOnce([]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
      expect(deps.processIssue).toHaveBeenCalledOnce();
    });

    it("Issue 取得成功だが processIssue が全件失敗すると 1 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([
          makeIssue({ number: 42, title: "Feature request", priority: Priority.HIGH }),
        ])
        .mockResolvedValueOnce([
          makeIssue({ number: 43, title: "Another issue", phase: Phase.IMPL }),
        ]);
      vi.mocked(deps.processIssue).mockResolvedValue(false);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(1);
      expect(deps.processIssue).toHaveBeenCalledTimes(2);
    });

    it("Issue 0 件の場合は processIssue が呼ばれず 0 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues).mockResolvedValue([]);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
      expect(deps.processIssue).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // エラーハンドリング
  // -----------------------------------------------------------------------

  describe("エラーハンドリング", () => {
    it("plan フェーズで fetchIssues が失敗しても impl フェーズで成功すれば 0 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues)
        .mockRejectedValueOnce(new Error("gh failed"))
        .mockResolvedValueOnce([makeIssue({ phase: Phase.IMPL })]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
    });

    it("plan フェーズで IssueParseError が発生しても impl フェーズで成功すれば 0 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues)
        .mockRejectedValueOnce(new Error("parse failed"))
        .mockResolvedValueOnce([makeIssue({ phase: Phase.IMPL })]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
    });

    it("全フェーズで Issue 取得に失敗すると 1 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues).mockRejectedValue(new Error("gh failed"));

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(1);
      expect(deps.processIssue).not.toHaveBeenCalled();
    });

    it("複数リポジトリの全フェーズで Issue 取得に失敗すると 1 が返る", async () => {
      const repo1 = makeRepoConfig({ owner: "org1", repo: "repo1" });
      const repo2 = makeRepoConfig({ owner: "org2", repo: "repo2" });
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ repositories: [repo1, repo2] }),
      );
      vi.mocked(deps.fetchIssues).mockRejectedValue(new Error("gh failed"));

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(1);
      expect(deps.processIssue).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // processPhase 相当のテスト
  // -----------------------------------------------------------------------

  describe("フェーズ処理", () => {
    it("Issue が取得されて processIssue が成功すると 0 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([makeIssue({ number: 10, phase: Phase.PLAN })])
        .mockResolvedValueOnce([]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
      expect(deps.processIssue).toHaveBeenCalledOnce();
    });

    it("Issue が取得されたが processIssue が全件失敗すると 1 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      // 両フェーズで Issue が取得され、全件 processIssue が失敗
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([makeIssue({ number: 10, phase: Phase.PLAN })])
        .mockResolvedValueOnce([makeIssue({ number: 20, phase: Phase.IMPL })]);
      vi.mocked(deps.processIssue).mockResolvedValue(false);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(1);
    });

    it("Issue 0 件は成功扱いで processIssue は呼ばれない", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues).mockResolvedValue([]);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
      expect(deps.processIssue).not.toHaveBeenCalled();
    });

    it("fetchIssues が例外を投げると false 扱いになる", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues).mockRejectedValue(new Error("gh failed"));

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(1);
      expect(deps.processIssue).not.toHaveBeenCalled();
    });

    it("複数 Issue のうち 1 件でも processIssue が成功すれば 0 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([
          makeIssue({ number: 10, phase: Phase.PLAN }),
          makeIssue({ number: 20, phase: Phase.PLAN }),
        ])
        .mockResolvedValueOnce([]);
      vi.mocked(deps.processIssue)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
      expect(deps.processIssue).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // リポジトリ処理
  // -----------------------------------------------------------------------

  describe("リポジトリ処理", () => {
    it("plan と impl の両フェーズが処理される", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues).mockResolvedValue([]);

      await workerMain("/path/to/config.yml", deps);

      // 1 リポジトリ x 2 フェーズ = 2 回の fetchIssues 呼び出し
      expect(deps.fetchIssues).toHaveBeenCalledTimes(2);
    });

    it("plan が成功し impl が失敗しても 0 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([makeIssue({ phase: Phase.PLAN })])
        .mockRejectedValueOnce(new Error("impl fetch failed"));
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
    });

    it("plan が失敗し impl が成功しても 0 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues)
        .mockRejectedValueOnce(new Error("plan fetch failed"))
        .mockResolvedValueOnce([makeIssue({ phase: Phase.IMPL })]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
    });

    it("両フェーズが成功すると 0 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([makeIssue({ phase: Phase.PLAN })])
        .mockResolvedValueOnce([makeIssue({ phase: Phase.IMPL })]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
    });

    it("両フェーズが失敗すると 1 が返る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(makeAppConfig());
      vi.mocked(deps.fetchIssues).mockRejectedValue(new Error("fetch failed"));

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 並列処理
  // -----------------------------------------------------------------------

  describe("並列処理", () => {
    it("複数リポジトリが並列に処理される", async () => {
      const repo1 = makeRepoConfig({ owner: "org1", repo: "repo1" });
      const repo2 = makeRepoConfig({ owner: "org2", repo: "repo2" });
      const repo3 = makeRepoConfig({ owner: "org3", repo: "repo3" });
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({
          repositories: [repo1, repo2, repo3],
          execution: { maxParallel: 3 },
        }),
      );
      vi.mocked(deps.fetchIssues).mockResolvedValue([]);

      await workerMain("/path/to/config.yml", deps);

      // 3 リポジトリ x 2 フェーズ = 6 回の fetchIssues 呼び出し
      expect(deps.fetchIssues).toHaveBeenCalledTimes(6);
    });

    it("processIssue が例外を投げるリポジトリがあっても他のリポジトリは処理が継続する", async () => {
      const repo1 = makeRepoConfig({ owner: "org1", repo: "repo1" });
      const repo2 = makeRepoConfig({ owner: "org2", repo: "repo2" });
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({
          repositories: [repo1, repo2],
          execution: { maxParallel: 2 },
        }),
      );

      let callCount = 0;
      vi.mocked(deps.fetchIssues).mockImplementation(async (repoConfig) => {
        callCount++;
        if (repoConfig.owner === "org1" && callCount <= 2) {
          return [makeIssue({ phase: callCount === 1 ? Phase.PLAN : Phase.IMPL })];
        }
        if (repoConfig.owner === "org2" && callCount > 2) {
          return [makeIssue({ phase: callCount === 3 ? Phase.PLAN : Phase.IMPL })];
        }
        return [];
      });

      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
    });

    it("Promise.allSettled でリポジトリ単位の予期しないエラーをキャッチする", async () => {
      const repo1 = makeRepoConfig({ owner: "org1", repo: "repo1" });
      const repo2 = makeRepoConfig({ owner: "org2", repo: "repo2" });
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({
          repositories: [repo1, repo2],
          execution: { maxParallel: 2 },
        }),
      );

      // repo1 は fetchIssues が成功して processIssue も成功
      // repo2 は fetchIssues で予期しないエラー
      let fetchCallCount = 0;
      vi.mocked(deps.fetchIssues).mockImplementation(async (repoConfig) => {
        fetchCallCount++;
        if (repoConfig.owner === "org2") {
          throw new Error("unexpected crash");
        }
        return fetchCallCount <= 1
          ? [makeIssue({ phase: Phase.PLAN })]
          : [];
      });
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      // repo1 の処理は成功しているので 0 が返る
      expect(result).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // maxIssuesPerRepo 上限制御
  // -----------------------------------------------------------------------

  describe("maxIssuesPerRepo 上限制御", () => {
    it("Issue 数が上限を超える場合、上限件数のみ processIssue が呼ばれる", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ execution: { maxIssuesPerRepo: 2 } }),
      );
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([
          makeIssue({ number: 1, phase: Phase.PLAN }),
          makeIssue({ number: 2, phase: Phase.PLAN }),
          makeIssue({ number: 3, phase: Phase.PLAN }),
          makeIssue({ number: 4, phase: Phase.PLAN }),
          makeIssue({ number: 5, phase: Phase.PLAN }),
        ])
        .mockResolvedValueOnce([]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
      expect(deps.processIssue).toHaveBeenCalledTimes(2);
    });

    it("Issue 数がちょうど上限と等しい場合、全件処理される", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ execution: { maxIssuesPerRepo: 3 } }),
      );
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([
          makeIssue({ number: 1, phase: Phase.PLAN }),
          makeIssue({ number: 2, phase: Phase.PLAN }),
          makeIssue({ number: 3, phase: Phase.PLAN }),
        ])
        .mockResolvedValueOnce([]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
      expect(deps.processIssue).toHaveBeenCalledTimes(3);
    });

    it("Issue 数が上限未満の場合、全件処理される", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ execution: { maxIssuesPerRepo: 5 } }),
      );
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([
          makeIssue({ number: 1, phase: Phase.PLAN }),
          makeIssue({ number: 2, phase: Phase.PLAN }),
        ])
        .mockResolvedValueOnce([]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
      expect(deps.processIssue).toHaveBeenCalledTimes(2);
    });

    it("plan で上限に達すると impl フェーズの fetchIssues が呼ばれない", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ execution: { maxIssuesPerRepo: 1 } }),
      );
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([
          makeIssue({ number: 1, phase: Phase.PLAN }),
        ]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      await workerMain("/path/to/config.yml", deps);

      // plan の fetchIssues のみ呼ばれ、impl の fetchIssues は呼ばれない
      expect(deps.fetchIssues).toHaveBeenCalledTimes(1);
      expect(deps.processIssue).toHaveBeenCalledTimes(1);
    });

    it("plan で一部消費し impl で残りを消費する", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ execution: { maxIssuesPerRepo: 3 } }),
      );
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([
          makeIssue({ number: 1, phase: Phase.PLAN }),
          makeIssue({ number: 2, phase: Phase.PLAN }),
        ])
        .mockResolvedValueOnce([
          makeIssue({ number: 10, phase: Phase.IMPL }),
          makeIssue({ number: 11, phase: Phase.IMPL }),
          makeIssue({ number: 12, phase: Phase.IMPL }),
        ]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
      // plan 2件 + impl 1件 = 合計3件（上限）
      expect(deps.processIssue).toHaveBeenCalledTimes(3);
    });

    it("plan の fetchIssues が失敗しても quota は消費されず impl に全 quota が残る", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ execution: { maxIssuesPerRepo: 2 } }),
      );
      vi.mocked(deps.fetchIssues)
        .mockRejectedValueOnce(new Error("plan fetch failed"))
        .mockResolvedValueOnce([
          makeIssue({ number: 10, phase: Phase.IMPL }),
          makeIssue({ number: 11, phase: Phase.IMPL }),
          makeIssue({ number: 12, phase: Phase.IMPL }),
        ]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
      // plan は失敗（quota 消費なし）、impl で上限 2 件のみ処理
      expect(deps.processIssue).toHaveBeenCalledTimes(2);
    });

    it("上限が 1 の最小値で正しく動作する", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ execution: { maxIssuesPerRepo: 1 } }),
      );
      vi.mocked(deps.fetchIssues)
        .mockResolvedValueOnce([
          makeIssue({ number: 1, phase: Phase.PLAN }),
          makeIssue({ number: 2, phase: Phase.PLAN }),
        ]);
      vi.mocked(deps.processIssue).mockResolvedValue(true);

      const result = await workerMain("/path/to/config.yml", deps);

      expect(result).toBe(0);
      expect(deps.processIssue).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // autonomy WARN ログ
  // -----------------------------------------------------------------------

  describe("autonomy WARN ログ", () => {
    it("autonomy が full の場合 WARN ログが出力される", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ execution: { autonomy: Autonomy.FULL } }),
      );
      vi.mocked(deps.fetchIssues).mockResolvedValue([]);

      mockLoggerInstance.warn.mockClear();

      await workerMain("/path/to/config.yml", deps);

      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        "autonomy is set to 'full'. %s.",
        "Claude Code CLI will run with --dangerously-skip-permissions",
      );
    });

    it("autonomy が interactive の場合 autonomy WARN ログが出力されない", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ execution: { autonomy: Autonomy.INTERACTIVE } }),
      );
      vi.mocked(deps.fetchIssues).mockResolvedValue([]);

      mockLoggerInstance.warn.mockClear();

      await workerMain("/path/to/config.yml", deps);

      expect(mockLoggerInstance.warn).not.toHaveBeenCalled();
    });

    it("autonomy が sandboxed の場合 autonomy WARN ログが出力されない", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ execution: { autonomy: Autonomy.SANDBOXED } }),
      );
      vi.mocked(deps.fetchIssues).mockResolvedValue([]);

      mockLoggerInstance.warn.mockClear();

      await workerMain("/path/to/config.yml", deps);

      expect(mockLoggerInstance.warn).not.toHaveBeenCalled();
    });

    it("agent が codex かつ autonomy が full の場合 WARN ログに Codex CLI のフラグが含まれる", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ execution: { agent: Agent.CODEX, autonomy: Autonomy.FULL } }),
      );
      vi.mocked(deps.fetchIssues).mockResolvedValue([]);

      mockLoggerInstance.warn.mockClear();

      await workerMain("/path/to/config.yml", deps);

      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        "autonomy is set to 'full'. %s.",
        "Codex CLI will run with --dangerously-bypass-approvals-and-sandbox",
      );
    });

    it("agent が claude かつ autonomy が full の場合 WARN ログに Claude Code CLI のフラグが含まれる", async () => {
      vi.mocked(deps.loadConfig).mockReturnValue(
        makeAppConfig({ execution: { agent: Agent.CLAUDE, autonomy: Autonomy.FULL } }),
      );
      vi.mocked(deps.fetchIssues).mockResolvedValue([]);

      mockLoggerInstance.warn.mockClear();

      await workerMain("/path/to/config.yml", deps);

      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        "autonomy is set to 'full'. %s.",
        "Claude Code CLI will run with --dangerously-skip-permissions",
      );
    });
  });
});
