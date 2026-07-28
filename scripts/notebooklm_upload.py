"""
NotebookLM 上传模块 — 使用 notebooklm-py 上传 PDF 到 NotebookLM

功能：
1. 检查 NotebookLM 登录状态
2. 创建或复用 NotebookLM 笔记
3. 上传 PDF 文件
4. 等待 source 处理完成
5. 记录上传和处理状态到 manifest
"""
import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

from scripts.source_mappings import (
    check_and_get_existing_mapping,
    create_or_update_mapping,
    get_source_mappings_by_project,
    init_db,
)

logger = logging.getLogger(__name__)

# 初始化数据库（确保表存在）
try:
    init_db()
except Exception as e:
    logger.warning(f"Source mappings 数据库初始化失败: {e}")


def _normalize_source_title(title: str | None) -> str:
    if not title:
        return ""
    normalized = title.strip().lower()
    return normalized[:-4] if normalized.endswith(".pdf") else normalized


def _candidate_source_titles(pdf_path: Path, manifest_record: dict[str, Any] | None = None) -> set[str]:
    candidates = {
        _normalize_source_title(pdf_path.name),
        _normalize_source_title(pdf_path.stem),
    }
    if manifest_record:
        title = str(manifest_record.get("title", "") or "")
        if title:
            candidates.add(_normalize_source_title(title))
            candidates.add(_normalize_source_title(f"{title}.pdf"))
        local_path = str(manifest_record.get("local_path", "") or "")
        if local_path:
            local_name = Path(local_path).name
            candidates.add(_normalize_source_title(local_name))
            candidates.add(_normalize_source_title(Path(local_name).stem))
    return {candidate for candidate in candidates if candidate}


def _source_to_dict(source: Any) -> dict[str, str]:
    return {
        "source_id": str(getattr(source, "id", "") or ""),
        "source_title": str(getattr(source, "title", "") or ""),
        "source_status": str(getattr(source, "status", "") or ""),
    }


def _find_existing_source(
    existing_sources: list[Any],
    pdf_path: Path,
    manifest_record: dict[str, Any] | None = None,
    project_id: str | None = None,
) -> dict[str, str] | None:
    """严格匹配：优先使用 announcement_id + SHA256 检查 source_mappings，标题精确匹配作为备用。"""
    ann_id = str(manifest_record.get("announcement_id", "")) if manifest_record else ""
    sha256 = str(manifest_record.get("sha256", "")) if manifest_record else ""

    # 1. 先检查 source_mappings 表（如果有 project_id 和有效的 ann_id/sha256）
    if project_id and ann_id and sha256:
        mapping = check_and_get_existing_mapping(project_id, ann_id, sha256)
        if mapping:
            return {
                "source_id": mapping["source_id"],
                "source_title": mapping["source_title"] or "",
                "source_status": mapping["status"] or "",
            }

    # 2. announcement_id + SHA256 优先（NotebookLM 已有 sources）
    if ann_id and sha256:
        for source in existing_sources:
            if str(getattr(source, "id", "") or "") == ann_id:
                return _source_to_dict(source)

    # 3. 标题精确匹配（不再用 substring）
    candidates = _candidate_source_titles(pdf_path, manifest_record)
    for source in existing_sources:
        source_title = _normalize_source_title(str(getattr(source, "title", "") or ""))
        if source_title and any(source_title == candidate for candidate in candidates):
            return _source_to_dict(source)
    return None


