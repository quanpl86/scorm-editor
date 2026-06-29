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

NAVIGATION_BRIDGE_SCRIPT = """
<script>
(function () {
  var player = null;
  var playerReady = false;
  var pendingNav = null;
  var navigating = false;

  function getUrlParam(name) {
    var match = location.search.match(new RegExp("[?&]" + name + "=([^&]*)"));
    return match ? decodeURIComponent(match[1]) : "";
  }

  function readEditorConfig() {
    return {
      editorMode: getUrlParam("editor") === "1",
      slideId: getUrlParam("slideId"),
      qIndex: getUrlParam("qIndex"),
      skipAutoStart: getUrlParam("skipStart") === "1"
    };
  }

  function postToParent(payload) {
    try {
      window.parent.postMessage(payload, "*");
    } catch (e) {}
  }

  function getController() {
    return player && player.Wy ? player.Wy : null;
  }

  function getSession() {
    try {
      return player && player.currentSession ? player.currentSession() : null;
    } catch (e) {
      return null;
    }
  }

  function isTestingMode() {
    try {
      var session = getSession();
      return !!(session && session.sessionMode && session.sessionMode() === "testing");
    } catch (e) {
      return false;
    }
  }

  function getSlidePool() {
    try {
      var session = getSession();
      return session && session.Oa ? session.Oa() : null;
    } catch (e) {
      return null;
    }
  }

  function findSlideIndexById(oa, slideId) {
    if (!oa || !slideId) return -1;
    var slides = oa.Ca || [];
    for (var i = 0; i < slides.length; i++) {
      try {
        if (slides[i].slide().id() === slideId) return i;
      } catch (e) {}
    }
    return -1;
  }

  function resolveTargetIndex(oa, slideId, qIndex) {
    if (oa && slideId) {
      var byId = findSlideIndexById(oa, slideId);
      if (byId >= 0) return byId;
    }
    if (qIndex !== "" && qIndex != null && !isNaN(Number(qIndex))) {
      var idx = Number(qIndex);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function clickStartButton() {
    var nodes = document.querySelectorAll("button, [tabindex], [role='button']");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || el.offsetParent === null) continue;
      var text = (el.textContent || el.innerText || "").replace(/\\s+/g, " ").trim().toUpperCase();
      if (text.indexOf("START QUIZ") >= 0 || text.indexOf("START SURVEY") >= 0 ||
          text.indexOf("BẮT ĐẦU") >= 0 || text === "START") {
        try {
          el.click();
          return true;
        } catch (e) {}
      }
    }
    return false;
  }

  function triggerStartQuiz() {
    var started = false;
    try {
      var ctrl = getController();
      if (ctrl && ctrl.Xa && ctrl.Xa.Se && ctrl.Xa.Se.start) {
        ctrl.Xa.Se.start();
        started = true;
      }
    } catch (e) {}
    try {
      var session = getSession();
      if (session && typeof session.start === "function") {
        session.start();
        started = true;
      }
    } catch (e) {}
    if (clickStartButton()) started = true;
    return started;
  }

  var startObserver = null;
  function watchStartButton() {
    if (startObserver) return;
    startObserver = new MutationObserver(function () {
      if (isTestingMode()) {
        startObserver.disconnect();
        startObserver = null;
        return;
      }
      clickStartButton();
    });
    startObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function refreshSlideDisplay() {
    try {
      var ctrl = getController();
      if (!ctrl) return;
      if (typeof ctrl.fL === "function") {
        ctrl.fL();
      } else if (typeof ctrl.wN === "function") {
        ctrl.wN();
      }
    } catch (e) {}
  }

  function applySlideIndex(oa, index) {
    if (!oa || index < 0) return false;
    if (!oa.setActiveSlideIndex) return false;
    oa.setActiveSlideIndex(index);
    refreshSlideDisplay();
    return true;
  }

  function notifyCurrentSlide() {
    if (!player || !player.currentSlideId) return;
    try {
      var slideId = player.currentSlideId();
      if (slideId) {
        postToParent({ type: "scorm-preview-slide-changed", slideId: slideId });
      }
    } catch (e) {}
  }

  function navigateToTarget(target) {
    if (!player || !target) return;
    navigating = true;
    watchStartButton();

    var slideId = target.slideId || "";
    var qIndex = target.qIndex != null ? String(target.qIndex) : "";
    var skipAutoStart = !!target.skipAutoStart;
    var attempts = 0;
    var maxAttempts = 120;
    var startClicks = 0;

    function finish(ok) {
      navigating = false;
      if (ok) {
        setTimeout(notifyCurrentSlide, 200);
      }
    }

    function step() {
      attempts++;
      try {
        var testing = isTestingMode();
        var oa = getSlidePool();

        if (!skipAutoStart && !testing && startClicks < 20) {
          if (attempts % 2 === 0) {
            if (triggerStartQuiz()) startClicks++;
          }
        }

        if (!oa) {
          if (attempts < maxAttempts) return setTimeout(step, 200);
          return finish(false);
        }

        if (!testing && !skipAutoStart) {
          if (attempts < maxAttempts) return setTimeout(step, 200);
          return finish(false);
        }

        var index = resolveTargetIndex(oa, slideId, qIndex);
        if (index < 0) {
          if (attempts < maxAttempts) return setTimeout(step, 200);
          return finish(false);
        }

        if (!applySlideIndex(oa, index)) {
          if (attempts < maxAttempts) return setTimeout(step, 200);
          return finish(false);
        }

        setTimeout(function () { finish(true); }, 250);
      } catch (e) {
        if (attempts < maxAttempts) return setTimeout(step, 200);
        finish(false);
      }
    }

    step();
  }

  function queueNavigate(target) {
    if (!target || !target.slideId) return;
    pendingNav = target;
    if (playerReady) {
      var next = pendingNav;
      pendingNav = null;
      navigateToTarget(next);
    }
  }

  function markPlayerReady() {
    if (playerReady) return;
    playerReady = true;
    postToParent({ type: "scorm-preview-player-ready" });

    if (player.slideChangedEvent) {
      try {
        player.slideChangedEvent().addHandler(function () {
          notifyCurrentSlide();
        });
      } catch (e) {}
    }

    var cfg = readEditorConfig();
    var target = pendingNav || {
      slideId: cfg.slideId,
      qIndex: cfg.qIndex,
      skipAutoStart: cfg.skipAutoStart
    };
    pendingNav = null;

    if (target.slideId) {
      setTimeout(function () { navigateToTarget(target); }, cfg.editorMode ? 800 : 300);
    } else {
      setTimeout(notifyCurrentSlide, 300);
    }
  }

  function setupPlayer(p) {
    player = p;
    var ready = false;
    function onceReady() {
      if (ready) return;
      ready = true;
      markPlayerReady();
    }

    if (p.initializationCompleteEvent) {
      try {
        p.initializationCompleteEvent().addHandler(onceReady);
      } catch (e) {
        setTimeout(onceReady, 1200);
      }
    } else {
      setTimeout(onceReady, 1200);
    }
    setTimeout(onceReady, 5000);
  }

  window.scormPreviewGoToSlide = function (slideId, qIndex) {
    queueNavigate({
      slideId: slideId,
      qIndex: qIndex != null && Number(qIndex) >= 0 ? qIndex : "",
      skipAutoStart: false
    });
    return true;
  };

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "scorm-preview-goto-slide" && data.slideId) {
      var target = {
        slideId: data.slideId,
        qIndex: data.qIndex != null && Number(data.qIndex) >= 0 ? data.qIndex : "",
        skipAutoStart: false
      };
      if (playerReady) navigateToTarget(target);
      else pendingNav = target;
    }
  });

  function patchLms() {
    if (!window.iSpring || !window.iSpring.quiz || !window.iSpring.quiz.LMS) return false;
    var OrigLMS = window.iSpring.quiz.LMS;
    if (OrigLMS.__scormPreviewPatched) return true;
    var origCreate = OrigLMS.create;
    OrigLMS.create = function () {
      var lms = origCreate.apply(this, arguments);
      var origInit = lms.initialize;
      if (typeof origInit === "function") {
        lms.initialize = function (startFn, resumeMode, onPlayerReady) {
          var mode = readEditorConfig().editorMode ? "never" : resumeMode;
          return origInit.call(this, startFn, mode, function (p) {
            setupPlayer(p);
            if (typeof onPlayerReady === "function") onPlayerReady(p);
          });
        };
      }
      return lms;
    };
    OrigLMS.__scormPreviewPatched = true;
    return true;
  }

  watchStartButton();
  if (!patchLms()) {
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (patchLms() || tries > 200) clearInterval(timer);
    }, 50);
  }
})();
</script>
"""


