"""
公告下载模块 — 基于 a-stock-data 巨潮接口

下载策略（两层资料池）：
1. 近三年定期报告（年报、半年报、季报、审计报告、内控评价、募集资金专项报告）
2. 最近 200 个公告（不限类型，补充资料池）
3. 合并去重后得到最终 PDF 集合
"""
import json
import logging
import os
import random
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .astock_utils import (
    cninfo_list_all,
    download_pdf,
    is_not_full_report,
    is_periodic_report,
    normalize_stock_code,
    safe_filename,
    get_report_date_range,
)


def _validate_safe_path(base_dir: Path, requested: Path) -> Path:
    """确保解析后的绝对路径仍在 base_dir 下"""
    resolved = requested.resolve()
    if not resolved.is_relative_to(base_dir.resolve()):
        raise ValueError(f"路径穿越风险: {resolved} 不在 {base_dir} 下")
    return resolved

logger = logging.getLogger(__name__)

# ── 常量 ──────────────────────────────────────────────────────────────
PROJECTS_DIR = Path(__file__).resolve().parent.parent / "data" / "projects"
PDFS_DIR = Path(__file__).resolve().parent.parent / "data" / "pdfs"
MANIFESTS_DIR = Path(__file__).resolve().parent.parent / "data" / "manifests"

# 下载间隔：控制请求频率
DOWNLOAD_INTERVAL_MIN = 0.5
DOWNLOAD_INTERVAL_MAX = 1.0


def get_project_dir(project_id: str) -> Path:
    """获取项目目录"""
    return PROJECTS_DIR / project_id


def get_pdf_dir(project_id: str) -> Path:
    """获取项目 PDF 存储目录"""
    d = PDFS_DIR / project_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_manifest_path(project_id: str) -> Path:
    """获取项目 manifest 路径"""
    MANIFESTS_DIR.mkdir(parents=True, exist_ok=True)
    return MANIFESTS_DIR / f"{project_id}_announcements.jsonl"



def _download_announcement_pdf(
    item: dict,
    pdf_dir: Path,
    stock_code: str,
) -> dict[str, Any]:
    """下载单条公告 PDF，返回更新后的 manifest 记录"""
    title = item.get("title", "untitled")
    date = item.get("date", "unknown")
    ann_id = item.get("announcement_id", "")
    adjunct_url = item.get("adjunct_url", "")

    safe_name = f"{stock_code}_{date}_{ann_id}_{''.join(c for c in title if c.isalnum() or c in ' _-')}.pdf"
    save_path = _validate_safe_path(pdf_dir.parent, pdf_dir / safe_name)

    # 检查是否已下载（同名同大小跳过）
    if save_path.exists():
        import hashlib
        sha256 = hashlib.sha256(save_path.read_bytes()).hexdigest()
        return {
            "announcement_id": ann_id,
            "title": title,
            "date": date,
            "adjunct_url": adjunct_url,
            "local_path": str(save_path),
            "sha256": sha256,
            "download_status": "downloaded",
            "error_message": "",
        }

    result = download_pdf(adjunct_url, save_path)
    return {
        "announcement_id": ann_id,
        "title": title,
        "date": date,
        "adjunct_url": adjunct_url,
        "local_path": result.get("local_path", str(save_path)),
        "sha256": result.get("sha256", ""),
        "download_status": result.get("status", "download_failed"),
        "error_message": result.get("error_message", ""),
    }


def _write_manifest(manifest_path: Path, records: list[dict]) -> None:
    """原子写入 manifest JSONL"""
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    import tempfile
    tmp_path = manifest_path.with_suffix(".jsonl.tmp")
    try:
        fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        tmp_path.rename(manifest_path)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink()
        raise
    logger.info(f"Manifest 已写入: {manifest_path} ({len(records)} 条)")


