"""SCORM preview player: mock LMS API + HTML wrapper for iSpring quiz."""

from __future__ import annotations

import re
from pathlib import Path

MOCK_SCORM_SCRIPT = """
<script>
(function () {
  var store = {
    "cmi.core.lesson_status": "not attempted",
    "cmi.core.score.raw": "",
    "cmi.core.score.max": "",
    "cmi.core.score.min": "0",
    "cmi.core.lesson_location": "",
    "cmi.core.lesson_mode": "normal",
    "cmi.core.exit": "",
    "cmi.core.session_time": "00:00:00",
    "cmi.core.total_time": "00:00:00",
    "cmi.suspend_data": "",
    "cmi.core.student_id": "preview-user",
    "cmi.core.student_name": "Preview User",
    "cmi.interactions._count": "0"
  };
  var initialized = false;

  function snapshot() {
    var out = {};
    for (var k in store) {
      if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
    }
    return out;
  }

  function notify() {
    try {
      window.parent.postMessage({
        type: "scorm-preview-update",
        initialized: initialized,
        data: snapshot()
      }, "*");
    } catch (e) {}
  }

  function setValue(element, value) {
    if (element && element.indexOf("cmi.interactions.") === 0) {
      var m = element.match(/^cmi\\.interactions\\.(\\d+)\\.(.+)$/);
      if (m) store[element] = value;
      else store[element] = value;
    } else {
      store[element] = value;
    }
    notify();
    return "true";
  }

  window.API = {
    LMSInitialize: function () {
      initialized = true;
      notify();
      return "true";
    },
    LMSFinish: function () {
      initialized = false;
      notify();
      return "true";
    },
    LMSGetValue: function (element) {
      return store[element] != null ? String(store[element]) : "";
    },
    LMSSetValue: setValue,
    LMSCommit: function () {
      notify();
      return "true";
    },
    LMSGetLastError: function () { return "0"; },
    LMSGetErrorString: function () { return ""; },
    LMSGetDiagnostic: function () { return ""; }
  };

  window.resetScormPreview = function () {
    store["cmi.core.lesson_status"] = "not attempted";
    store["cmi.core.score.raw"] = "";
    store["cmi.core.score.max"] = "";
    store["cmi.core.lesson_location"] = "";
    store["cmi.suspend_data"] = "";
    store["cmi.core.session_time"] = "00:00:00";
    store["cmi.interactions._count"] = "0";
    initialized = false;
    notify();
  };

  notify();
})();
</script>
"""


def _insert_after_tag(html: str, tag_pattern: str, insertion: str) -> str:
    match = re.search(tag_pattern, html, flags=re.IGNORECASE)
    if not match:
        return html
    pos = match.end()
    return html[:pos] + insertion + html[pos:]


def build_preview_html(index_html: str, session_id: str) -> str:
    """Inject mock SCORM API and base URL so player assets resolve correctly."""
    base_href = f"/api/session/{session_id}/preview/res/"
    base_tag = f'\n\t<base href="{base_href}">'

    html = index_html
    if "<base " not in html.lower():
        html = _insert_after_tag(html, r"<head[^>]*>", base_tag)

    if "window.API" not in html:
        html = _insert_after_tag(html, r"<body[^>]*>", "\n" + MOCK_SCORM_SCRIPT)

    return html


def preview_res_root(package_root: Path) -> Path:
    """Directory containing index.html relative assets (usually package/res)."""
    for candidate in [package_root / "res", package_root]:
        index = candidate / "index.html"
        if index.exists():
            return candidate
    raise FileNotFoundError("Không tìm thấy thư mục res cho preview")