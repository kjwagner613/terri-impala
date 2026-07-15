(() => {
  const dialog = document.getElementById("feedback-dialog");
  const openButton = document.getElementById("feedback-btn");
  const closeButton = document.getElementById("feedback-close");
  const form = document.getElementById("feedback-form");
  const messageInput = document.getElementById("feedback-text");
  const sendButton = document.getElementById("feedback-send");
  const status = document.getElementById("feedback-status");
  const sentimentButtons = [...document.querySelectorAll("[data-sentiment]")];
  const config = window.KW_PLAYER_CONFIG || {};
  let selectedSentiment = "";

  function getApiBaseUrl() {
    return window.ImpalaConfig?.getCloudApiBaseUrl?.()
      || String(config.apiBaseUrl || "").replace(/\/+$/, "");
  }

  function setStatus(message, state = "") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function selectSentiment(value) {
    selectedSentiment = selectedSentiment === value ? "" : value;
    sentimentButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.sentiment === selectedSentiment));
    });
  }

  function getDeviceType() {
    const userAgent = navigator.userAgent || "";
    if (/tablet|ipad/i.test(userAgent)) return "tablet";
    if (/mobile|iphone|android/i.test(userAgent)) return "mobile";
    return "desktop";
  }

  function getOperatingSystem() {
    const userAgent = navigator.userAgent || "";
    if (/windows/i.test(userAgent)) return "Windows";
    if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS";
    if (/android/i.test(userAgent)) return "Android";
    if (/mac os/i.test(userAgent)) return "macOS";
    if (/linux/i.test(userAgent)) return "Linux";
    return navigator.platform || "Unknown";
  }

  function buildContext() {
    const snapshot = window.DiagnosticStore?.getSnapshot?.() || {};
    const errors = window.DiagnosticStore?.readErrors?.() || [];
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    // Pilot-only functional support context. Do not send listener behavior,
    // playlist identity, track position, or broad runtime logs off-device.
    return {
      purpose: "pilot-functional-support",
      appVersion: config.appVersion || "unknown",
      appBuildDate: config.appBuildDate || "unknown",
      deviceType: getDeviceType(),
      os: getOperatingSystem(),
      currentScreen: window.location.pathname || "/",
      lastError: snapshot.player?.lastError || errors.at(-1)?.message || "",
      uptimeSeconds: Math.round(performance.now() / 1000),
      network: {
        online: navigator.onLine,
        effectiveType: connection?.effectiveType || "unknown"
      },
      capturedAt: new Date().toISOString()
    };
  }

  function resetForm() {
    form.reset();
    selectedSentiment = "";
    sentimentButtons.forEach((button) => button.setAttribute("aria-pressed", "false"));
    setStatus("");
  }

  openButton?.addEventListener("click", () => {
    resetForm();
    dialog.showModal();
    window.setTimeout(() => messageInput.focus(), 0);
  });

  closeButton?.addEventListener("click", () => dialog.close());
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  sentimentButtons.forEach((button) => {
    button.addEventListener("click", () => selectSentiment(button.dataset.sentiment));
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = messageInput.value.trim();
    if (!message && !selectedSentiment) {
      setStatus("Write a note or tap a reaction.", "error");
      messageInput.focus();
      return;
    }

    sendButton.disabled = true;
    setStatus("Sending…");

    try {
      const apiBaseUrl = getApiBaseUrl();
      if (!apiBaseUrl) {
        throw new Error("Feedback service is not configured.");
      }

      const headers = new Headers({ "Content-Type": "application/json" });
      const instanceId = window.ImpalaConfig?.getInstanceId?.() || "";
      if (instanceId) {
        headers.set("X-Impala-Instance-Id", instanceId);
      }
      const response = await fetch(`${apiBaseUrl}/api/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message, sentiment: selectedSentiment, context: buildContext() })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Feedback could not be sent.");

      setStatus("Thank you — feedback sent.", "success");
      window.setTimeout(() => dialog.close(), 1100);
    } catch (error) {
      console.error("Unable to send feedback:", error);
      setStatus(error.message || "Feedback could not be sent.", "error");
    } finally {
      sendButton.disabled = false;
    }
  });
})();
