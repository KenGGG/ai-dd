import assert from "node:assert/strict";
import test from "node:test";
import { PythonExecutor } from "../server/python_executor";

test("PythonExecutor - normal exit returns result", async () => {
  const executor = new PythonExecutor((_script: string, args: string[]) => [
    process.execPath,
    "-e",
    args[0],
  ]);

  const result = await executor.execute(
    "ignored",
    [`console.log("test output");`],
    { timeoutMs: 2000 },
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /test output/);
  assert.ok(result.elapsedTimeMs >= 0);
});

test("PythonExecutor - non-zero exit rejects with error", async () => {
  const executor = new PythonExecutor((_script: string, args: string[]) => [
    process.execPath,
    "-e",
    args[0],
  ]);

  await assert.rejects(
    async () => await executor.execute(
      "ignored",
      [`console.error("error output"); process.exit(3);`],
      { timeoutMs: 2000 },
    ),
    /exited with code 3/,
  );
});

test("PythonExecutor - timeout kills process and rejects", async () => {
  const executor = new PythonExecutor((_script: string, args: string[]) => [
    process.execPath,
    "-e",
    args[0],
  ]);

  await assert.rejects(
    async () => await executor.execute(
      "ignored",
      [`setTimeout(() => {}, 10000);`],
      { timeoutMs: 100 },
    ),
    /timed out/,
  );

  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(executor.getActiveProcesses().length, 0);
});

test("PythonExecutor - cancellation via AbortController works", async () => {
  const executor = new PythonExecutor((_script: string, args: string[]) => [
    process.execPath,
    "-e",
    args[0],
  ]);

  const controller = new AbortController();

  const runPromise = executor.execute(
    "ignored",
    [`setTimeout(() => {}, 10000);`],
    {
      timeoutMs: 5000,
      signal: controller.signal,
    },
  );

  // Abort shortly after start, before the 5s timeout can fire.
  setTimeout(() => controller.abort(), 200);

  await assert.rejects(runPromise, /cancelled/);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(executor.getActiveProcesses().length, 0);
});

test("PythonExecutor - no unhandled rejections after timeout", async () => {
  const unhandledRejections: any[] = [];
  process.on("unhandledRejection", (reason: any) => {
    unhandledRejections.push(reason);
  });

  const executor = new PythonExecutor((_script: string, args: string[]) => [
    process.execPath,
    "-e",
    args[0],
  ]);

  await assert.rejects(
    async () => await executor.execute(
      "ignored",
      [`setTimeout(() => {}, 10000);`],
      { timeoutMs: 100 },
    ),
    /timed out/,
  );

  await new Promise((resolve) => setTimeout(resolve, 3000));
  assert.equal(unhandledRejections.length, 0, `Unhandled rejections: ${unhandledRejections.map(r => r.message).join(", ")}`);
});
