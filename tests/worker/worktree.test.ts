import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("node:fs");

vi.mock("../../src/worker/process.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/worker/process.js")>();
  return {
    ...original,
    runCommandSync: vi.fn(),
  };
});

vi.mock("../../src/worker/logger.js", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

import { withWorktree, WorktreeError } from "../../src/worker/worktree.js";
import { runCommandSync, ProcessExecutionError } from "../../src/worker/process.js";
import { mkdirSync } from "node:fs";

const mockedRunCommandSync = vi.mocked(runCommandSync);
const mockedMkdirSync = vi.mocked(mkdirSync);

const FIXED_TIMESTAMP = "20260331100000";
const REPO_PATH = "/path/to/repo";

function fixedTimestampFn(): string {
  return FIXED_TIMESTAMP;
}

describe("withWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("正常系", () => {
    it("worktree が作成され、コールバック実行後に削除される", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await withWorktree(
        REPO_PATH,
        42,
        "main",
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      // git fetch origin, git worktree add, git worktree remove が呼ばれる
      expect(mockedRunCommandSync).toHaveBeenCalledTimes(3);

      const fetchCall = mockedRunCommandSync.mock.calls[0];
      expect(fetchCall[0]).toBe("git");
      expect(fetchCall[1]).toContain("fetch");

      const addCall = mockedRunCommandSync.mock.calls[1];
      expect(addCall[0]).toBe("git");
      expect(addCall[1]).toContain("worktree");
      expect(addCall[1]).toContain("add");

      const removeCall = mockedRunCommandSync.mock.calls[2];
      expect(removeCall[0]).toBe("git");
      expect(removeCall[1]).toContain("worktree");
      expect(removeCall[1]).toContain("remove");
    });

    it("カスタム timestampFn が呼ばれ、パスに反映される", async () => {
      mockedRunCommandSync.mockReturnValue("");
      const customTs = "99991231235959";

      let yieldedPath = "";
      await withWorktree(
        REPO_PATH,
        7,
        "main",
        async (path) => { yieldedPath = path; },
        () => customTs,
      );

      expect(yieldedPath).toContain(customTs);
    });

    it("コールバックに渡されるパスが issue-{number}-{timestamp} のフォーマットになっている", async () => {
      mockedRunCommandSync.mockReturnValue("");
      const issueNumber = 42;

      let yieldedPath = "";
      await withWorktree(
        REPO_PATH,
        issueNumber,
        "main",
        async (path) => { yieldedPath = path; },
        fixedTimestampFn,
      );

      const expectedSuffix = `issue-${issueNumber}-${FIXED_TIMESTAMP}`;
      expect(yieldedPath).toContain(expectedSuffix);

      const expectedPath =
        `/path/to/.sabori-flow-worktrees/issue-${issueNumber}-${FIXED_TIMESTAMP}`;
      expect(yieldedPath).toBe(expectedPath);
    });

    it("作成されるブランチ名に Issue 番号とタイムスタンプが含まれる", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await withWorktree(
        REPO_PATH,
        42,
        "main",
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      const addCall = mockedRunCommandSync.mock.calls[1];
      const args = addCall[1] as string[];
      const expectedBranch = `sabori-flow/42-${FIXED_TIMESTAMP}`;
      expect(args).toContain(expectedBranch);
    });

    it("worktrees ディレクトリが mkdirSync で作成される", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await withWorktree(
        REPO_PATH,
        42,
        "main",
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      expect(mockedMkdirSync).toHaveBeenCalledWith(
        "/path/to/.sabori-flow-worktrees",
        { recursive: true },
      );
    });

    it("コールバックの戻り値を返す", async () => {
      mockedRunCommandSync.mockReturnValue("");

      const result = await withWorktree(
        REPO_PATH,
        42,
        "main",
        async () => "callback result",
        fixedTimestampFn,
      );

      expect(result).toBe("callback result");
    });

    it("git fetch origin が worktree add の前に実行される", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await withWorktree(
        REPO_PATH,
        42,
        "main",
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      expect(mockedRunCommandSync).toHaveBeenCalledTimes(3);

      // 1st call: fetch
      const fetchCall = mockedRunCommandSync.mock.calls[0];
      expect(fetchCall[0]).toBe("git");
      expect(fetchCall[1]).toEqual(
        expect.arrayContaining(["-C", REPO_PATH, "fetch", "origin"]),
      );
    });

    it("worktree add で origin/defaultBranch が起点として指定される", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await withWorktree(
        REPO_PATH,
        42,
        "main",
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      const addCall = mockedRunCommandSync.mock.calls[1];
      const args = addCall[1] as string[];
      expect(args).toContain("origin/main");
    });

    it("defaultBranch が 'develop' の場合に origin/develop が起点として指定される", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await withWorktree(
        REPO_PATH,
        42,
        "develop",
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      const addCall = mockedRunCommandSync.mock.calls[1];
      const args = addCall[1] as string[];
      expect(args).toContain("origin/develop");
    });
  });

  describe("異常系", () => {
    it("worktree 作成の git コマンドが失敗すると WorktreeError が発生する", async () => {
      mockedRunCommandSync
        .mockReturnValueOnce("") // fetch 成功
        .mockImplementation(() => {
          throw new ProcessExecutionError("fatal: branch already exists");
        });

      await expect(
        withWorktree(
          REPO_PATH,
          42,
          "main",
          async () => { /* noop */ },
          fixedTimestampFn,
        ),
      ).rejects.toThrow(WorktreeError);

      mockedRunCommandSync
        .mockReturnValueOnce("") // fetch 成功
        .mockImplementation(() => {
          throw new ProcessExecutionError("fatal: branch already exists");
        });

      await expect(
        withWorktree(
          REPO_PATH,
          42,
          "main",
          async () => { /* noop */ },
          fixedTimestampFn,
        ),
      ).rejects.toThrow("worktree の作成に失敗しました");
    });

    it("コールバック内で例外が発生しても worktree 削除が実行される", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await expect(
        withWorktree(
          REPO_PATH,
          42,
          "main",
          async () => { throw new Error("something went wrong"); },
          fixedTimestampFn,
        ),
      ).rejects.toThrow("something went wrong");

      // 削除コマンド (3回目の呼び出し: fetch + add + remove) が実行されている
      expect(mockedRunCommandSync).toHaveBeenCalledTimes(3);
      const removeCall = mockedRunCommandSync.mock.calls[2];
      expect(removeCall[1]).toContain("remove");
    });

    it("worktree 削除が失敗しても例外は発生せず警告ログのみ出力される", async () => {
      // fetch は成功、add は成功、remove は失敗
      mockedRunCommandSync
        .mockReturnValueOnce("") // fetch 成功
        .mockReturnValueOnce("") // add 成功
        .mockImplementationOnce(() => {
          throw new ProcessExecutionError("remove failed");
        });

      // 例外が発生しないことを確認
      await withWorktree(
        REPO_PATH,
        42,
        "main",
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "worktree の削除に失敗しました: %s",
        expect.stringContaining("issue-42"),
      );
    });

    it("WorktreeError は instanceof で判別できる", async () => {
      mockedRunCommandSync
        .mockReturnValueOnce("") // fetch 成功
        .mockImplementation(() => {
          throw new ProcessExecutionError("git error");
        });

      try {
        await withWorktree(
          REPO_PATH,
          42,
          "main",
          async () => { /* noop */ },
          fixedTimestampFn,
        );
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(WorktreeError);
      }
    });

    it("git fetch origin が失敗した場合に WorktreeError が発生する", async () => {
      // fetch で失敗
      mockedRunCommandSync.mockImplementation(() => {
        throw new ProcessExecutionError("fatal: unable to access remote");
      });

      await expect(
        withWorktree(
          REPO_PATH,
          42,
          "main",
          async () => { /* noop */ },
          fixedTimestampFn,
        ),
      ).rejects.toThrow(WorktreeError);

      await expect(
        withWorktree(
          REPO_PATH,
          42,
          "main",
          async () => { /* noop */ },
          fixedTimestampFn,
        ),
      ).rejects.toThrow("git fetch origin に失敗しました");
    });

    it("git fetch origin が失敗した場合に worktree add は呼ばれない", async () => {
      // fetch で失敗
      mockedRunCommandSync.mockImplementation(() => {
        throw new ProcessExecutionError("fatal: unable to access remote");
      });

      try {
        await withWorktree(
          REPO_PATH,
          42,
          "main",
          async () => { /* noop */ },
          fixedTimestampFn,
        );
      } catch {
        // expected
      }

      // fetch の 1 回だけ呼ばれて、add は呼ばれない
      expect(mockedRunCommandSync).toHaveBeenCalledTimes(1);
      const fetchCall = mockedRunCommandSync.mock.calls[0];
      expect(fetchCall[1]).toEqual(
        expect.arrayContaining(["fetch", "origin"]),
      );
    });
  });
});
