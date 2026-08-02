import { describe, it, expect, vi, beforeEach } from "vitest";
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
  applyLabelTransition,
  LabelError,
} from "../../src/worker/label.js";
import { runCommand } from "../../src/worker/process.js";

const mockedRunCommand = vi.mocked(runCommand);

describe("applyLabelTransition", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("add と remove のラベルで gh issue edit が呼ばれる", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await applyLabelTransition("nonz250/example-app", 42, {
      add: ["claude/plan:in-progress"],
      remove: ["claude/plan"],
    });

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

  it("add のみのラベル操作で --remove-label が含まれない", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await applyLabelTransition("nonz250/example-app", 42, {
      add: ["claude/impl"],
      remove: [],
    });

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
        "claude/impl",
      ],
      { timeoutMs: 120_000 },
    );
  });

  it("done 遷移の add/remove が正しく渡される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await applyLabelTransition("nonz250/example-app", 7, {
      add: ["claude/plan:done"],
      remove: ["claude/plan:in-progress"],
    });

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

  it("failed 遷移の add/remove が正しく渡される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await applyLabelTransition("nonz250/example-app", 15, {
      add: ["claude/plan:failed"],
      remove: ["claude/plan:in-progress"],
    });

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

  it("複数の add ラベルがカンマ区切りで渡される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await applyLabelTransition("nonz250/example-app", 42, {
      add: ["ai/spec/done", "ai/plan"],
      remove: ["ai/spec/review", "ai/spec/approved"],
    });

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
        "ai/spec/done,ai/plan",
        "--remove-label",
        "ai/spec/review,ai/spec/approved",
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
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow(LabelError);
    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow("permission denied");
  });

  it("タイムアウト時に LabelError が throw される", async () => {
    mockedRunCommand.mockRejectedValue(new ProcessTimeoutError(120_000));

    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow(LabelError);
    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow("gh issue edit timed out after 120 seconds");
  });

  it("ProcessExecutionError 時に LabelError が throw される", async () => {
    mockedRunCommand.mockRejectedValue(
      new ProcessExecutionError("spawn gh ENOENT"),
    );

    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow(LabelError);
    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow("spawn gh ENOENT");
  });
});

describe("ラベル自動作成", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("addLabel が存在しない場合、label create → issue edit 再試行が行われる", async () => {
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

    await applyLabelTransition("nonz250/example-app", 42, {
      add: ["claude/plan:in-progress"],
      remove: ["claude/plan"],
    });

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

  it("複数の add ラベルが存在しない場合、全 add ラベルの create が試行される", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "'ai/spec/done' not found",
    });
    // label create for ai/spec/done
    mockedRunCommand.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
    });
    // label create for ai/plan
    mockedRunCommand.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
    });
    // retry gh issue edit
    mockedRunCommand.mockResolvedValueOnce({
      success: true,
      stdout: "",
      stderr: "",
    });

    await applyLabelTransition("nonz250/example-app", 42, {
      add: ["ai/spec/done", "ai/plan"],
      remove: ["ai/spec/review"],
    });

    expect(mockedRunCommand).toHaveBeenCalledTimes(4);
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      2,
      "gh",
      ["label", "create", "ai/spec/done", "--repo", "nonz250/example-app"],
      { timeoutMs: 120_000 },
    );
    expect(mockedRunCommand).toHaveBeenNthCalledWith(
      3,
      "gh",
      ["label", "create", "ai/plan", "--repo", "nonz250/example-app"],
      { timeoutMs: 120_000 },
    );
  });

  it("label create が already exists を返した場合も成功する", async () => {
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

    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).resolves.toBeUndefined();
  });

  it("label create が別のエラーを返した場合は LabelError が throw される", async () => {
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

    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow(LabelError);
    expect(mockedRunCommand).toHaveBeenCalledTimes(2);
  });

  it("再試行の issue edit が失敗した場合は LabelError が throw される", async () => {
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

    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow(LabelError);
  });

  it("label create 中に ProcessTimeoutError が発生した場合は LabelError が throw される", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "failed to update https://github.com/nonz250/example-app/issues/42: 'claude/plan:in-progress' not found\nfailed to update 1 issue",
    });
    mockedRunCommand.mockRejectedValueOnce(new ProcessTimeoutError(120_000));

    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow(LabelError);
  });

  it("ラベル未存在でない通常のエラーではリトライしない", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "permission denied",
    });

    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow(LabelError);
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });

  it("label create 中に ProcessTimeoutError が発生した場合のエラーメッセージが正しい", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "failed to update https://github.com/nonz250/example-app/issues/42: 'claude/plan:in-progress' not found\nfailed to update 1 issue",
    });
    mockedRunCommand.mockRejectedValueOnce(new ProcessTimeoutError(120_000));

    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow("gh issue edit timed out after 120 seconds");
  });

  it("label create 中に ProcessExecutionError が発生した場合は LabelError が throw される", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "failed to update https://github.com/nonz250/example-app/issues/42: 'claude/plan:in-progress' not found\nfailed to update 1 issue",
    });
    mockedRunCommand.mockRejectedValueOnce(
      new ProcessExecutionError("spawn gh ENOENT"),
    );

    const promise = applyLabelTransition("nonz250/example-app", 42, {
      add: ["claude/plan:in-progress"],
      remove: ["claude/plan"],
    });
    await expect(promise).rejects.toThrow(LabelError);
    await expect(promise).rejects.toThrow("spawn gh ENOENT");
  });

  it("label create が already exists を返した後の再試行が失敗した場合は LabelError が throw される", async () => {
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

    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow(LabelError);
  });

  it("not found を含むがラベル名を含まないエラーではリトライしない", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "repository not found",
    });

    await expect(
      applyLabelTransition("nonz250/example-app", 42, {
        add: ["claude/plan:in-progress"],
        remove: ["claude/plan"],
      }),
    ).rejects.toThrow(LabelError);
    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });
});
