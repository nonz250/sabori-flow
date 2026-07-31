import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ProcessTimeoutError,
  ProcessExecutionError,
} from "../../src/worker/process.js";

vi.mock("../../src/worker/process.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/worker/process.js")>();
  return {
    ...original,
    runCommand: vi.fn(),
  };
});

import {
  fetchLinkedPullRequestNumbers,
  LinkedPullRequestError,
  EMPTY_RESULT_RETRY_DELAY_MS,
} from "../../src/worker/linked-pr.js";
import { runCommand } from "../../src/worker/process.js";

const mockedRunCommand = vi.mocked(runCommand);

describe("fetchLinkedPullRequestNumbers", () => {
  beforeEach(() => {
    mockedRunCommand.mockReset();
  });

  it("gh issue view を正しい引数とタイムアウトで呼ぶ", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      success: true,
      stdout: JSON.stringify({
        closedByPullRequestsReferences: [{ number: 123 }],
      }),
      stderr: "",
    });

    await fetchLinkedPullRequestNumbers("nonz250/example-app", 42);

    expect(mockedRunCommand).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "view",
        "42",
        "--repo",
        "nonz250/example-app",
        "--json",
        "closedByPullRequestsReferences",
      ],
      { timeoutMs: 120_000 },
    );
  });

  it("PR が 1 件紐づく場合はリトライせず配列を返す", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      success: true,
      stdout: JSON.stringify({
        closedByPullRequestsReferences: [{ number: 123 }],
      }),
      stderr: "",
    });

    const result = await fetchLinkedPullRequestNumbers(
      "nonz250/example-app",
      42,
    );

    expect(result).toEqual([123]);
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });

  it("複数の PR が紐づく場合は全番号を含む配列を返す", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      success: true,
      stdout: JSON.stringify({
        closedByPullRequestsReferences: [
          { number: 100 },
          { number: 200 },
          { number: 300 },
        ],
      }),
      stderr: "",
    });

    const result = await fetchLinkedPullRequestNumbers(
      "nonz250/example-app",
      42,
    );

    expect(result).toEqual([100, 200, 300]);
  });

  describe("空結果のリトライ", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("1 回目が空でも遅延後の再問い合わせで PR を検出できる", async () => {
      mockedRunCommand.mockResolvedValueOnce({
        success: true,
        stdout: JSON.stringify({ closedByPullRequestsReferences: [] }),
        stderr: "",
      });
      mockedRunCommand.mockResolvedValueOnce({
        success: true,
        stdout: JSON.stringify({
          closedByPullRequestsReferences: [{ number: 123 }],
        }),
        stderr: "",
      });

      const promise = fetchLinkedPullRequestNumbers(
        "nonz250/example-app",
        42,
      );
      await vi.advanceTimersByTimeAsync(EMPTY_RESULT_RETRY_DELAY_MS);
      const result = await promise;

      expect(result).toEqual([123]);
      expect(mockedRunCommand).toHaveBeenCalledTimes(2);
    });

    it("2 回目も空なら空配列を返し 3 回目は呼ばない", async () => {
      mockedRunCommand.mockResolvedValueOnce({
        success: true,
        stdout: JSON.stringify({ closedByPullRequestsReferences: [] }),
        stderr: "",
      });
      mockedRunCommand.mockResolvedValueOnce({
        success: true,
        stdout: JSON.stringify({ closedByPullRequestsReferences: [] }),
        stderr: "",
      });

      const promise = fetchLinkedPullRequestNumbers(
        "nonz250/example-app",
        42,
      );
      await vi.advanceTimersByTimeAsync(EMPTY_RESULT_RETRY_DELAY_MS);
      const result = await promise;

      expect(result).toEqual([]);
      expect(mockedRunCommand).toHaveBeenCalledTimes(2);
    });

    it("1 回目が空で 2 回目が throw した場合 LinkedPullRequestError が伝播する", async () => {
      mockedRunCommand.mockResolvedValueOnce({
        success: true,
        stdout: JSON.stringify({ closedByPullRequestsReferences: [] }),
        stderr: "",
      });
      mockedRunCommand.mockRejectedValueOnce(new ProcessTimeoutError(120_000));

      const promise = fetchLinkedPullRequestNumbers(
        "nonz250/example-app",
        42,
      );
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(EMPTY_RESULT_RETRY_DELAY_MS);

      await expect(promise).rejects.toThrow(LinkedPullRequestError);
    });
  });

  it("gh が非 0 終了コードを返した場合 LinkedPullRequestError が stderr を含んで throw されリトライしない", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "issue not found",
    });

    const promise = fetchLinkedPullRequestNumbers("nonz250/example-app", 42);
    await expect(promise).rejects.toThrow(LinkedPullRequestError);
    await expect(promise).rejects.toThrow("issue not found");
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });

  it("ProcessTimeoutError は LinkedPullRequestError に変換されタイムアウト秒数を含む", async () => {
    mockedRunCommand.mockRejectedValueOnce(new ProcessTimeoutError(120_000));

    const promise = fetchLinkedPullRequestNumbers("nonz250/example-app", 42);
    await expect(promise).rejects.toThrow(LinkedPullRequestError);
    await expect(promise).rejects.toThrow(
      "gh issue view timed out after 120 seconds",
    );
  });

  it("ProcessExecutionError は LinkedPullRequestError に変換され元メッセージを含む", async () => {
    mockedRunCommand.mockRejectedValueOnce(
      new ProcessExecutionError("spawn gh ENOENT"),
    );

    const promise = fetchLinkedPullRequestNumbers("nonz250/example-app", 42);
    await expect(promise).rejects.toThrow(LinkedPullRequestError);
    await expect(promise).rejects.toThrow("spawn gh ENOENT");
  });

  it("不正な JSON の場合 LinkedPullRequestError が throw される", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      success: true,
      stdout: "not valid json",
      stderr: "",
    });

    await expect(
      fetchLinkedPullRequestNumbers("nonz250/example-app", 42),
    ).rejects.toThrow(LinkedPullRequestError);
  });

  it("closedByPullRequestsReferences が欠損している場合 LinkedPullRequestError が throw され空配列に化けない", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      success: true,
      stdout: JSON.stringify({ someOtherField: "value" }),
      stderr: "",
    });

    await expect(
      fetchLinkedPullRequestNumbers("nonz250/example-app", 42),
    ).rejects.toThrow(LinkedPullRequestError);
  });

  it.each([
    ["null", "null"],
    ["a JSON array", "[1,2,3]"],
    ["a scalar", "42"],
  ])(
    "JSON root が %s の場合 LinkedPullRequestError が throw される",
    async (_label, json) => {
      mockedRunCommand.mockResolvedValueOnce({
        success: true,
        stdout: json,
        stderr: "",
      });

      await expect(
        fetchLinkedPullRequestNumbers("nonz250/example-app", 42),
      ).rejects.toThrow(LinkedPullRequestError);
    },
  );
});
