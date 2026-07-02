import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  password: vi.fn(),
}));

vi.mock("../../src/utils/auth-token.js", () => ({
  writeAuthToken: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { password } from "@inquirer/prompts";
import { readFileSync } from "node:fs";
import { writeAuthToken } from "../../src/utils/auth-token.js";
import { t } from "../../src/i18n/index.js";

const mockedPassword = vi.mocked(password);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteAuthToken = vi.mocked(writeAuthToken);

let consoleSpy: {
  log: ReturnType<typeof vi.spyOn>;
  error: ReturnType<typeof vi.spyOn>;
};

beforeEach(() => {
  vi.restoreAllMocks();
  // config が読めないケースで loadLanguageFromConfig を既定言語 (ja) に確定させる
  mockedReadFileSync.mockImplementation(() => {
    throw new Error("no config");
  });
  consoleSpy = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
});

async function runSetTokenCommand(): Promise<void> {
  const { setTokenCommand } = await import("../../src/commands/set-token.js");
  return setTokenCommand();
}

function extractValidate(): (input: string) => string | boolean {
  const options = mockedPassword.mock.calls[0][0];
  return options.validate as (input: string) => string | boolean;
}

describe("setTokenCommand - 正常系", () => {
  it("入力トークンを writeAuthToken に渡し、保存メッセージを出力する", async () => {
    mockedPassword.mockResolvedValue("sk-ant-oat01-example");

    await runSetTokenCommand();

    expect(mockedWriteAuthToken).toHaveBeenCalledWith("sk-ant-oat01-example");
    expect(consoleSpy.log).toHaveBeenCalledWith(t("setToken.saved"));
    expect(consoleSpy.error).not.toHaveBeenCalled();
  });

  it("トークン取得手順の案内を出力する", async () => {
    mockedPassword.mockResolvedValue("sk-ant-oat01-example");

    await runSetTokenCommand();

    expect(consoleSpy.log).toHaveBeenCalledWith(t("setToken.instructions"));
  });
});

describe("setTokenCommand - password の validate", () => {
  beforeEach(() => {
    mockedPassword.mockResolvedValue("sk-ant-oat01-example");
  });

  it("空文字列はエラーメッセージを返す", async () => {
    await runSetTokenCommand();

    expect(extractValidate()("")).toBe(t("setToken.emptyError"));
  });

  it("空白のみはエラーメッセージを返す", async () => {
    await runSetTokenCommand();

    expect(extractValidate()("   ")).toBe(t("setToken.emptyError"));
  });

  it("非空トークンは true を返す", async () => {
    await runSetTokenCommand();

    expect(extractValidate()("sk-ant-oat01-example")).toBe(true);
  });

  it("前後に空白を含む非空トークンは true を返す", async () => {
    await runSetTokenCommand();

    expect(extractValidate()("  sk-ant-oat01-example  ")).toBe(true);
  });
});

describe("setTokenCommand - Ctrl+C", () => {
  it("password が reject された場合、writeAuthToken を呼ばず静かに終了する", async () => {
    mockedPassword.mockRejectedValue(new Error("prompt was closed"));

    await expect(runSetTokenCommand()).resolves.toBeUndefined();

    expect(mockedWriteAuthToken).not.toHaveBeenCalled();
    expect(consoleSpy.log).not.toHaveBeenCalledWith(t("setToken.saved"));
    expect(consoleSpy.error).not.toHaveBeenCalled();
  });
});

describe("setTokenCommand - 書き込み失敗", () => {
  it("writeAuthToken が失敗した場合、エラーを出力し保存メッセージは出さない", async () => {
    mockedPassword.mockResolvedValue("sk-ant-oat01-example");
    mockedWriteAuthToken.mockImplementation(() => {
      throw new Error("EACCES");
    });

    await runSetTokenCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(t("setToken.writeFailed"));
    expect(consoleSpy.log).not.toHaveBeenCalledWith(t("setToken.saved"));
  });
});

describe("setTokenCommand - トークン値の非出力", () => {
  it("成功時の全 console 出力にトークン値が含まれない", async () => {
    const sentinel = `sk-ant-oat01-${"Zx9Qw7Vb3Kd1".repeat(4)}`;
    mockedPassword.mockResolvedValue(sentinel);

    await runSetTokenCommand();

    expect(mockedWriteAuthToken).toHaveBeenCalledWith(sentinel);

    const allOutput = [
      ...consoleSpy.log.mock.calls,
      ...consoleSpy.error.mock.calls,
    ]
      .flat()
      .join("\n");
    expect(allOutput).not.toContain(sentinel);
  });
});