def find_existing_source_by_title(
    existing_sources: list[Any],
    title: str,
    announcement_id: str = "",
    sha256: str = "",
) -> dict[str, str] | None:
    """严格匹配：优先使用 announcement_id + SHA256，标题完全相等作为备用。"""
    # 1. 公告 ID + SHA256 精确匹配（最可靠）
    if announcement_id and sha256:
        for source in existing_sources:
            src_ann_id = str(getattr(source, "id", "") or "")
            if src_ann_id == announcement_id:
                return _source_to_dict(source)
        # 按 announcement_id 模糊匹配（无 sha 时备用）
    elif announcement_id:
        for source in existing_sources:
            src_ann_id = str(getattr(source, "id", "") or "")
            if src_ann_id == announcement_id:
                return _source_to_dict(source)

    # 2. 标题完全精确匹配（不使用 substring 包含）
    normalized_title = _normalize_source_title(title)
    if not normalized_title:
        return None
    candidates = {
        normalized_title,
        _normalize_source_title(f"{title}.pdf"),
    }
    for source in existing_sources:
        source_title = _normalize_source_title(str(getattr(source, "title", "") or ""))
        if source_title and source_title in candidates:
            return _source_to_dict(source)
    return None


async def list_notebook_sources(client: Any, notebook_id: str) -> list[Any]:
    try:
        return await client.sources.list(notebook_id)
    except Exception as e:
        logger.warning("无法列出 NotebookLM 已有附件，将继续尝试上传: %s", e)
        return []


async def check_notebooklm_auth() -> bool:
    """
    检查 NotebookLM 登录状态。
    返回 True 表示已登录可用，False 表示未登录或失效。
    """
    try:
        from notebooklm import NotebookLMClient

        async with NotebookLMClient.from_storage() as client:
            notebooks = await client.notebooks.list()
            logger.info(f"NotebookLM 登录正常，可访问 {len(notebooks)} 个笔记")
            return True
    except Exception as e:
        logger.error(f"NotebookLM 登录检查失败: {e}")
        return False


async def get_or_create_notebook(
    notebook_title: str,
    mode: str = "create",
    notebook_id: str | None = None,
) -> dict[str, Any]:
    """
    创建或复用 NotebookLM 笔记。

    Args:
        notebook_title: 笔记标题
        mode: "create" 或 "reuse"
        notebook_id: reuse 模式时的笔记 ID

    Returns:
        {status, notebook_id, notebook_title, error_message}
    """
    from notebooklm import NotebookLMClient

    async with NotebookLMClient.from_storage() as client:
        # 列出已有笔记
        notebooks = await client.notebooks.list()
        notebook_map = {n.id: n.title for n in notebooks}

        async def _source_count(target_notebook_id: str) -> int:
            return len(await list_notebook_sources(client, target_notebook_id))

        if mode == "reuse":
            if not notebook_id:
                return {
                    "status": "failed",
                    "notebook_id": "",
                    "notebook_title": "",
                    "error_message": "reuse 模式必须提供 notebook_id",
                }
            # 检查 notebook_id 是否存在
            if notebook_id in notebook_map:
                logger.info(f"复用已有笔记: {notebook_id} ({notebook_map[notebook_id]})")
                return {
                    "status": "reused",
                    "notebook_id": notebook_id,
                    "notebook_title": notebook_map[notebook_id],
                    "source_count": await _source_count(notebook_id),
                    "error_message": "",
                }
            else:
                logger.warning(f"笔记 {notebook_id} 不存在，将创建新笔记")
                # fallthrough 创建新笔记

        # 检查是否已有同名笔记
        existing_id = None
        for nid, title in notebook_map.items():
            if title == notebook_title:
                existing_id = nid
                break

        if existing_id:
            logger.info(f"发现同名笔记: {existing_id}，直接复用")
            return {
                "status": "reused",
                "notebook_id": existing_id,
                "notebook_title": notebook_title,
                "source_count": await _source_count(existing_id),
                "error_message": "",
            }

        # 创建新笔记
        try:
            notebook = await client.notebooks.create(title=notebook_title)
            logger.info(f"创建新笔记成功: {notebook.id} ({notebook.title})")
            return {
                "status": "created",
                "notebook_id": notebook.id,
                "notebook_title": notebook.title,
                "source_count": 0,
                "error_message": "",
            }
        except Exception as e:
            logger.error(f"创建笔记失败: {e}")
            return {
                "status": "failed",
                "notebook_id": "",
                "notebook_title": "",
                "error_message": str(e),
            }


