import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(() => "/mock/home"),
  };
});

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
import { makeRepoConfig } from "./helpers/factories.js";

const mockedRunCommandSync = vi.mocked(runCommandSync);
const mockedMkdirSync = vi.mocked(mkdirSync);

const FIXED_TIMESTAMP = "20260331100000";
const OWNER = "testowner";
const REPO = "testrepo";
const REPO_LOCAL_PATH = "/path/to/repo";
const DEFAULT_BRANCH = "main";
const ISSUE_NUMBER = 42;

const WORKTREES_BASE = path.join(
  "/mock/home",
  ".sabori-flow",
  "worktrees",
);
const REPO_DIR = path.join(WORKTREES_BASE, OWNER, REPO);

function fixedTimestampFn(): string {
  return FIXED_TIMESTAMP;
}

function makeRepoArg(overrides?: {
  owner?: string;
  repo?: string;
  localPath?: string;
  defaultBranch?: string;
}) {
  return makeRepoConfig({
    owner: overrides?.owner ?? OWNER,
    repo: overrides?.repo ?? REPO,
    localPath: overrides?.localPath ?? REPO_LOCAL_PATH,
    defaultBranch: overrides?.defaultBranch ?? DEFAULT_BRANCH,
  });
}

describe("withWorktree", () => {
  beforeEach(() => {
    // clearAllMocks (vitest.config の clearMocks: true 含む) は mock.calls を
    // 初期化するが、mockImplementation で設定した実装は保持されてしまう。
    // 各テストが独立した実装をセットアップできるよう、明示的に reset する。
    mockedRunCommandSync.mockReset();
    mockedMkdirSync.mockReset();
    mockLogger.warn.mockReset();
  });

  describe("正常系", () => {
    it("worktree が作成され、コールバック実行後に削除される", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await withWorktree(
        makeRepoArg(),
        ISSUE_NUMBER,
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
        makeRepoArg(),
        7,
        async (worktreePath) => { yieldedPath = worktreePath; },
        () => customTs,
      );

      expect(yieldedPath).toContain(customTs);
      expect(yieldedPath).toBe(
        path.join(WORKTREES_BASE, OWNER, REPO, `issue-7-${customTs}`),
      );
    });

    it("コールバックに渡されるパスが ~/.sabori-flow/worktrees/<owner>/<repo>/issue-{n}-{ts} のフォーマットになっている", async () => {
      mockedRunCommandSync.mockReturnValue("");

      let yieldedPath = "";
      await withWorktree(
        makeRepoArg(),
        ISSUE_NUMBER,
        async (worktreePath) => { yieldedPath = worktreePath; },
        fixedTimestampFn,
      );

      const expectedPath = path.join(
        WORKTREES_BASE,
        OWNER,
        REPO,
        `issue-${ISSUE_NUMBER}-${FIXED_TIMESTAMP}`,
      );
      expect(yieldedPath).toBe(expectedPath);
    });

    it("作成されるブランチ名に Issue 番号とタイムスタンプが含まれる", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await withWorktree(
        makeRepoArg(),
        ISSUE_NUMBER,
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      const addCall = mockedRunCommandSync.mock.calls[1];
      const args = addCall[1] as string[];
      const expectedBranch = `sabori-flow/${ISSUE_NUMBER}-${FIXED_TIMESTAMP}`;
      expect(args).toContain(expectedBranch);
    });

    it("worktrees ベース配下の <owner>/<repo> ディレクトリが mkdirSync で recursive + mode 0o700 で作成される", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await withWorktree(
        makeRepoArg(),
        ISSUE_NUMBER,
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      expect(mockedMkdirSync).toHaveBeenCalledWith(
        REPO_DIR,
        { recursive: true, mode: 0o700 },
      );
    });

    it("コールバックの戻り値を返す", async () => {
      mockedRunCommandSync.mockReturnValue("");

      const result = await withWorktree(
        makeRepoArg(),
        ISSUE_NUMBER,
        async () => "callback result",
        fixedTimestampFn,
      );

      expect(result).toBe("callback result");
    });

    it("実行順序が fetch -> mkdirSync -> worktree add になっている", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await withWorktree(
        makeRepoArg(),
        ISSUE_NUMBER,
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      const fetchOrder = mockedRunCommandSync.mock.invocationCallOrder[0];
      const mkdirOrder = mockedMkdirSync.mock.invocationCallOrder[0];
      const addOrder = mockedRunCommandSync.mock.invocationCallOrder[1];

      expect(fetchOrder).toBeLessThan(mkdirOrder);
      expect(mkdirOrder).toBeLessThan(addOrder);

      // 1st runCommandSync = fetch origin
      expect(mockedRunCommandSync.mock.calls[0][1]).toEqual(
        expect.arrayContaining(["-C", REPO_LOCAL_PATH, "fetch", "origin"]),
      );
    });

    it("defaultBranch が 'develop' の場合に origin/develop が起点として指定される", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await withWorktree(
        makeRepoArg({ defaultBranch: "develop" }),
        ISSUE_NUMBER,
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      const addCall = mockedRunCommandSync.mock.calls[1];
      const args = addCall[1] as string[];
      expect(args).toContain("origin/develop");
    });
  });

  describe("異常系", () => {
    it("worktree 作成の git コマンドが失敗すると WorktreeError(phase='create') が発生する", async () => {
      mockedRunCommandSync
        .mockReturnValueOnce("") // fetch 成功
        .mockImplementation(() => {
          throw new ProcessExecutionError("fatal: branch already exists");
        });

      try {
        await withWorktree(
          makeRepoArg(),
          ISSUE_NUMBER,
          async () => { /* noop */ },
          fixedTimestampFn,
        );
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(WorktreeError);
        expect((error as WorktreeError).phase).toBe("create");
        expect((error as WorktreeError).message).toContain(
          "worktree の作成に失敗しました",
        );
      }
    });

    it("mkdirSync が失敗すると WorktreeError(phase='mkdir') が発生し、worktree add は呼ばれない", async () => {
      mockedRunCommandSync.mockReturnValue("");
      mockedMkdirSync.mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      try {
        await withWorktree(
          makeRepoArg(),
          ISSUE_NUMBER,
          async () => { /* noop */ },
          fixedTimestampFn,
        );
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(WorktreeError);
        expect((error as WorktreeError).phase).toBe("mkdir");
        expect((error as WorktreeError).message).toContain(
          "worktree ディレクトリの作成に失敗しました",
        );
        expect((error as WorktreeError).message).toContain(REPO_DIR);
        expect((error as WorktreeError).message).toContain(
          "EACCES: permission denied",
        );
      }

      // fetch は呼ばれるが、worktree add は呼ばれない
      expect(mockedRunCommandSync).toHaveBeenCalledTimes(1);
      const onlyCall = mockedRunCommandSync.mock.calls[0];
      expect(onlyCall[1]).toEqual(
        expect.arrayContaining(["fetch", "origin"]),
      );
    });

    it("コールバック内で例外が発生しても worktree 削除が実行される", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await expect(
        withWorktree(
          makeRepoArg(),
          ISSUE_NUMBER,
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
        makeRepoArg(),
        ISSUE_NUMBER,
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "worktree の削除に失敗しました: %s",
        expect.stringContaining(`issue-${ISSUE_NUMBER}`),
      );
    });

    it("git fetch origin が失敗した場合に WorktreeError(phase='fetch') が発生し、mkdirSync も worktree add も呼ばれない", async () => {
      mockedRunCommandSync.mockImplementation(() => {
        throw new ProcessExecutionError("fatal: unable to access remote");
      });

      try {
        await withWorktree(
          makeRepoArg(),
          ISSUE_NUMBER,
          async () => { /* noop */ },
          fixedTimestampFn,
        );
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(WorktreeError);
        expect((error as WorktreeError).phase).toBe("fetch");
        expect((error as WorktreeError).message).toContain(
          "git fetch origin に失敗しました",
        );
      }

      // fetch の 1 回だけ呼ばれる
      expect(mockedRunCommandSync).toHaveBeenCalledTimes(1);
      const fetchCall = mockedRunCommandSync.mock.calls[0];
      expect(fetchCall[1]).toEqual(
        expect.arrayContaining(["fetch", "origin"]),
      );
      // mkdirSync は呼ばれない
      expect(mockedMkdirSync).not.toHaveBeenCalled();
    });

    it("git worktree remove の引数は worktreePath のみで、worktrees ベース・<owner>/<repo>/ ディレクトリは含めない", async () => {
      mockedRunCommandSync.mockReturnValue("");

      await withWorktree(
        makeRepoArg(),
        ISSUE_NUMBER,
        async () => { /* noop */ },
        fixedTimestampFn,
      );

      const expectedWorktreePath = path.join(
        WORKTREES_BASE,
        OWNER,
        REPO,
        `issue-${ISSUE_NUMBER}-${FIXED_TIMESTAMP}`,
      );
      const removeCall = mockedRunCommandSync.mock.calls[2];
      const removeArgs = removeCall[1] as string[];

      // git worktree remove は対象 worktreePath のみを受け取る
      expect(removeArgs).toContain("remove");
      expect(removeArgs).toContain(expectedWorktreePath);

      // 共有される <owner>/<repo>/ ディレクトリやベースは引数として渡されない
      expect(removeArgs).not.toContain(REPO_DIR);
      expect(removeArgs).not.toContain(WORKTREES_BASE);
    });
  });
});
