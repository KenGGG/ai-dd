import assert from "node:assert/strict";
import test from "node:test";
import { parseLastJSON } from "../server/python.ts";

test("parseLastJSON returns the final JSON object in noisy stdout", () => {
  const stdout = [
    "starting notebook upload",
    '{"step":"download","ok":true}',
    "finished",
    '{"status":"completed","count":3}',
  ].join("\n");

  assert.deepEqual(parseLastJSON(stdout), { status: "completed", count: 3 });
});

test("parseLastJSON returns null when stdout has no JSON payload", () => {
  assert.equal(parseLastJSON("plain log line\nanother log line"), null);
});