async def upload_pdf_to_notebook(
    notebook_id: str,
    pdf_path: str | Path,
    wait_ready: bool = True,
    wait_timeout: float = 120.0,
    manifest_record: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    上传单个 PDF 到 NotebookLM 笔记。

    Returns:
        {status, source_id, source_title, error_message}
    """
    from notebooklm import NotebookLMClient

    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        return {
            "status": "failed",
            "source_id": "",
            "source_title": pdf_path.name,
            "error_message": f"文件不存在: {pdf_path}",
        }

    async with NotebookLMClient.from_storage() as client:
        try:
            existing = _find_existing_source(
                await list_notebook_sources(client, notebook_id),
                pdf_path,
                manifest_record,
            )
            if existing:
                return {
                    "status": "skipped_existing_source",
                    "source_id": existing["source_id"],
                    "source_title": existing["source_title"],
                    "error_message": "",
                }

            source = await client.sources.add_file(
                notebook_id=notebook_id,
                file_path=pdf_path,
                wait=wait_ready,
                wait_timeout=wait_timeout,
            )
            return {
                "status": "uploaded",
                "source_id": source.id,
                "source_title": pdf_path.name,
                "error_message": "",
            }
        except Exception as e:
            logger.error(f"上传失败 {pdf_path.name}: {e}")
            return {
                "status": "upload_failed",
                "source_id": "",
                "source_title": pdf_path.name,
                "error_message": str(e),
            }


async def upload_all_pdfs(
    notebook_id: str,
    manifest_records: list[dict],
    wait_ready: bool = True,
    wait_timeout: float = 120.0,
    notebook_title: str = "",
    project_id: str | None = None,
) -> list[dict]:
    """
    上传 manifest 中所有已下载的 PDF 到 NotebookLM。

    Returns:
        更新后的 manifest records（含 upload_status, source_id, ready_status）
    """
    from notebooklm import NotebookLMClient

    # 过滤出已下载的 PDF
    to_upload = [
        r for r in manifest_records
        if r.get("download_status") == "downloaded"
        and r.get("local_path")
    ]
    logger.info(f"待上传 PDF 数量: {len(to_upload)}")

    if not to_upload:
        logger.warning("没有已下载的 PDF 需要上传")
        return manifest_records

    async with NotebookLMClient.from_storage() as client:
        existing_sources = await list_notebook_sources(client, notebook_id)
        for idx, rec in enumerate(to_upload):
            pdf_path = Path(rec["local_path"])
            if not pdf_path.exists():
                rec["upload_status"] = "upload_failed"
                rec["error_message"] = f"本地文件不存在: {pdf_path}"
                logger.warning(f"  [{idx+1}/{len(to_upload)}] 文件不存在: {pdf_path}")
                continue

            try:
                # 检查是否已在 NotebookLM 或 source_mappings 中存在
                existing = _find_existing_source(
                    existing_sources, pdf_path, rec, project_id
                )
                if existing:
                    rec["upload_status"] = "skipped_existing_source"
                    rec["source_id"] = existing["source_id"]
                    rec["source_title"] = existing["source_title"]
                    rec["ready_status"] = "ready"
                    rec["notebook_id"] = notebook_id
                    rec["error_message"] = ""
                    logger.info(
                        f"  [{idx+1}/{len(to_upload)}] ↪ 已存在，跳过上传: {pdf_path.name}"
                    )
                    continue

                source = await client.sources.add_file(
                    notebook_id=notebook_id,
                    file_path=pdf_path,
                    wait=wait_ready,
                    wait_timeout=wait_timeout,
                )
                rec["upload_status"] = "uploaded"
                rec["source_id"] = source.id
                rec["source_title"] = pdf_path.name
                rec["ready_status"] = "ready"
                rec["notebook_id"] = notebook_id
                rec["error_message"] = ""
                existing_sources.append(source)
                logger.info(f"  [{idx+1}/{len(to_upload)}] ✓ {pdf_path.name}")

                # 保存 source_mapping（如果有 project_id）
                if project_id:
                    sha256 = rec.get("sha256", "") or ""
                    announcement_id = rec.get("announcement_id", "") or ""
                    local_path = rec.get("local_path", "") or ""
                    try:
                        create_or_update_mapping(
                            project_id=project_id,
                            announcement_id=announcement_id if announcement_id else None,
                            sha256=sha256 if sha256 else None,
                            notebook_id=notebook_id,
                            source_id=source.id,
                            source_title=rec.get("source_title", ""),
                            local_path=local_path,
                        )
                        logger.debug(f"  已保存 source_mapping: {project_id} -> {source.id}")
                    except Exception as e:
                        logger.warning(f"保存 source_mapping 失败: {e}")

            except Exception as e:
                rec["upload_status"] = "upload_failed"
                rec["source_id"] = ""
                rec["ready_status"] = ""
                rec["notebook_id"] = notebook_id
                rec["error_message"] = str(e)
                logger.warning(f"  [{idx+1}/{len(to_upload)}] ✗ {pdf_path.name}: {e}")

            # 上传间隔控制
            await asyncio.sleep(0.5)

    # 统计
    upload_statuses = [r.get("upload_status", "") for r in to_upload]
    success = sum(1 for s in upload_statuses if s in ("uploaded", "skipped_existing_source"))
    failed = sum(1 for s in upload_statuses if s == "upload_failed")
    logger.info(f"上传完成: 成功 {success}, 失败 {failed}")

    return manifest_records


# ── 同步入口 ──────────────────────────────────────────────────────────


def run_upload(
    manifest_records: list[dict],
    mode: str = "create",
    notebook_id: str | None = None,
    stock_code: str = "",
    stock_name: str = "",
    wait_ready: bool = True,
    project_id: str | None = None,
) -> dict[str, Any]:
    """
    同步执行的 NotebookLM 上传入口。

    Returns:
        {status, notebook_id, notebook_title, upload_success, upload_failed, ...}
    """
    # 1. 检查登录状态
    auth_ok = asyncio.run(check_notebooklm_auth())
    if not auth_ok:
        return {
            "status": "auth_failed",
            "error_message": "NotebookLM 未登录或登录失效。请执行: notebooklm login",
            "notebook_id": "",
            "notebook_title": "",
            "upload_success": 0,
            "upload_failed": 0,
        }

    # 2. 创建或复用笔记
    notebook_title = f"AIDDA-{stock_code}-{stock_name}"
    nb_result = asyncio.run(
        get_or_create_notebook(
            notebook_title=notebook_title,
            mode=mode,
            notebook_id=notebook_id,
        )
    )

    if nb_result.get("status") == "failed":
        return {
            "status": "failed",
            "error_message": nb_result.get("error_message", "创建笔记失败"),
            "notebook_id": "",
            "notebook_title": "",
            "upload_success": 0,
            "upload_failed": 0,
        }

    nb_id = nb_result["notebook_id"]
    nb_title = nb_result["notebook_title"]
    logger.info(f"Notebook: {nb_id} ({nb_title})")

    # 3. 上传 PDF
    updated_records = asyncio.run(
        upload_all_pdfs(
            notebook_id=nb_id,
            manifest_records=manifest_records,
            wait_ready=wait_ready,
            project_id=project_id,
        )
    )

    # 统计
    upload_statuses = [r.get("upload_status", "") for r in updated_records]
    success = sum(1 for s in upload_statuses if s in ("uploaded", "skipped_existing_source"))
    failed = sum(1 for s in upload_statuses if s == "upload_failed")
    skipped_existing = sum(1 for s in upload_statuses if s == "skipped_existing_source")

    return {
        "status": "completed",
        "notebook_id": nb_id,
        "notebook_title": nb_title,
        "notebook_source_count": nb_result.get("source_count", 0),
        "manifest_records": updated_records,
        "upload_success": success,
        "upload_failed": failed,
        "upload_skipped_existing": skipped_existing,
        "error_message": "",
    }