def _dedup_records(
    periodic_records: list[dict],
    recent_records: list[dict],
) -> list[dict]:
    """
    去重合并两层公告记录。
    优先级：公告 ID > PDF URL > sha256
    """
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    seen_sha256: set[str] = set()
    merged: list[dict] = []

    def _add(rec: dict, source_layer: str) -> None:
        rec["source_layer"] = source_layer
        ann_id = rec.get("announcement_id", "")
        url = rec.get("adjunct_url", "")
        sha = rec.get("sha256", "")

        if ann_id and ann_id in seen_ids:
            rec["source_layer"] = "both"
            rec["download_status"] = "skipped_duplicate"
            merged.append(rec)
            return
        if url and url in seen_urls:
            rec["source_layer"] = "both"
            rec["download_status"] = "skipped_duplicate"
            merged.append(rec)
            return
        if sha and sha in seen_sha256:
            rec["source_layer"] = "both"
            rec["download_status"] = "skipped_duplicate"
            merged.append(rec)
            return

        if ann_id:
            seen_ids.add(ann_id)
        if url:
            seen_urls.add(url)
        if sha:
            seen_sha256.add(sha)
        merged.append(rec)

    # 先加 periodic（更优先），再加 recent
    for rec in periodic_records:
        _add(rec, "periodic_report_3y")
    for rec in recent_records:
        _add(rec, "recent_200")

    return merged


def generate_project_id(stock_code: str) -> str:
    """生成项目 ID"""
    raw = normalize_stock_code(stock_code)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    suffix = uuid.uuid4().hex[:6]
    return f"{raw}_{ts}_{suffix}"


