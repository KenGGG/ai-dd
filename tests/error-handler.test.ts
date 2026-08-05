import assert from "node:assert/strict";
import test from "node:test";
import { AppError, asyncHandler, errorHandler } from "../server/middleware/error-handler.ts";

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(obj: unknown) {
      this.body = obj;
      return this;
    },
  };
  return res;
}

test("errorHandler: AppError uses its statusCode and code", () => {
  const res = makeRes();
  errorHandler(new AppError("bad request", 418, "TEAPOT"), {} as never, res as never, () => {});
  assert.equal(res.statusCode, 418);
  assert.equal(res.body.code, "TEAPOT");
});

test("errorHandler: generic Error maps to 500", () => {
  const res = makeRes();
  errorHandler(new Error("boom"), {} as never, res as never, () => {});
  assert.equal(res.statusCode, 500);
});

test("errorHandler: non-Error value maps to 500", () => {
  const res = makeRes();
  errorHandler("weird", {} as never, res as never, () => {});
  assert.equal(res.statusCode, 500);
});

test("asyncHandler: forwards a rejected promise to next", async () => {
  let received: unknown;
  const handler = asyncHandler(async () => {
    throw new AppError("nope", 400);
  });
  await handler({} as never, {} as never, (err: unknown) => {
    received = err;
  });
  assert.ok(received instanceof AppError);
  assert.equal((received as AppError).statusCode, 400);
});

test("asyncHandler: does not call next on success", async () => {
  let called = false;
  const handler = asyncHandler(async () => {
    /* success */
  });
  await handler({} as never, {} as never, () => {
    called = true;
  });
  assert.equal(called, false);
});
