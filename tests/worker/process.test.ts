import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

vi.mock("node:child_process");

import {
  runCommand,
  runCommandSync,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "../../src/worker/process.js";
import { spawn, execFileSync } from "node:child_process";

const mockedSpawn = vi.mocked(spawn);
const mockedExecFileSync = vi.mocked(execFileSync);

function createMockChildProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdin = new EventEmitter() as ChildProcess["stdin"];
  child.stdin!.write = vi.fn().mockReturnValue(true);
  child.stdin!.end = vi.fn();
  child.stdout = new EventEmitter() as ChildProcess["stdout"];
  child.stderr = new EventEmitter() as ChildProcess["stderr"];
  child.pid = 12345;
  child.kill = vi.fn().mockReturnValue(true);
  return child;
}

describe("runCommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  it("exit code 0 で success=true, stdout/stderr を返す", async () => {
    const child = createMockChildProcess();
    mockedSpawn.mockReturnValue(child);

    const promise = runCommand("echo", ["hello"]);

    child.stdout!.emit("data", Buffer.from("hello world"));
    child.stderr!.emit("data", Buffer.from("some warning"));
    child.emit("close", 0);

    const result = await promise;
    expect(result).toEqual({
      success: true,
      stdout: "hello world",
      stderr: "some warning",
    });
    expect(mockedSpawn).toHaveBeenCalledWith("echo", ["hello"], {
      cwd: undefined,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
  });

  it("exit code 非0 で success=false, stdout/stderr を返す", async () => {
    const child = createMockChildProcess();
    mockedSpawn.mockReturnValue(child);

    const promise = runCommand("failing-cmd", ["--flag"]);

    child.stdout!.emit("data", Buffer.from("partial output"));
    child.stderr!.emit("data", Buffer.from("error details"));
    child.emit("close", 1);

    const result = await promise;
    expect(result).toEqual({
      success: false,
      stdout: "partial output",
      stderr: "error details",
    });
  });

  it("タイムアウト時に ProcessTimeoutError を throw する", async () => {
    const child = createMockChildProcess();
    mockedSpawn.mockReturnValue(child);

    const mockKill = vi
      .spyOn(process, "kill")
      .mockImplementation(() => true);

    const promise = runCommand("slow-cmd", [], { timeoutMs: 5_000 });

    // タイムアウトを発火させる
    vi.advanceTimersByTime(5_000);

    // SIGTERM 後にプロセスが close するシナリオ
    child.emit("close", null);

    await expect(promise).rejects.toThrow(ProcessTimeoutError);
    await expect(promise).rejects.toThrow("Process timed out after 5000ms");

    expect(mockKill).toHaveBeenCalledWith(-12345, "SIGTERM");

    mockKill.mockRestore();
  });

  it("コマンドが見つからない場合に ProcessExecutionError を throw する", async () => {
    const child = createMockChildProcess();
    mockedSpawn.mockReturnValue(child);

    const promise = runCommand("nonexistent-command", []);

    child.emit("error", new Error("spawn nonexistent-command ENOENT"));

    await expect(promise).rejects.toThrow(ProcessExecutionError);
    await expect(promise).rejects.toThrow("spawn nonexistent-command ENOENT");
  });

  it("input オプションで stdin にデータが渡される", async () => {
    const child = createMockChildProcess();
    mockedSpawn.mockReturnValue(child);

    const promise = runCommand("cat", [], { input: "stdin data" });

    child.stdout!.emit("data", Buffer.from("stdin data"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("stdin data");
    expect(child.stdin!.write).toHaveBeenCalledWith("stdin data");
    expect(child.stdin!.end).toHaveBeenCalled();
  });
});

describe("runCommandSync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("正常終了時に stdout を trim して返す", () => {
    mockedExecFileSync.mockReturnValue("  output with spaces  \n");

    const result = runCommandSync("echo", ["hello"]);

    expect(result).toBe("output with spaces");
    expect(mockedExecFileSync).toHaveBeenCalledWith("echo", ["hello"], {
      cwd: undefined,
      timeout: 30_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  it("異常終了時に ProcessExecutionError を throw する", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("Command failed: exit code 1");
    });

    expect(() => runCommandSync("failing-cmd", ["--flag"])).toThrow(
      ProcessExecutionError,
    );
    expect(() => runCommandSync("failing-cmd", ["--flag"])).toThrow(
      "Command failed: exit code 1",
    );
  });
});
