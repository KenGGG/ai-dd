"""
a-stock-data 工具函数封装

从 a-stock-data SKILL.md 提取巨潮公告相关函数，封装为可导入模块。
"""
import hashlib
import logging
import random
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger(__name__)

# ── 巨潮公告常量 ──────────────────────────────────────────────────────
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
CNINFO_BASE = "https://www.cninfo.com.cn"
CNINFO_STATIC = "https://static.cninfo.com.cn"
CNINFO_QUERY_URL = f"{CNINFO_BASE}/new/hisAnnouncement/query"


def _retry_http(func, *args, attempts: int = 3, backoff: float = 1.0, **kwargs):
    """对网络请求函数做指数退避重试，仅重试传输层异常（连接/超时/IO）。

    最终仍失败时抛出最后一个异常，由调用方决定如何降级处理。
    不引入第三方依赖，仅用标准库 time.sleep。
    """
    last_exc: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return func(*args, **kwargs)
        except (requests.RequestException, OSError) as e:
            last_exc = e
            if attempt < attempts:
                wait = backoff * (2 ** (attempt - 1))
                logger.warning(
                    f"{getattr(func, '__name__', 'http')} 网络请求失败"
                    f"（第 {attempt}/{attempts} 次），{wait:.1f}s 后重试: {e}"
                )
                time.sleep(wait)
    assert last_exc is not None
    raise last_exc

# ── 巨潮 orgId 映射（模块级缓存） ──────────────────────────────────────
_CNINFO_ORGID_MAP: dict[str, str] = {}


def _cninfo_orgid(code: str) -> str:
    """查股票真实 orgId，自带缓存 + 硬编码 fallback"""
    global _CNINFO_ORGID_MAP
    if not _CNINFO_ORGID_MAP:
        try:
            r = requests.get(
                f"{CNINFO_BASE}/new/data/szse_stock.json",
                headers={"User-Agent": UA},
                timeout=15,
            )
            _CNINFO_ORGID_MAP = {
                s["code"]: s["orgId"] for s in r.json().get("stockList", [])
            }
            logger.info(f"巨潮 orgId 映射表加载完成，共 {len(_CNINFO_ORGID_MAP)} 条")
        except Exception as e:
            logger.warning(f"巨潮 orgId 映射表拉取失败，回退硬编码规则: {e}")

    org = _CNINFO_ORGID_MAP.get(code)
    if org:
        return org
    # fallback: 硬编码
    if code.startswith("6"):
        return f"gssh0{code}"
    elif code.startswith("8") or code.startswith("4"):
        return f"gsbj0{code}"
    return f"gssz0{code}"


def _cninfo_ts_to_date(ts: int | float) -> str:
    """巨潮 announcementTime Unix 毫秒 → 日期字符串"""
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
    return str(ts)[:10] if ts else ""


def normalize_stock_code(code: str) -> str:
    """归一化股票代码：去除市场前缀，返回纯6位数字"""
    code = code.strip().upper()
    code = re.sub(r'\.(SH|SZ|BJ)$', '', code)
    code = re.sub(r'^(SH|SZ|BJ)', '', code)
    if not re.fullmatch(r'\d{6}', code):
        raise ValueError(f"无效股票代码: {code}，必须是六位数字")
    return code


def cninfo_announcements(
    code: str,
    page_size: int = 30,
    page_num: int = 1,
    start_date: str = "",
    end_date: str = "",
    category: str = "",
) -> dict[str, Any]:
    """
    巨潮公告全文检索。
    返回: {announcements: [...], totalAnnouncement: int, ...}
    """
    raw_code = normalize_stock_code(code)
    org_id = _cninfo_orgid(raw_code)

    payload: dict[str, str] = {
        "stock": f"{raw_code},{org_id}",
        "tabName": "fulltext",
        "pageSize": str(page_size),
        "pageNum": str(page_num),
        "column": "",
        "category": category,
        "plate": "",
        "seDate": (
            f"{start_date}~{end_date}"
            if start_date and end_date
            else f"2000-01-01~{end_date}" if end_date else f"{start_date}~2030-12-31" if start_date else ""
        ),
        "searchkey": "",
        "secid": "",
        "sortName": "",
        "sortType": "",
        "isHLtitle": "true",
    }
    headers = {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": f"{CNINFO_BASE}/new/disclosure",
        "Origin": CNINFO_BASE,
    }
    try:
        r = _retry_http(requests.post, CNINFO_QUERY_URL, data=payload, headers=headers, timeout=15)
        r.raise_for_status()
        return r.json()
    except (requests.RequestException, OSError) as e:
        logger.error(f"巨潮公告查询失败 {code}: {e}")
        return {"announcements": [], "totalAnnouncement": 0, "hasMore": False}