def download_announcements(
    stock_code: str,
    project_id: str,
    periodic_years: int = 3,
    recent_limit: int = 200,
    out_dir: str | Path | None = None,
    skip_download: bool = False,
    data_dir: str | None = None,
) -> dict[str, Any]:
    """
    执行公告下载主逻辑。

    返回:
        {project_id, stock_code, periodic_count, recent_count,
         after_dedup, download_success, download_failed, ...}
    """
    raw_code = normalize_stock_code(stock_code)
    logger.info(f"开始下载公告: {raw_code}, project_id={project_id}")

    # --- 目录准备 ---
    if data_dir:
        base_dir = Path(data_dir)
    elif out_dir:
        base_dir = Path(out_dir)
    else:
        base_dir = Path(__file__).resolve().parent.parent / "data"

    pdf_dir = _validate_safe_path(base_dir / "pdfs", base_dir / "pdfs" / project_id)
    manifest_path = _validate_safe_path(base_dir / "manifests", base_dir / "manifests" / f"{project_id}_announcements.jsonl")

    # skip_download 且已有 manifest → 快速返回
    if skip_download and manifest_path.exists():
        logger.info(f"skip_download 模式，复用已有 manifest: {manifest_path}")
        records = []
        with open(manifest_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
        statuses = [r.get("download_status", "") for r in records]
        return {
            "project_id": project_id,
            "stock_code": raw_code,
            "periodic_count": sum(1 for r in records if r.get("source_layer") in ("periodic_report_3y", "both")),
            "recent_count": sum(1 for r in records if r.get("source_layer") == "recent_200"),
            "after_dedup": len(records),
            "download_success": sum(1 for s in statuses if s == "downloaded"),
            "download_failed": sum(1 for s in statuses if s.startswith("download_failed") or s == "failed"),
            "skipped": sum(1 for s in statuses if s == "skipped"),
            "skipped_duplicate": sum(1 for s in statuses if s == "skipped_duplicate"),
            "manifest_path": str(manifest_path),
            "pdf_dir": str(pdf_dir),
        }

    pdf_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    # --- 日期范围 ---
    start_date, end_date = get_report_date_range(periodic_years)

    # --- 第一层：近三年定期报告 ---
    logger.info(f"=== 第一层：近三年定期报告（{start_date} ~ {end_date}）===")
    all_periodic_anns = cninfo_list_all(
        code=raw_code,
        max_pages=30,
        page_size=30,
        start_date=start_date,
        end_date=end_date,
    )
    periodic_items = [
        a for a in all_periodic_anns
        if is_periodic_report(a.get("title", ""), a.get("type", ""))
        and not is_not_full_report(a.get("title", ""))
    ]
    logger.info(f"  检索到定期报告: {len(periodic_items)} 条")

    # --- 第二层：最近 N 个公告 ---
    logger.info(f"=== 第二层：最近 {recent_limit} 个公告 ===")
    recent_anns = cninfo_list_all(
        code=raw_code,
        max_pages=max(7, recent_limit // 30 + 2),
        page_size=30,
        end_date=end_date,
    )
    recent_items = recent_anns[:recent_limit]
    logger.info(f"  检索到最近公告: {len(recent_items)} 条")

    # --- 扫描现有 PDF（断点续传支持） ---
    existing_pdfs: dict[str, dict] = {}
    for f in pdf_dir.iterdir():
        if f.suffix.lower() == ".pdf":
            import hashlib
            try:
                sha = hashlib.sha256(f.read_bytes()).hexdigest()
                existing_pdfs[sha] = {"local_path": str(f)}
            except Exception:
                pass
    logger.info(f"  已有本地 PDF: {len(existing_pdfs)} 个")

    # --- 下载第一层：定期报告 ---
    periodic_records: list[dict] = []
    for idx, item in enumerate(periodic_items):
        logger.debug(f"  [{idx+1}/{len(periodic_items)}] {item.get('title', '')}")
        if skip_download:
            rec = {
                "announcement_id": item.get("announcement_id", ""),
                "title": item.get("title", ""),
                "date": item.get("date", ""),
                "adjunct_url": item.get("adjunct_url", ""),
                "local_path": "",
                "sha256": "",
                "download_status": "skipped",
                "error_message": "",
            }
        else:
            rec = _download_announcement_pdf(item, pdf_dir, raw_code)

        rec["stock_code"] = raw_code
        rec["announcement_type"] = item.get("type", "")

        # 检查是否已有相同 sha256 的 PDF（去重）
        if rec.get("sha256") and rec["sha256"] in existing_pdfs:
            existing = existing_pdfs[rec["sha256"]]
            rec["local_path"] = existing["local_path"]
            if rec["download_status"] not in ("skip_download",):
                rec["download_status"] = "downloaded"

        periodic_records.append(rec)
        time.sleep(random.uniform(DOWNLOAD_INTERVAL_MIN, DOWNLOAD_INTERVAL_MAX))

    # --- 下载第二层：最近公告 ---
    recent_records: list[dict] = []
    for idx, item in enumerate(recent_items):
        logger.debug(f"  [{idx+1}/{len(recent_items)}] {item.get('title', '')}")
        if skip_download:
            rec = {
                "announcement_id": item.get("announcement_id", ""),
                "title": item.get("title", ""),
                "date": item.get("date", ""),
                "adjunct_url": item.get("adjunct_url", ""),
                "local_path": "",
                "sha256": "",
                "download_status": "skipped",
                "error_message": "",
            }
        else:
            rec = _download_announcement_pdf(item, pdf_dir, raw_code)

        rec["stock_code"] = raw_code
        rec["announcement_type"] = item.get("type", "")

        if rec.get("sha256") and rec["sha256"] in existing_pdfs:
            existing = existing_pdfs[rec["sha256"]]
            rec["local_path"] = existing["local_path"]
            if rec["download_status"] not in ("skip_download",):
                rec["download_status"] = "downloaded"

        recent_records.append(rec)
        time.sleep(random.uniform(DOWNLOAD_INTERVAL_MIN, DOWNLOAD_INTERVAL_MAX))

    # --- 合并去重 ---
    merged_records = _dedup_records(periodic_records, recent_records)

    # --- 写入 manifest ---
    for rec in merged_records:
        rec["project_id"] = project_id
        rec["stock_code"] = raw_code
        if "upload_status" not in rec:
            rec["upload_status"] = ""
        if "ready_status" not in rec:
            rec["ready_status"] = ""
        if "notebook_id" not in rec:
            rec["notebook_id"] = ""
        if "source_id" not in rec:
            rec["source_id"] = ""

    _write_manifest(manifest_path, merged_records)

    # --- 统计 ---
    statuses = [r.get("download_status", "") for r in merged_records]
    download_success = sum(1 for s in statuses if s == "downloaded")
    download_failed = sum(
        1 for s in statuses if s.startswith("download_failed") or s == "failed"
    )
    skipped_duplicate = sum(1 for s in statuses if s == "skipped_duplicate")
    skipped = sum(1 for s in statuses if s == "skipped")

    summary = {
        "project_id": project_id,
        "stock_code": raw_code,
        "periodic_count": len(periodic_items),
        "recent_count": len(recent_items),
        "after_dedup": len(merged_records),
        "download_success": download_success,
        "download_failed": download_failed,
        "skipped": skipped,
        "skipped_duplicate": skipped_duplicate,
        "manifest_path": str(manifest_path),
        "pdf_dir": str(pdf_dir),
    }

    logger.info(f"公告下载完成: {json.dumps(summary, ensure_ascii=False)}")
    return summary
