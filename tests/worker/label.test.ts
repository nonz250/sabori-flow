import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PhaseLabels } from "../../src/worker/models.js";
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
  transitionToInProgress,
  transitionToDone,
  transitionToFailed,
  LabelError,
} from "../../src/worker/label.js";
import { runCommand } from "../../src/worker/process.js";

const mockedRunCommand = vi.mocked(runCommand);

const phaseLabels: PhaseLabels = {
  trigger: "claude/plan",
  inProgress: "claude/plan:in-progress",
  done: "claude/plan:done",
  failed: "claude/plan:failed",
};

describe("transitionToInProgress", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("trigger ラベルを削除し in_progress ラベルを追加する gh issue edit が呼ばれる", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await transitionToInProgress("nonz250/example-app", 42, phaseLabels);

    expect(mockedRunCommand).toHaveBeenCalledOnce();
    expect(mockedRunCommand).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "edit",
        "--repo",
        "nonz250/example-app",
        "42",
        "--add-label",
        "claude/plan:in-progress",
        "--remove-label",
        "claude/plan",
      ],
      { timeoutMs: 120_000 },
    );
  });

  it("gh コマンドが非0終了コードを返した場合 LabelError が throw される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "label not found",
    });

    await expect(
      transitionToInProgress("nonz250/example-app", 42, phaseLabels),
    ).rejects.toThrow(LabelError);
    await expect(
      transitionToInProgress("nonz250/example-app", 42, phaseLabels),
    ).rejects.toThrow("label not found");
  });

  it("タイムアウト時に LabelError が throw される", async () => {
    mockedRunCommand.mockRejectedValue(new ProcessTimeoutError(120_000));

    await expect(
      transitionToInProgress("nonz250/example-app", 42, phaseLabels),
    ).rejects.toThrow(LabelError);
    await expect(
      transitionToInProgress("nonz250/example-app", 42, phaseLabels),
    ).rejects.toThrow("gh issue edit timed out after 120 seconds");
  });
});

describe("transitionToDone", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("in_progress ラベルを削除し done ラベルを追加する gh issue edit が呼ばれる", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await transitionToDone("nonz250/example-app", 7, phaseLabels);

    expect(mockedRunCommand).toHaveBeenCalledOnce();
    expect(mockedRunCommand).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "edit",
        "--repo",
        "nonz250/example-app",
        "7",
        "--add-label",
        "claude/plan:done",
        "--remove-label",
        "claude/plan:in-progress",
      ],
      { timeoutMs: 120_000 },
    );
  });

  it("gh コマンドが非0終了コードを返した場合 LabelError が throw される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "permission denied",
    });

    await expect(
      transitionToDone("nonz250/example-app", 7, phaseLabels),
    ).rejects.toThrow(LabelError);
    await expect(
      transitionToDone("nonz250/example-app", 7, phaseLabels),
    ).rejects.toThrow("permission denied");
  });
});

describe("transitionToFailed", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("in_progress ラベルを削除し failed ラベルを追加する gh issue edit が呼ばれる", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await transitionToFailed("nonz250/example-app", 15, phaseLabels);

    expect(mockedRunCommand).toHaveBeenCalledOnce();
    expect(mockedRunCommand).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "edit",
        "--repo",
        "nonz250/example-app",
        "15",
        "--add-label",
        "claude/plan:failed",
        "--remove-label",
        "claude/plan:in-progress",
      ],
      { timeoutMs: 120_000 },
    );
  });

  it("gh コマンドが非0終了コードを返した場合 LabelError が throw される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "network error",
    });

    await expect(
      transitionToFailed("nonz250/example-app", 15, phaseLabels),
    ).rejects.toThrow(LabelError);
    await expect(
      transitionToFailed("nonz250/example-app", 15, phaseLabels),
    ).rejects.toThrow("network error");
  });
});