def _insert_after_tag(html: str, tag_pattern: str, insertion: str) -> str:
    match = re.search(tag_pattern, html, flags=re.IGNORECASE)
    if not match:
        return html
    pos = match.end()
    return html[:pos] + insertion + html[pos:]


def _inject_navigation_bridge(html: str) -> str:
    """Inject bridge before inline LMS init so LMS.create hook runs in time."""
    if "scormPreviewGoToSlide" in html:
        return html

    lms_tag = re.search(
        r"<script[^>]*\bsrc=[\"'][^\"']*lms\.js[^\"']*[\"'][^>]*>\s*</script>",
        html,
        flags=re.IGNORECASE,
    )
    if lms_tag:
        pos = lms_tag.end()
        return html[:pos] + "\n" + NAVIGATION_BRIDGE_SCRIPT + html[pos:]

    inline_init = re.search(
        r"(var\s+lms\s*=\s*iSpring\.quiz\.LMS\.create)",
        html,
        flags=re.IGNORECASE,
    )
    if inline_init:
        pos = inline_init.start()
        return html[:pos] + NAVIGATION_BRIDGE_SCRIPT + "\n" + html[pos:]

    if re.search(r"</body>", html, flags=re.IGNORECASE):
        return re.sub(
            r"</body>",
            NAVIGATION_BRIDGE_SCRIPT + "\n</body>",
            html,
            count=1,
            flags=re.IGNORECASE,
        )
    return html + NAVIGATION_BRIDGE_SCRIPT


def build_preview_html(index_html: str, session_id: str) -> str:
    """Inject mock SCORM API and base URL so player assets resolve correctly."""
    base_href = f"/api/session/{session_id}/preview/res/"
    base_tag = f'\n\t<base href="{base_href}">'

    html = index_html
    if "<base " not in html.lower():
        html = _insert_after_tag(html, r"<head[^>]*>", base_tag)

    if "window.API" not in html:
        html = _insert_after_tag(html, r"<body[^>]*>", "\n" + MOCK_SCORM_SCRIPT)

    html = _inject_navigation_bridge(html)

    return html


def preview_res_root(package_root: Path) -> Path:
    """Directory containing index.html relative assets (usually package/res)."""
    for candidate in [package_root / "res", package_root]:
        index = candidate / "index.html"
        if index.exists():
            return candidate
    raise FileNotFoundError("Không tìm thấy thư mục res cho preview")