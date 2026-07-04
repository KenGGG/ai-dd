import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

test("announcement title filters parse comma and newline separated terms", () => {
  const stdout = execFileSync(
    "python3",
    [
      "-c",
      [
        "from scripts.download_upload_aidda_project import _parse_filter_terms, _matched_filter",
        "terms = _parse_filter_terms('开会通知\\n会议通知，临时股东大会')",
        "print('|'.join(terms))",
        "print(_matched_filter('关于召开开会通知的公告', terms))",
      ].join("; "),
    ],
    { encoding: "utf-8" },
  )
    .trim()
    .split("\n");

  assert.deepEqual(stdout, ["开会通知|会议通知|临时股东大会", "开会通知"]);
});

test("notebook source duplicate matching uses PDF and announcement titles", () => {
  const stdout = execFileSync(
    "python3",
    [
      "-c",
      [
        "from pathlib import Path",
        "from types import SimpleNamespace",
        "from scripts.notebooklm_upload import _find_existing_source",
        "sources = [SimpleNamespace(id='src-1', title='关于年度报告.pdf', status='ready')]",
        "rec = {'title': '关于年度报告', 'local_path': 'data/pdfs/demo/关于年度报告.pdf'}",
        "match = _find_existing_source(sources, Path('data/pdfs/demo/关于年度报告.pdf'), rec)",
        "print(match['source_id'])",
        "print(match['source_title'])",
      ].join("; "),
    ],
    { encoding: "utf-8" },
  )
    .trim()
    .split("\n");

  assert.deepEqual(stdout, ["src-1", "关于年度报告.pdf"]);
});
