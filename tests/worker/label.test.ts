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
