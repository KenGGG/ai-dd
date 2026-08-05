import assert from "node:assert/strict";
import test from "node:test";
import { aiddaAuthMiddleware } from "../server/middleware/auth-middleware.ts";
import { APP_CONFIG } from "../server/config.ts";

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

// Mutating APP_CONFIG.authToken is safe here because each test restores it.
function withToken(token: string, fn: () => void) {
  const original = APP_CONFIG.authToken;
  (APP_CONFIG as { authToken: string }).authToken = token;
  try {
    fn();
  } finally {
    (APP_CONFIG as { authToken: string }).authToken = original;
  }
}

test("auth: missing bearer header returns 401 when a token is configured", () => {
  withToken("secret", () => {
    let nexted = false;
    const req: any = { path: "/projects", headers: {} };
    const res = makeRes();
    aiddaAuthMiddleware(req, res, () => {
      nexted = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(nexted, false);
  });
});

test("auth: wrong token returns 401", () => {
  withToken("secret", () => {
    let nexted = false;
    const req: any = { path: "/projects", headers: { authorization: "Bearer wrong" } };
    const res = makeRes();
    aiddaAuthMiddleware(req, res, () => {
      nexted = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(nexted, false);
  });
});

test("auth: valid token passes through to next", () => {
  withToken("secret", () => {
    let nexted = false;
    const req: any = { path: "/projects", headers: { authorization: "Bearer secret" } };
    const res = makeRes();
    aiddaAuthMiddleware(req, res, () => {
      nexted = true;
    });
    assert.equal(nexted, true);
  });
});

test("auth: no token configured allows all requests (dev mode)", () => {
  withToken("", () => {
    let nexted = false;
    const req: any = { path: "/projects", headers: {} };
    const res = makeRes();
    aiddaAuthMiddleware(req, res, () => {
      nexted = true;
    });
    assert.equal(nexted, true);
  });
});

test("auth: public paths /health and /auth/status always pass through", () => {
  withToken("secret", () => {
    for (const p of ["/health", "/auth/status"]) {
      let nexted = false;
      const req: any = { path: p, headers: {} };
      const res = makeRes();
      aiddaAuthMiddleware(req, res, () => {
        nexted = true;
      });
      assert.equal(nexted, true, `path ${p} should bypass auth`);
    }
  });
});
