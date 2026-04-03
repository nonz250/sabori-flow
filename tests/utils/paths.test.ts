import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { expandTilde } from "../../src/utils/paths.js";

describe("expandTilde", () => {
  it("~ 単体は homedir() を返す", () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  it("~/path/to/dir は homedir()/path/to/dir を返す", () => {
    const result = expandTilde("~/path/to/dir");
    expect(result).toBe(`${homedir()}/path/to/dir`);
  });

  it("絶対パスはそのまま返す", () => {
    expect(expandTilde("/absolute/path")).toBe("/absolute/path");
  });

  it("相対パスはそのまま返す", () => {
    expect(expandTilde("relative/path")).toBe("relative/path");
  });
});
