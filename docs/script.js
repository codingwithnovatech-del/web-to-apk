const GITHUB_REPO = "codingwithnovatech-del/web-to-apk";

function handleLogin() {
  const user = document.getElementById("loginUser").value.trim();
  const token = document.getElementById("loginToken").value.trim();
  if (!user || !token) { alert("Please fill in all fields"); return; }
  if (!token.startsWith("ghp_") && !token.startsWith("github_pat_")) {
    alert("Invalid token format. It should start with 'ghp_' or 'github_pat_'");
    return;
  }
  localStorage.setItem("github_user", user);
  localStorage.setItem("github_token", token);
  showApp();
}

function handleLogout() {
  localStorage.removeItem("github_user");
  localStorage.removeItem("github_token");
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("appScreen").classList.add("hidden");
  document.getElementById("loginToken").value = "";
  document.getElementById("loginUser").value = "";
}

function showApp() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appScreen").classList.remove("hidden");
  const user = localStorage.getItem("github_user") || "User";
  document.getElementById("greeting").textContent = "Hi, " + user;
}

function getToken() {
  return localStorage.getItem("github_token");
}

async function startBuild() {
  const token = getToken();
  if (!token) { handleLogout(); showError("Session expired. Please login again."); return; }

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

  const buildId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  setProgress("⏳", "Starting build...", "Triggering GitHub Actions...", 5);

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/build.yml/dispatches`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { url, app_name: name, build_id: buildId }
      })
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        showError("Invalid or expired token. Please login again.");
      } else {
        showError("Failed to trigger build (HTTP " + res.status + ")");
      }
      return;
    }

    setProgress("📦", "Build queued", "Waiting for build to start...", 15);
    pollStatus(buildId, name);
  } catch (e) {
    showError("Cannot connect to GitHub API. Check your internet connection.");
  }
}

async function pollStatus(buildId, appName) {
  const statusUrl = `https://codingwithnovatech-del.github.io/web-to-apk/builds/${buildId}.json`;
  let pollCount = 0;
  const maxPolls = 120;

  const interval = setInterval(async () => {
    pollCount++;

    const dots = ".".repeat(pollCount % 4);
    setProgress("⏳", `Building${dots}`, "Compiling APK... This takes 2-3 minutes", Math.min(pollCount * 2, 90));

    try {
      const res = await fetch(statusUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "completed") {
          clearInterval(interval);
          showDownload(data.download_url, appName);
          return;
        }
      }
    } catch (e) {}

    if (pollCount >= maxPolls) {
      clearInterval(interval);
      showError("Build timed out. Check GitHub Actions for status.");
    }
  }, 3000);
}

function setProgress(icon, text, info, percent) {
  document.getElementById("statusIcon").textContent = icon;
  document.getElementById("statusText").textContent = text;
  document.getElementById("progressInfo").textContent = info;
  document.getElementById("progressFill").style.width = percent + "%";
}

function showDownload(url, appName) {
  document.getElementById("progress").classList.add("hidden");
  document.getElementById("downloadArea").classList.remove("hidden");
  document.getElementById("downloadAppName").textContent = appName;
  document.getElementById("downloadLink").href = url;
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

// Auto-login on load
window.onload = function() {
  if (localStorage.getItem("github_token") && localStorage.getItem("github_user")) {
    showApp();
  }
};