def cninfo_list_all(
    code: str,
    max_pages: int = 10,
    page_size: int = 30,
    start_date: str = "",
    end_date: str = "",
) -> list[dict]:
    """
    分页拉取巨潮全部公告。
    注意：巨潮 API 单页最多返回 30 条（硬限制），page_size 超过 30 无效。
    返回: [{title, type, date, announcement_id, adjunct_url, ...}]
    """
    # 巨潮 API 单页硬限制 30 条
    effective_page_size = min(page_size, 30)
    all_items: list[dict] = []
    for page in range(1, max_pages + 1):
        data = cninfo_announcements(
            code=code,
            page_size=effective_page_size,
            page_num=page,
            start_date=start_date,
            end_date=end_date,
        )
        items = data.get("announcements") or []
        if not items:
            logger.info(f"  第 {page} 页无公告返回，停止翻页")
            break
        for item in items:
            adjunct_url = item.get("adjunctUrl", "") or ""
            if adjunct_url and not adjunct_url.startswith("http"):
                adjunct_url = f"{CNINFO_STATIC}/{adjunct_url.lstrip('/')}"
            all_items.append({
                "announcement_id": str(item.get("announcementId", "")),
                "title": item.get("announcementTitle", ""),
                "type": item.get("announcementTypeName", ""),
                "type_code": item.get("announcementTypeCode", ""),
                "date": _cninfo_ts_to_date(item.get("announcementTime")),
                "adjunct_url": adjunct_url,
                "adjunct_size": item.get("adjunctSize", 0),
                "file_type": item.get("fileType", ""),
            })
        time.sleep(0.3 + random.uniform(0.05, 0.15))  # 礼貌间隔

        actual_count = len(items)
        total = data.get("totalAnnouncement", 0)
        # 翻页终止条件：已取够所有数据
        if total and page * actual_count >= total:
            break

    return all_items


def is_periodic_report(title: str, announce_type: str | None) -> bool:
    """
    判断是否为正式定期报告。
    仅包含年报、半年报、一季报、三季报；不包含摘要、审计报告、
    内控评价、募集资金专项报告、ESG 等随定期报告披露的附件。
    """
    normalized = re.sub(r"\s+", "", title or "")
    announce_type = re.sub(r"\s+", "", announce_type or "")

    excluded_keywords = [
        "摘要", "英文", "取消", "提示性公告", "说明公告", "更正公告",
        "补充公告", "延期", "关于", "专项报告", "募集资金", "审计报告",
        "内部控制", "社会责任报告", "ESG", "环境、社会及管治", "可持续发展",
    ]
    if any(kw in normalized for kw in excluded_keywords):
        return False

    report_patterns = [
        r"(?:19|20)\d{2}年年度报告(?:（修订版）|\(修订版\))?$",
        r"(?:19|20)\d{2}年半年度报告(?:（修订版）|\(修订版\))?$",
        r"(?:19|20)\d{2}年(?:第一季度|一季度)报告(?:（修订版）|\(修订版\))?$",
        r"(?:19|20)\d{2}年(?:第三季度|三季度)报告(?:（修订版）|\(修订版\))?$",
    ]
    if any(re.fullmatch(pattern, normalized) for pattern in report_patterns):
        return True

    type_keywords = ["年度报告", "半年度报告", "第一季度报告", "第三季度报告"]
    return any(kw == announce_type for kw in type_keywords)


def is_not_full_report(title: str = "") -> bool:
    """排除摘要、提示性公告、取消公告等非完整报告。"""
    title = title or ""
    # 定期报告摘要排除
    if "摘要" in title and "报告" in title:
        return True
    # 排除包含以下关键词的公告（但含"修订"的更正公告保留）
    exclude_keywords = [
        "提示性公告", "取消", "说明公告",
        "关于召开", "股东大会通知", "董事会决议公告",
        "监事会决议公告", "股权激励", "限售股份",
    ]
    for kw in exclude_keywords:
        if kw in title:
            return True
    # 更正/补充公告：含"修订"的不排除，其他的排除
    if "更正公告" in title and "修订" not in title:
        return True
    if "补充公告" in title and "修订" not in title:
        return True
    if "延期" in title:
        return True
    return False


def safe_filename(title: str, max_len: int = 80) -> str:
    """清洗非法文件名字符并截断"""
    cleaned = re.sub(r'[\\/:*?"<>|]', '_', title)
    cleaned = re.sub(r'\s+', '_', cleaned)
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len]
    return cleaned.strip('_') or 'untitled'


def download_pdf(
    url: str,
    save_path: str | Path,
    expected_size: int = 0,
) -> dict[str, Any]:
    """
    下载 PDF 并校验。
    返回: {status, local_path, sha256, error_message}
    """
    save_path = Path(save_path)
    result = {
        "status": "failed",
        "local_path": str(save_path),
        "sha256": "",
        "error_message": "",
    }

    # 校验 URL
    if not url:
        result["error_message"] = "empty_url"
        return result

    # 下载
    try:
        headers = {
            "User-Agent": UA,
            "Referer": f"{CNINFO_BASE}/new/disclosure",
        }
        r = _retry_http(requests.get, url, headers=headers, timeout=30, stream=True)
        r.raise_for_status()
    except (requests.RequestException, OSError) as e:
        result["error_message"] = f"http_error: {e}"
        return result

    content = r.content

    # 校验 PDF 文件头
    if not content.startswith(b"%PDF"):
        result["error_message"] = "not_a_pdf"
        result["sha256"] = hashlib.sha256(content).hexdigest()
        return result

    # 校验文件大小异常（小于 1KB 可能为空文件）
    if len(content) < 1024:
        result["error_message"] = f"file_too_small: {len(content)} bytes"
        result["sha256"] = hashlib.sha256(content).hexdigest()
        return result

    # 写入
    save_path.parent.mkdir(parents=True, exist_ok=True)
    save_path.write_bytes(content)

    sha256 = hashlib.sha256(content).hexdigest()
    result["status"] = "downloaded"
    result["sha256"] = sha256

    return result


def get_report_date_range(years_back: int = 3) -> tuple[str, str]:
    """获取近 N 年的日期范围字符串"""
    today = datetime.now()
    start_year = today.year - years_back
    try:
        start = today.replace(year=start_year)
    except ValueError:
        # 闰年 2 月 29 日，目标年份非闰年（如 2024→2023）：回退到 2 月 28 日
        start = today.replace(year=start_year, day=28)
    return start.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")