describe("ラベル自動作成", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("addLabel が存在しない場合、label create → issue edit 再試行が行われる", async () => {
    // Arrange
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "failed to update https://github.com/nonz250/example-app/issues/42: 'claude/plan:in-progress' not found\nfailed to update 1 issue",
    });
    mockedRunCommand.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
    });
    mockedRunCommand.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
    });

    // Act
    await transitionToInProgress("nonz250/example-app", 42, phaseLabels);

    // Assert
    expect(mockedRunCommand).toHaveBeenCalledTimes(3);
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      2,
      "gh",
      [
        "label",
        "create",
        "claude/plan:in-progress",
        "--repo",
        "nonz250/example-app",
      ],
      { timeoutMs: 120_000 },
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      3,
      "gh",
      [
        "issue",
        "edit",
        "--repo",
        "nonz250/example-app",
        "42",
        "--add-label",
        "claude/plan:in-progress",
        "--remove-label",
        "claude/plan",
      ],
      { timeoutMs: 120_000 },
    );
  });

  it("label create が already exists を返した場合も成功する", async () => {
    // Arrange
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "failed to update https://github.com/nonz250/example-app/issues/42: 'claude/plan:in-progress' not found\nfailed to update 1 issue",
    });
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "label already exists",
    });
    mockedRunCommand.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
    });

    // Act & Assert
    await expect(
      transitionToInProgress("nonz250/example-app", 42, phaseLabels),
    ).resolves.toBeUndefined();
  });

  it("label create が別のエラーを返した場合は LabelError が throw される", async () => {
    // Arrange
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "failed to update https://github.com/nonz250/example-app/issues/42: 'claude/plan:in-progress' not found\nfailed to update 1 issue",
    });
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "HTTP 403: permission denied",
    });

    // Act & Assert
    await expect(
      transitionToInProgress("nonz250/example-app", 42, phaseLabels),
    ).rejects.toThrow(LabelError);
    expect(mockedRunCommand).toHaveBeenCalledTimes(2);
  });

  it("再試行の issue edit が失敗した場合は LabelError が throw される", async () => {
    // Arrange
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "failed to update https://github.com/nonz250/example-app/issues/42: 'claude/plan:in-progress' not found\nfailed to update 1 issue",
    });
    mockedRunCommand.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
    });
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "network error",
    });

    // Act & Assert
    await expect(
      transitionToInProgress("nonz250/example-app", 42, phaseLabels),
    ).rejects.toThrow(LabelError);
  });

  it("label create 中に ProcessTimeoutError が発生した場合は LabelError が throw される", async () => {
    // Arrange
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "failed to update https://github.com/nonz250/example-app/issues/42: 'claude/plan:in-progress' not found\nfailed to update 1 issue",
    });
    mockedRunCommand.mockRejectedValueOnce(new ProcessTimeoutError(120_000));

    // Act & Assert
    await expect(
      transitionToInProgress("nonz250/example-app", 42, phaseLabels),
    ).rejects.toThrow(LabelError);
  });

  it("ラベル未存在でない通常のエラーではリトライしない", async () => {
    // Arrange
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "permission denied",
    });

    // Act & Assert
    await expect(
      transitionToInProgress("nonz250/example-app", 42, phaseLabels),
    ).rejects.toThrow(LabelError);
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });

  it("label create 中に ProcessTimeoutError が発生した場合のエラーメッセージが正しい", async () => {
    // Arrange
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "failed to update https://github.com/nonz250/example-app/issues/42: 'claude/plan:in-progress' not found\nfailed to update 1 issue",
    });
    mockedRunCommand.mockRejectedValueOnce(new ProcessTimeoutError(120_000));

    // Act & Assert
    await expect(
      transitionToInProgress("nonz250/example-app", 42, phaseLabels),
    ).rejects.toThrow("gh issue edit timed out after 120 seconds");
  });

  it("label create 中に ProcessExecutionError が発生した場合は LabelError が throw される", async () => {
    // Arrange
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "failed to update https://github.com/nonz250/example-app/issues/42: 'claude/plan:in-progress' not found\nfailed to update 1 issue",
    });
    mockedRunCommand.mockRejectedValueOnce(
      new ProcessExecutionError("spawn gh ENOENT"),
    );

    // Act & Assert
    const promise = transitionToInProgress(
      "nonz250/example-app",
      42,
      phaseLabels,
    );
    await expect(promise).rejects.toThrow(LabelError);
    await expect(promise).rejects.toThrow("spawn gh ENOENT");
  });

  it("label create が already exists を返した後の再試行が失敗した場合は LabelError が throw される", async () => {
    // Arrange
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "failed to update https://github.com/nonz250/example-app/issues/42: 'claude/plan:in-progress' not found\nfailed to update 1 issue",
    });
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "label already exists",
    });
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "unexpected error",
    });

    // Act & Assert
    await expect(
      transitionToInProgress("nonz250/example-app", 42, phaseLabels),
    ).rejects.toThrow(LabelError);
  });

  it("not found を含むがラベル名を含まないエラーではリトライしない", async () => {
    // Arrange: "repository not found" のようなエラー
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "repository not found",
    });

    // Act & Assert
    await expect(
      transitionToInProgress("nonz250/example-app", 42, phaseLabels),
    ).rejects.toThrow(LabelError);
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });
});
