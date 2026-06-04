const API_URL = "https://web-to-apk-production.up.railway.app";

async function startBuild() {
  const url = document.getElementById("urlInput").value.trim();
  const name = document.getElementById("nameInput").value.trim();

  if (!url || !name) {
    alert("Please fill in all fields");
    return;
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    alert("Please enter a valid URL starting with http:// or https://");
    return;
  }

  const btn = document.getElementById("buildBtn");
  const progress = document.getElementById("progress");
  const downloadArea = document.getElementById("downloadArea");
  const errorArea = document.getElementById("errorArea");

  downloadArea.classList.add("hidden");
  errorArea.classList.add("hidden");
  progress.classList.remove("hidden");

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Starting...';

  setProgress("⏳", "Starting build...", "Contacting server...", 5);

  try {
    const res = await fetch(`${API_URL}/api/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, app_name: name })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.detail || "Build failed to start");
      return;
    }

    setProgress("📦", "Build queued", "Waiting for build to start...", 15);
    pollStatus(data.build_id, name);
  } catch (e) {
    showError("Cannot connect to server. Make sure the backend is running.");
  }
}

async function pollStatus(buildId, appName) {
  const steps = [
    { icon: "📦", text: "Queued", info: "Build is in queue...", progress: 10 },
    { icon: "⚙️", text: "Setting up environment", info: "Preparing Android build tools...", progress: 20 },
    { icon: "📥", text: "Installing dependencies", info: "Setting up Capacitor and Node.js...", progress: 35 },
    { icon: "🏗️", text: "Creating project", info: "Generating Android project...", progress: 50 },
    { icon: "🔨", text: "Building APK", info: "Compiling and assembling APK...", progress: 70 },
    { icon: "📝", text: "Signing APK", info: "Signing with debug keystore...", progress: 85 },
    { icon: "📦", text: "Finalizing", info: "Preparing download...", progress: 95 }
  ];

  let stepIndex = 0;
  let pollCount = 0;
  const maxPolls = 120; // 6 minutes max

  const interval = setInterval(async () => {
    pollCount++;

    if (stepIndex < steps.length) {
      setProgress(steps[stepIndex].icon, steps[stepIndex].text, steps[stepIndex].info, steps[stepIndex].progress);
      stepIndex++;
    }

    try {
      const res = await fetch(`${API_URL}/api/status/${buildId}`);
      const data = await res.json();

      if (data.status === "completed") {
        clearInterval(interval);
        showDownload(buildId, appName);
        return;
      }

      if (data.status === "failed") {
        clearInterval(interval);
        showError(data.error || "Build failed. Please try again.");
        return;
      }

      // Keep polling with animated progress
      if (pollCount > steps.length) {
        const extra = Math.min((pollCount - steps.length) * 2, 15);
        setProgress("⏳", "Building...", "Still working on it. This may take a moment...", 85 + extra);
      }
    } catch (e) {
      // Ignore network errors during polling
    }

    if (pollCount >= maxPolls) {
      clearInterval(interval);
      showError("Build timed out. Please try again.");
    }
  }, 3000);

  interval;
}

function setProgress(icon, text, info, percent) {
  document.getElementById("statusIcon").textContent = icon;
  document.getElementById("statusText").textContent = text;
  document.getElementById("progressInfo").textContent = info;
  document.getElementById("progressFill").style.width = percent + "%";
}

function showDownload(buildId, appName) {
  document.getElementById("progress").classList.add("hidden");
  document.getElementById("downloadArea").classList.remove("hidden");
  document.getElementById("downloadAppName").textContent = appName;
  document.getElementById("downloadLink").href = `${API_URL}/api/download/${buildId}`;
  document.getElementById("buildBtn").disabled = false;
  document.getElementById("buildBtn").innerHTML = '<span class="btn-icon">⚡</span> Build APK';
}

function showError(message) {
  document.getElementById("progress").classList.add("hidden");
  document.getElementById("errorArea").classList.remove("hidden");
  document.getElementById("errorMessage").textContent = message;
  document.getElementById("buildBtn").disabled = false;
  document.getElementById("buildBtn").innerHTML = '<span class="btn-icon">⚡</span> Build APK';
}

function resetForm() {
  document.getElementById("downloadArea").classList.add("hidden");
  document.getElementById("errorArea").classList.add("hidden");
  document.getElementById("progress").classList.add("hidden");
  document.getElementById("buildBtn").disabled = false;
  document.getElementById("buildBtn").innerHTML = '<span class="btn-icon">⚡</span> Build APK';
}
