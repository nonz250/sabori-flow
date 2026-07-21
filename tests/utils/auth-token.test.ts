import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
  },
}));

vi.mock("../../src/utils/paths.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/utils/paths.js")>();
  return {
    ...original,
    getBaseDir: vi.fn().mockReturnValue("/mock/data"),
    getAuthTokenPath: vi.fn().mockReturnValue("/mock/data/auth-token"),
  };
});

import fs from "fs";
import { readAuthToken, writeAuthToken } from "../../src/utils/auth-token.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readAuthToken", () => {
  it("トークンを trim して返す", () => {
    mockedFs.readFileSync.mockReturnValue("  sk-ant-oat01-example  \n");

    expect(readAuthToken()).toBe("sk-ant-oat01-example");
  });

  it("ファイルが存在しない (ENOENT) 場合 null を返す", () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error("no such file"), { code: "ENOENT" });
    });

    expect(readAuthToken()).toBeNull();
  });

  it("読み取り不能な場合 null を返す", () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });

    expect(readAuthToken()).toBeNull();
  });

  it("空文字列の場合 null を返す", () => {
    mockedFs.readFileSync.mockReturnValue("");

    expect(readAuthToken()).toBeNull();
  });

  it("空白のみの場合 null を返す", () => {
    mockedFs.readFileSync.mockReturnValue("   \n\t  ");

    expect(readAuthToken()).toBeNull();
  });
});

describe("writeAuthToken", () => {
  it("baseDir を mode 0o700 で作成する", () => {
    writeAuthToken("token");

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith("/mock/data", {
      recursive: true,
      mode: 0o700,
    });
  });

  it("auth-token ファイルに mode 0o600 で書き込む", () => {
    writeAuthToken("token");

    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      "/mock/data/auth-token",
      "token",
      { encoding: "utf-8", mode: 0o600 },
    );
  });

  it("書き込み後に chmodSync(path, 0o600) を呼ぶ", () => {
    writeAuthToken("token");

    expect(mockedFs.chmodSync).toHaveBeenCalledWith(
      "/mock/data/auth-token",
      0o600,
    );
  });

  it("入力トークンを trim して書き込む", () => {
    writeAuthToken("  spaced-token  \n");

    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      "/mock/data/auth-token",
      "spaced-token",
      { encoding: "utf-8", mode: 0o600 },
    );
  });
});
