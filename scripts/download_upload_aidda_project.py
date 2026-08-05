"""
AIDDA 公告下载 + 即时 NotebookLM 上传编排脚本。

顺序：
1. 查询并下载近三年定期报告；
2. 每成功下载一个 PDF，立即上传至指定 NotebookLM 笔记；
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
from scripts.notebooklm_upload import (
    find_existing_source_by_title,
    list_notebook_sources,
    upload_pdf_to_notebook,
)
from scripts.path_utils import _validate_safe_path
from scripts.source_mappings import (
    check_and_get_existing_mapping,
    create_or_update_mapping,
    init_db,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# 初始化 source_mappings 数据库表
try:
    init_db()
except Exception as e:
    logger.warning(f"source_mappings 数据库初始化失败: {e}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="下载巨潮公告 PDF，并逐个上传至 NotebookLM")
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--stock-code", required=True)
    parser.add_argument("--notebook-id", required=True)
    parser.add_argument("--periodic-years", type=int, default=3)
    parser.add_argument("--recent-limit", type=int, default=200)
    parser.add_argument("--exclude-title-keywords", default="")
    parser.add_argument("--out-dir", default="data")
    parser.add_argument("--data-dir", default=None, help="覆盖输出根目录 (由服务端传入)")
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


def _parse_filter_terms(raw_terms: str) -> list[str]:
    terms: list[str] = []
    for line in raw_terms.replace("，", ",").splitlines():
        terms.extend(part.strip() for part in line.split(",") if part.strip())
    return terms


def _matched_filter(title: str, filter_terms: list[str]) -> str:
    normalized = title.lower()
    for term in filter_terms:
        if term.lower() in normalized:
            return term
    return ""


async def _load_existing_sources(notebook_id: str) -> list[Any]:
    from notebooklm import NotebookLMClient

    async with NotebookLMClient.from_storage() as client:
        return await list_notebook_sources(client, notebook_id)


# ── 状态定义 ────────────────────────────────────────────────────────────────

READY_UPLOAD_STATUSES = {
    "uploaded",
    "skipped_existing_source",
}

EXCLUDED_DOWNLOAD_STATUSES = {
    "skipped_filter",
    "skipped_duplicate",
}

DOWNLOAD_FAILURE_STATUSES = {
    "failed",
}


def has_layer(record: dict, layer: str) -> bool:
    current = str(record.get("source_layer", ""))
    return current == layer or current == "both"


def is_required_record(record: dict, layer: str) -> bool:
    if not has_layer(record, layer):
        return False

    return (
        record.get("download_status")
        not in EXCLUDED_DOWNLOAD_STATUSES
    )


def is_ready_record(record: dict) -> bool:
    return (
        record.get("upload_status")
        in READY_UPLOAD_STATUSES
    )


def is_failed_record(record: dict) -> bool:
    download_status = str(
        record.get("download_status", ""),
    )
    upload_status = str(
        record.get("upload_status", ""),
    )

    return (
        download_status == "failed"
        or download_status.startswith("download_failed")
        or upload_status == "upload_failed"
    )


def merge_source_layer(
    current: str,
    incoming: str,
) -> str:
    if not current:
        return incoming
    if current == incoming:
        return current
    return "both"


def main() -> None:
    args = parse_args()
    raw_code = normalize_stock_code(args.stock_code)
    base_dir = Path(args.data_dir) if args.data_dir else Path(args.out_dir)
    pdf_dir = _validate_safe_path(base_dir / "pdfs", base_dir / "pdfs" / args.project_id)
    manifest_path = _validate_safe_path(
        base_dir / "manifests", base_dir / "manifests" / f"{args.project_id}_announcements.jsonl"
    )
    pdf_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    start_date, end_date = get_report_date_range(args.periodic_years)
    records: list[dict[str, Any]] = []
    # Use dicts instead of sets to track canonical records for merging source layers
    seen_ids: dict[str, dict] = {}
    seen_urls: dict[str, dict] = {}
    seen_sha: dict[str, dict] = {}
    filter_terms = _parse_filter_terms(args.exclude_title_keywords)

    # Load existing NotebookLM sources
    try:
        existing_sources = asyncio.run(_load_existing_sources(args.notebook_id))
        logger.info("NotebookLM 已有附件数量：%s", len(existing_sources))
    except Exception as e:
        existing_sources = []
        logger.warning("读取 NotebookLM 已有附件失败，将继续按本地流程处理: %s", e)

    # Periodic reports (3 years)
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

    # Recent announcements
    recent_items = []
    recent_expected = 0
    if args.recent_limit > 0:
        logger.info("第二阶段：检索最近 %s 个公告", args.recent_limit)
        recent_anns = cninfo_list_all(
            code=raw_code,
            max_pages=max(7, args.recent_limit // 30 + 2),
            page_size=30,
            end_date=end_date,
        )
        recent_items = recent_anns[:args.recent_limit]
        logger.info("最近公告数量：%s", len(recent_items))
    else:
        logger.info("第二阶段：已选择仅同步定期报告，跳过最近公告检索")

    if filter_terms:
        logger.info("公告标题过滤词：%s", "、".join(filter_terms))

    stages = [
        ("periodic_report_3y", periodic_items),
        ("recent_200", recent_items),
    ]

    # Process each stage in order
    for source_layer, items in stages:
        logger.info("开始处理资料池：%s", source_layer)
        for idx, item in enumerate(items):
            ann_id, url = _dedupe_key(item)
            matched_term = _matched_filter(item.get("title", ""), filter_terms)

            # 1. Filter by title (only for recent items)
            if matched_term and source_layer == "recent_200":
                rec = {
                    "announcement_id": ann_id,
                    "title": item.get("title", ""),
                    "date": item.get("date", ""),
                    "adjunct_url": url,
                    "local_path": "",
                    "sha256": "",
                    "download_status": "skipped_filter",
                    "upload_status": "skipped",
                    "error_message": f"命中过滤词：{matched_term}",
                }
                records.append(_base_record(item, rec, raw_code, args.project_id, source_layer))
                _write_manifest(manifest_path, records)
                continue

            # 2. Check ID/URL duplicate
            canonical: dict | None = None
            if ann_id and ann_id in seen_ids:
                canonical = seen_ids[ann_id]
            elif url and url in seen_urls:
                canonical = seen_urls[url]

            if canonical:
                # Merge source layers
                canonical["source_layer"] = merge_source_layer(
                    str(canonical.get("source_layer", "")),
                    source_layer,
                )

                duplicate = {
                    "announcement_id": ann_id,
                    "title": item.get("title", ""),
                    "date": item.get("date", ""),
                    "adjunct_url": url,
                    "local_path": "",
                    "sha256": "",
                    "download_status": "skipped_duplicate",
                    "upload_status": "skipped",
                    "duplicate_of": (
                        canonical.get("announcement_id")
                        or canonical.get("sha256")
                        or canonical.get("source_id")
                    ),
                    "error_message": "",
                }
                duplicate = _base_record(item, duplicate, raw_code, args.project_id, "both")
                records.append(duplicate)
                _write_manifest(manifest_path, records)
                continue

            # 3. Check existing NotebookLM source by title
            existing_source = find_existing_source_by_title(
                existing_sources,
                item.get("title", ""),
                announcement_id=item.get("announcement_id", ""),
                sha256="",  # SHA not known before download
            )
            if existing_source:
                rec = {
                    "announcement_id": ann_id,
                    "title": item.get("title", ""),
                    "date": item.get("date", ""),
                    "adjunct_url": url,
                    "local_path": "",
                    "sha256": "",
                    "download_status": "skipped_existing_source",
                    "upload_status": "skipped_existing_source",
                    "source_id": existing_source.get("source_id", ""),
                    "source_title": existing_source.get("source_title", ""),
                    "ready_status": "ready",
                    "notebook_id": args.notebook_id,
                    "error_message": "",
                }
                rec = _base_record(item, rec, raw_code, args.project_id, source_layer)
                records.append(rec)

                if ann_id:
                    seen_ids[ann_id] = rec
                if url:
                    seen_urls[url] = rec

                _write_manifest(manifest_path, records)
                logger.info(
                    "[%s/%s][%s] NotebookLM 已有附件，跳过下载上传：%s",
                    idx + 1,
                    len(items),
                    source_layer,
                    item.get("title", ""),
                )
                continue

            # 4. Download
            logger.info("[%s/%s][%s] 下载：%s", idx + 1, len(items), source_layer, item.get("title", ""))
            rec = _download_announcement_pdf(item, pdf_dir, raw_code)
            rec = _base_record(item, rec, raw_code, args.project_id, source_layer)

            if ann_id:
                seen_ids[ann_id] = rec
            if url:
                seen_urls[url] = rec

            # 5. SHA duplicate check
            sha = rec.get("sha256", "")
            if sha and sha in seen_sha:
                canonical_sha = seen_sha[sha]
                canonical_sha["source_layer"] = merge_source_layer(
                    str(canonical_sha.get("source_layer", "")),
                    source_layer,
                )
                rec["download_status"] = "skipped_duplicate"
                rec["upload_status"] = "skipped_duplicate"
                rec["duplicate_of"] = sha
                records.append(rec)
                _write_manifest(manifest_path, records)
            elif rec.get("download_status") == "downloaded" and rec.get("local_path"):
                if sha:
                    seen_sha[sha] = rec

                # 6. Upload
                existing_mapping = None
                ann_id = rec.get("announcement_id", "")
                sha256 = rec.get("sha256", "")

                if ann_id or sha256:
                    existing_mapping = check_and_get_existing_mapping(
                        project_id=args.project_id,
                        notebook_id=args.notebook_id,
                        announcement_id=ann_id if ann_id else None,
                        sha256=sha256 if sha256 else None,
                    )

                if existing_mapping:
                    # Already mapped, skip upload
                    rec["upload_status"] = "skipped_existing_source"
                    rec["source_id"] = existing_mapping["source_id"]
                    rec["source_title"] = existing_mapping["source_title"] or ""
                    rec["ready_status"] = "ready"
                    rec["notebook_id"] = args.notebook_id
                    rec["error_message"] = ""
                    logger.info(
                        "[%s/%s][%s] source_mappings 已有记录，跳过上传：%s",
                        idx + 1,
                        len(items),
                        source_layer,
                        item.get("title", ""),
                    )
                else:
                    # Need to upload
                    upload_result = asyncio.run(
                        upload_pdf_to_notebook(
                            notebook_id=args.notebook_id,
                            pdf_path=rec["local_path"],
                            wait_ready=args.wait_ready,
                            manifest_record=rec,
                        )
                    )
                    rec["upload_status"] = upload_result.get("status", "")
                    rec["source_id"] = upload_result.get("source_id", "")
                    rec["source_title"] = upload_result.get("source_title", "")
                    rec["ready_status"] = (
                        "ready"
                        if upload_result.get("status") in ("uploaded", "skipped_existing_source")
                        else ""
                    )
                    rec["notebook_id"] = args.notebook_id
                    if upload_result.get("error_message"):
                        rec["error_message"] = upload_result["error_message"]

                    if upload_result.get("status") in ("uploaded", "skipped_existing_source"):
                        # Append to existing_sources for deduplication in this batch
                        existing_sources.append(
                            type(
                                "NotebookSourceSnapshot",
                                (),
                                {
                                    "id": upload_result.get("source_id", ""),
                                    "title": upload_result.get("source_title", ""),
                                    "status": rec["ready_status"],
                                },
                            )()
                        )
                        # Create/update source_mapping
                        try:
                            create_or_update_mapping(
                                project_id=args.project_id,
                                announcement_id=ann_id if ann_id else None,
                                sha256=sha256 if sha256 else None,
                                notebook_id=args.notebook_id,
                                source_id=rec["source_id"],
                                source_title=rec["source_title"],
                                local_path=rec["local_path"],
                            )
                            logger.debug(f"已保存 source_mapping: {args.project_id} -> {rec['source_id']}")
                        except Exception as e:
                            logger.warning(f"保存 source_mapping 失败: {e}")

                records.append(rec)
                _write_manifest(manifest_path, records)
                time.sleep(random.uniform(0.5, 1.0))

    # Calculate statistics based on actual required records
    # First, determine which records are required for each layer
    periodic_required_records = [
        record
        for record in records
        if is_required_record(
            record,
            "periodic_report_3y",
        )
    ]

    recent_required_records = [
        record
        for record in records
        if is_required_record(
            record,
            "recent_200",
        )
    ]

    periodic_expected = len(periodic_required_records)
    periodic_ready = sum(
        1
        for record in periodic_required_records
        if is_ready_record(record)
    )

    recent_expected = len(recent_required_records)
    recent_ready = sum(
        1
        for record in recent_required_records
        if is_ready_record(record)
    )

    failed_count = sum(
        1
        for record in records
        if (
            (
                is_required_record(
                    record,
                    "periodic_report_3y",
                )
                or is_required_record(
                    record,
                    "recent_200",
                )
            )
            and is_failed_record(record)
        )
    )

    # Count excluded and duplicates
    excluded_count = sum(1 for r in records if r.get("download_status") == "skipped_filter")
    duplicate_count = sum(1 for r in records if r.get("download_status") == "skipped_duplicate")

    summary = {
        "status": "completed",
        "project_id": args.project_id,
        "stock_code": raw_code,
        "periodic_count": len(periodic_items),
        "recent_count": len(recent_items),
        "periodic_discovered": len(periodic_items),
        "recent_discovered": len(recent_items),
        "after_dedup": len(records),
        "excluded_count": excluded_count,
        "duplicate_count": duplicate_count,
        "download_success": sum(
            1 for s in [r.get("download_status", "") for r in records] if s == "downloaded"
        ),
        "download_skipped_existing": sum(
            1 for s in [r.get("download_status", "") for r in records] if s == "skipped_existing_source"
        ),
        "download_failed": sum(
            1 for s in [r.get("download_status", "") for r in records]
            if s.startswith("download_failed") or s == "failed"
        ),
        "skipped_duplicate": sum(
            1 for s in [r.get("download_status", "") for r in records] if s == "skipped_duplicate"
        ),
        "upload_success": sum(1 for r in records if r.get("upload_status") in ("uploaded", "skipped_existing_source")),
        "upload_failed": sum(1 for r in records if r.get("upload_status") == "upload_failed"),
        "upload_skipped_existing": sum(1 for r in records if r.get("upload_status") == "skipped_existing_source"),
        "manifest_path": str(manifest_path),
        "pdf_dir": str(pdf_dir),
        "notebook_id": args.notebook_id,
        "periodic_expected": periodic_expected,
        "periodic_ready": periodic_ready,
        "recent_expected": recent_expected,
        "recent_ready": recent_ready,
        "failed_count": failed_count,
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
