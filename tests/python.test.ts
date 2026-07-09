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

test("periodic report detection only keeps annual semiannual and quarterly reports", () => {
  const stdout = execFileSync(
    "python3",
    [
      "-c",
      [
        "from scripts.astock_utils import is_periodic_report, is_not_full_report",
        "cases = [('2025年年度报告', True), ('2025年半年度报告', True), ('2025年一季度报告', True), ('2025年第一季度报告', True), ('2025年三季度报告', True), ('2025年第三季度报告', True), ('2025年年度报告摘要', False), ('关于2025年半年度募集资金存放与使用情况的专项报告', False), ('2025年度审计报告', False), ('2025年ESG报告', False), ('关于召开2025年年度股东大会的通知', False)]",
        "print('|'.join(str(is_periodic_report(title, '')) for title, _ in cases))",
        "print('|'.join(str(expected) for _, expected in cases))",
        "print(is_not_full_report('2025年半年度报告摘要'))",
      ].join("; "),
    ],
    { encoding: "utf-8" },
  )
    .trim()
    .split("\n");

  assert.deepEqual(stdout, [
    "True|True|True|True|True|True|False|False|False|False|False",
    "True|True|True|True|True|True|False|False|False|False|False",
    "True",
  ]);
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
