"""Safe local/HTTPS media resolution for portable export packages."""

from __future__ import annotations

import ipaddress
import mimetypes
import os
import socket
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit


REMOTE_MEDIA_MAX_FILE_BYTES = int(
    os.getenv("REMOTE_MEDIA_MAX_FILE_BYTES", str(100 * 1024 * 1024))
)
REMOTE_MEDIA_MAX_TOTAL_BYTES = int(
    os.getenv("REMOTE_MEDIA_MAX_TOTAL_BYTES", str(500 * 1024 * 1024))
)
REMOTE_MEDIA_TIMEOUT_SECONDS = float(os.getenv("REMOTE_MEDIA_TIMEOUT_SECONDS", "20"))

MEDIA_MIME_PREFIXES = ("image/", "audio/", "video/")
SAFE_FALLBACK_MIMES = {"application/octet-stream", "binary/octet-stream"}


class RemoteMediaError(ValueError):
    pass


def is_remote_url(value: str | None) -> bool:
    return bool(value and str(value).lower().startswith(("http://", "https://")))


def url_filename(value: str) -> str:
    return Path(urlsplit(value).path).name


def _validate_public_host(
    url: str,
    *,
    resolver: Callable[..., Any] = socket.getaddrinfo,
) -> None:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RemoteMediaError("Media URL phải dùng HTTP/HTTPS hợp lệ")
    try:
        addresses = {
            result[4][0]
            for result in resolver(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
        }
    except OSError as exc:
        raise RemoteMediaError(f"Không phân giải được media host: {parsed.hostname}") from exc
    if not addresses:
        raise RemoteMediaError(f"Không phân giải được media host: {parsed.hostname}")
    for address in addresses:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
        if not ip.is_global:
            raise RemoteMediaError("Từ chối media URL trỏ tới mạng nội bộ/localhost")


def _suffix_for(url: str, content_type: str) -> str:
    suffix = Path(urlsplit(url).path).suffix.lower()
    if suffix and len(suffix) <= 8:
        return suffix
    guessed = mimetypes.guess_extension(content_type.split(";", 1)[0].strip())
    return guessed or ".bin"


def fetch_remote_media(
    url: str,
    *,
    max_bytes: int = REMOTE_MEDIA_MAX_FILE_BYTES,
    opener: Callable[..., Any] = urllib.request.urlopen,
    resolver: Callable[..., Any] = socket.getaddrinfo,
) -> tuple[bytes, str, str]:
    """Download one public media URL with SSRF, type, timeout and size guards."""
    _validate_public_host(url, resolver=resolver)
    request = urllib.request.Request(url, headers={"User-Agent": "SCORM-Editor/1.0"})
    with opener(request, timeout=REMOTE_MEDIA_TIMEOUT_SECONDS) as response:
        final_url = response.geturl() if hasattr(response, "geturl") else url
        if final_url != url:
            _validate_public_host(final_url, resolver=resolver)
        content_type = (response.headers.get("Content-Type") or "application/octet-stream").lower()
        mime = content_type.split(";", 1)[0].strip()
        if not mime.startswith(MEDIA_MIME_PREFIXES) and mime not in SAFE_FALLBACK_MIMES:
            raise RemoteMediaError(f"URL không trả về media hợp lệ ({mime})")
        raw_length = response.headers.get("Content-Length")
        if raw_length and int(raw_length) > max_bytes:
            raise RemoteMediaError("Media vượt giới hạn kích thước mỗi file")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = response.read(min(1024 * 1024, max_bytes - total + 1))
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise RemoteMediaError("Media vượt giới hạn kích thước mỗi file")
            chunks.append(chunk)
    return b"".join(chunks), _suffix_for(final_url, mime), mime


class MediaBundler:
    """Resolve session or remote media and add every asset once to a ZIP."""

    def __init__(self, session: Any, archive: Any, *, max_total_bytes: int = REMOTE_MEDIA_MAX_TOTAL_BYTES):
        self.session = session
        self.archive = archive
        self.max_total_bytes = max_total_bytes
        self.total_bytes = 0
        self.cache: dict[str, str] = {}
        self.bytes_cache: dict[str, tuple[bytes, str]] = {}
        self.names: set[str] = set()
        self.warnings: list[str] = []

    def read(self, reference: str | None) -> tuple[bytes, str] | None:
        raw = str(reference or "").strip()
        if not raw:
            return None
        if raw in self.bytes_cache:
            return self.bytes_cache[raw]
        search_value = url_filename(raw) if is_remote_url(raw) else raw
        try:
            path = self.session.asset_path(search_value)
            data = path.read_bytes()
            suffix = path.suffix.lower() or ".bin"
        except (FileNotFoundError, OSError):
            if not is_remote_url(raw):
                self.warnings.append(f"Không tìm thấy media local: {raw}")
                return None
            try:
                data, suffix, _ = fetch_remote_media(raw)
            except Exception as exc:
                self.warnings.append(f"Không tải được media remote {raw}: {exc}")
                return None
        if self.total_bytes + len(data) > self.max_total_bytes:
            self.warnings.append(f"Bỏ qua media vượt tổng giới hạn package: {raw}")
            return None
        self.total_bytes += len(data)
        self.bytes_cache[raw] = (data, suffix)
        return data, suffix

    def add(self, reference: str | None, proposed_name: str) -> str:
        raw = str(reference or "").strip()
        if not raw:
            return ""
        if raw in self.cache:
            return self.cache[raw]
        resolved = self.read(raw)
        if not resolved:
            return raw if is_remote_url(raw) else ""
        data, suffix = resolved
        stem = "".join(c if c.isalnum() or c in " _-" else "_" for c in proposed_name).strip() or "media"
        archive_name = f"media/{stem[:120]}{suffix}"
        index = 2
        while archive_name in self.names:
            archive_name = f"media/{stem[:110]}_{index}{suffix}"
            index += 1
        self.archive.writestr(archive_name, data)
        self.names.add(archive_name)
        self.cache[raw] = archive_name
        return archive_name
