"""
AIDDA 公告下载 + 即时 NotebookLM 上传编排脚本。

顺序：
1. 查询并下载近三年定期报告；
2. 每成功下载一个 PDF，立即上传到指定 NotebookLM 笔记；
3. 查询并下载最近 N 个公告；
4. 每成功下载一个 PDF，立即上传；
5. 持续写入 manifest，便于前端轮询状态。
"""
import argparse
import asyncio
import json
import logging
import random
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.astock_download_announcements import _download_announcement_pdf, _write_manifest
from scripts.astock_utils import (
    cninfo_list_all,
    get_report_date_range,
    is_not_full_report,
    is_periodic_report,
    normalize_stock_code,
)
from scripts.notebooklm_upload import upload_pdf_to_notebook


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="下载巨潮公告 PDF，并逐个上传至 NotebookLM")
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--stock-code", required=True)
    parser.add_argument("--notebook-id", required=True)
    parser.add_argument("--periodic-years", type=int, default=3)
    parser.add_argument("--recent-limit", type=int, default=200)
    parser.add_argument("--out-dir", default="data")
    parser.add_argument("--wait-ready", action="store_true", default=True)
    return parser.parse_args()


def _base_record(item: dict, rec: dict, raw_code: str, project_id: str, source_layer: str) -> dict[str, Any]:
    rec["stock_code"] = raw_code
    rec["announcement_type"] = item.get("type", "") or ""
    rec["source_layer"] = source_layer
    rec["project_id"] = project_id
    rec.setdefault("upload_status", "")
    rec.setdefault("ready_status", "")
    rec.setdefault("notebook_id", "")
    rec.setdefault("source_id", "")
    return rec


def _dedupe_key(item: dict) -> tuple[str, str]:
    return item.get("announcement_id", "") or "", item.get("adjunct_url", "") or ""


def main() -> None:
    args = parse_args()
    raw_code = normalize_stock_code(args.stock_code)
    base_dir = Path(args.out_dir)
    pdf_dir = base_dir / "pdfs" / args.project_id
    manifest_path = base_dir / "manifests" / f"{args.project_id}_announcements.jsonl"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    start_date, end_date = get_report_date_range(args.periodic_years)
    records: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    seen_sha: set[str] = set()

    logger.info("第一阶段：检索近三年定期报告")
    periodic_anns = cninfo_list_all(
        code=raw_code,
        max_pages=30,
        page_size=30,
        start_date=start_date,
        end_date=end_date,
    )
    periodic_items = [
        a for a in periodic_anns
        if is_periodic_report(a.get("title", ""), a.get("type", ""))
        and not is_not_full_report(a.get("title", ""))
    ]
    logger.info("定期报告数量：%s", len(periodic_items))

    logger.info("第二阶段：检索最近 %s 个公告", args.recent_limit)
    recent_anns = cninfo_list_all(
        code=raw_code,
        max_pages=max(7, args.recent_limit // 30 + 2),
        page_size=30,
        end_date=end_date,
    )
    recent_items = recent_anns[:args.recent_limit]
    logger.info("最近公告数量：%s", len(recent_items))

    stages = [
        ("periodic_report_3y", periodic_items),
        ("recent_200", recent_items),
    ]

    for source_layer, items in stages:
        logger.info("开始处理资料池：%s", source_layer)
        for idx, item in enumerate(items):
            ann_id, url = _dedupe_key(item)
            if (ann_id and ann_id in seen_ids) or (url and url in seen_urls):
                rec = {
                    "announcement_id": ann_id,
                    "title": item.get("title", ""),
                    "date": item.get("date", ""),
                    "adjunct_url": url,
                    "local_path": "",
                    "sha256": "",
                    "download_status": "skipped_duplicate",
                    "error_message": "",
                }
                records.append(_base_record(item, rec, raw_code, args.project_id, "both"))
                _write_manifest(manifest_path, records)
                continue

            logger.info("[%s/%s][%s] 下载：%s", idx + 1, len(items), source_layer, item.get("title", ""))
            rec = _download_announcement_pdf(item, pdf_dir, raw_code)
            rec = _base_record(item, rec, raw_code, args.project_id, source_layer)

            if ann_id:
                seen_ids.add(ann_id)
            if url:
                seen_urls.add(url)

            sha = rec.get("sha256", "")
            if sha and sha in seen_sha:
                rec["download_status"] = "skipped_duplicate"
                rec["source_layer"] = "both"
            elif sha:
                seen_sha.add(sha)

            if rec.get("download_status") == "downloaded" and rec.get("local_path"):
                upload_result = asyncio.run(
                    upload_pdf_to_notebook(
                        notebook_id=args.notebook_id,
                        pdf_path=rec["local_path"],
                        wait_ready=args.wait_ready,
                    )
                )
                rec["upload_status"] = upload_result.get("status", "")
                rec["source_id"] = upload_result.get("source_id", "")
                rec["ready_status"] = "ready" if upload_result.get("status") == "uploaded" else ""
                rec["notebook_id"] = args.notebook_id
                if upload_result.get("error_message"):
                    rec["error_message"] = upload_result["error_message"]

            records.append(rec)
            _write_manifest(manifest_path, records)
            time.sleep(random.uniform(0.5, 1.0))

    statuses = [r.get("download_status", "") for r in records]
    upload_statuses = [r.get("upload_status", "") for r in records]
    summary = {
        "status": "completed",
        "project_id": args.project_id,
        "stock_code": raw_code,
        "periodic_count": len(periodic_items),
        "recent_count": len(recent_items),
        "after_dedup": len(records),
        "download_success": sum(1 for s in statuses if s == "downloaded"),
        "download_failed": sum(1 for s in statuses if s.startswith("download_failed") or s == "failed"),
        "skipped_duplicate": sum(1 for s in statuses if s == "skipped_duplicate"),
        "upload_success": sum(1 for s in upload_statuses if s == "uploaded"),
        "upload_failed": sum(1 for s in upload_statuses if s == "upload_failed"),
        "manifest_path": str(manifest_path),
        "pdf_dir": str(pdf_dir),
        "notebook_id": args.notebook_id,
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
