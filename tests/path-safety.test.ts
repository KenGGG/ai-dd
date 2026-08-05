import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { aiddaRouter } from "../server/routes/aidda.ts";
import { errorHandler } from "../server/middleware/error-handler.ts";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/aidda", aiddaRouter);
  app.use(errorHandler);
  return app;
}

test("route: path-traversal project id is rejected with 400", async () => {
  const app = buildApp();
  const server = app.listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/aidda/projects/..%2f..%2fetc/report`);
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /非法的项目标识/);
  } finally {
    server.close();
  }
});

test("route: benign unknown id returns 404 (no 500, no traversal)", async () => {
  const app = buildApp();
  const server = app.listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/aidda/projects/000000/report`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test("route: delete with traversal id is rejected with 400", async () => {
  const app = buildApp();
  const server = app.listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/aidda/projects/..%2f..%2fetc`, {
      method: "DELETE",
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});
