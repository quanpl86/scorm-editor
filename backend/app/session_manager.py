"""Concurrency, activity tracking, cleanup, and quota controls for editor sessions."""

from __future__ import annotations

import os
import json
import shutil
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


SESSION_IDLE_TTL_SECONDS = int(os.getenv("SESSION_IDLE_TTL_SECONDS", str(2 * 3600)))
SESSION_STORAGE_LIMIT_BYTES = int(os.getenv("SESSION_STORAGE_LIMIT_BYTES", str(1024**3)))
SESSION_MAX_UPLOAD_BYTES = int(os.getenv("SESSION_MAX_UPLOAD_BYTES", str(512 * 1024**2)))
SESSION_STORAGE_TARGET_RATIO = float(os.getenv("SESSION_STORAGE_TARGET_RATIO", "0.85"))
SESSION_CLEANUP_INTERVAL_SECONDS = int(os.getenv("SESSION_CLEANUP_INTERVAL_SECONDS", "600"))

_locks_guard = threading.Lock()
_session_locks: dict[str, threading.RLock] = {}
_storage_write_guard = threading.RLock()


class SessionStorageFullError(RuntimeError):
    pass


ACTIVITY_FILENAME = ".session_activity.json"


def get_session_lock(session_id: str) -> threading.RLock:
    with _locks_guard:
        return _session_locks.setdefault(session_id, threading.RLock())


@contextmanager
def session_lock(session_id: str) -> Iterator[None]:
    lock = get_session_lock(session_id)
    lock.acquire()
    try:
        yield
    finally:
        lock.release()


@contextmanager
def storage_write_lock() -> Iterator[None]:
    """Serialize capacity checks with persistent writes so users cannot overbook the disk."""
    with _storage_write_guard:
        yield


def touch_session(root: Path, session_id: str, *, event: str = "access") -> None:
    session_dir = root / session_id
    if session_dir.is_dir():
        try:
            now = time.time()
            activity_path = session_dir / ACTIVITY_FILENAME
            try:
                activity = json.loads(activity_path.read_text(encoding="utf-8"))
            except (FileNotFoundError, json.JSONDecodeError, OSError):
                activity = {}
            activity["lastAccessedAt"] = now
            if event == "save":
                activity["lastSavedAt"] = now
            elif event == "heartbeat":
                activity["lastHeartbeatAt"] = now
            elif event == "create":
                activity.setdefault("createdAt", now)
            temp_path = activity_path.with_name(
                f".{ACTIVITY_FILENAME}.{uuid.uuid4().hex}.tmp"
            )
            temp_path.write_text(json.dumps(activity, separators=(",", ":")), encoding="utf-8")
            os.replace(temp_path, activity_path)
            os.utime(session_dir, None)
        except FileNotFoundError:
            pass


def session_last_accessed(item: Path) -> float:
    if item.is_dir():
        try:
            activity = json.loads((item / ACTIVITY_FILENAME).read_text(encoding="utf-8"))
            value = float(activity.get("lastAccessedAt", 0))
            if value > 0:
                return value
        except (FileNotFoundError, json.JSONDecodeError, OSError, TypeError, ValueError):
            pass
    return item.stat().st_mtime


def _tree_size(path: Path) -> int:
    total = 0
    try:
        for item in path.rglob("*"):
            try:
                if item.is_file():
                    total += item.stat().st_size
            except FileNotFoundError:
                continue
    except FileNotFoundError:
        return 0
    return total


def sessions_size(root: Path) -> int:
    if not root.exists():
        return 0
    return _tree_size(root)


def _is_session_dir(item: Path) -> bool:
    """Only manage UUID session directories; never delete marker/config files."""
    if not item.is_dir():
        return False
    try:
        uuid.UUID(item.name)
    except ValueError:
        return False
    return True


def _try_remove(item: Path, *, protected_ids: set[str]) -> tuple[bool, int]:
    session_id = item.name
    if session_id in protected_ids:
        return False, 0
    lock = get_session_lock(session_id)
    if not lock.acquire(blocking=False):
        return False, 0
    size = _tree_size(item) if item.is_dir() else 0
    try:
        if item.is_dir():
            shutil.rmtree(item, ignore_errors=False)
        else:
            size = item.stat().st_size if item.exists() else 0
            item.unlink(missing_ok=True)
        return True, size
    except FileNotFoundError:
        return True, size
    finally:
        lock.release()


def delete_session_dir(root: Path, session_id: str) -> bool:
    item = root / session_id
    if not item.exists():
        return False
    with session_lock(session_id):
        if item.is_dir():
            shutil.rmtree(item, ignore_errors=True)
        else:
            item.unlink(missing_ok=True)
    return True


def cleanup_sessions(
    root: Path,
    *,
    now: float | None = None,
    protected_ids: set[str] | None = None,
) -> dict[str, int]:
    """Delete idle sessions, then reduce storage to the configured target."""
    protected = set(protected_ids or ())
    current_time = now or time.time()
    root.mkdir(parents=True, exist_ok=True)
    removed = 0
    freed = 0

    items: list[tuple[float, Path]] = []
    for item in list(root.iterdir()):
        if not _is_session_dir(item):
            continue
        try:
            items.append((session_last_accessed(item), item))
        except FileNotFoundError:
            continue

    for modified, item in items:
        if current_time - modified < SESSION_IDLE_TTL_SECONDS:
            continue
        did_remove, size = _try_remove(item, protected_ids=protected)
        if did_remove:
            removed += 1
            freed += size

    total = sessions_size(root)
    target = int(SESSION_STORAGE_LIMIT_BYTES * SESSION_STORAGE_TARGET_RATIO)
    if total > target:
        remaining = []
        for item in list(root.iterdir()):
            if not _is_session_dir(item):
                continue
            try:
                modified = session_last_accessed(item)
                if current_time - modified >= SESSION_IDLE_TTL_SECONDS:
                    remaining.append((modified, item))
            except FileNotFoundError:
                continue
        for _, item in sorted(remaining, key=lambda row: row[0]):
            if total <= target:
                break
            did_remove, size = _try_remove(item, protected_ids=protected)
            if did_remove:
                removed += 1
                freed += size
                total = max(0, total - size)

    return {"removed": removed, "freedBytes": freed, "remainingBytes": sessions_size(root)}


def ensure_storage_capacity(
    root: Path,
    *,
    reserve_bytes: int = 0,
    protected_ids: set[str] | None = None,
) -> int:
    cleanup_sessions(root, protected_ids=protected_ids)
    used = sessions_size(root)
    if used + max(0, reserve_bytes) > SESSION_STORAGE_LIMIT_BYTES:
        raise SessionStorageFullError(
            f"Dung lượng session đã đạt giới hạn "
            f"{SESSION_STORAGE_LIMIT_BYTES / 1024**3:.1f} GB"
        )
    return used
