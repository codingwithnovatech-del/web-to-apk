const GITHUB_REPO = "codingwithnovatech-del/web-to-apk";

document.addEventListener("DOMContentLoaded", function() {
  document.getElementById("loginBtn").addEventListener("click", handleLogin);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  document.getElementById("buildBtn").addEventListener("click", startBuild);
  document.getElementById("resetBtn1").addEventListener("click", resetForm);
  document.getElementById("resetBtn2").addEventListener("click", resetForm);
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
  document.getElementById("refreshHistory").addEventListener("click", loadHistory);

  // Load saved theme
  if (localStorage.getItem("theme") === "light") {
    document.body.classList.add("light");
    document.getElementById("themeToggle").textContent = "☀️";
  }

  if (localStorage.getItem("github_token") && localStorage.getItem("github_user")) {
    showApp();
    loadHistory();
  }
});

// ===== THEME =====
function toggleTheme() {
  const isLight = document.body.classList.toggle("light");
  localStorage.setItem("theme", isLight ? "light" : "dark");
  document.getElementById("themeToggle").textContent = isLight ? "☀️" : "🌙";
}

// ===== BUILD HISTORY =====
async function loadHistory() {
  const list = document.getElementById("historyList");
  list.innerHTML = '<p class="history-empty">Loading builds...</p>';
  try {
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" } : { Accept: "application/vnd.github.v3+json" };
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`, { headers });
    if (!res.ok) throw new Error("Failed");
    const releases = await res.json();
    if (releases.length === 0) {
      list.innerHTML = '<p class="history-empty">No builds yet.</p>';
      return;
    }
    list.innerHTML = "";
    releases.forEach(r => {
      const apk = r.assets.find(a => a.name.endsWith(".apk"));
      if (!apk) return;
      const item = document.createElement("div");
      item.className = "history-item";
      item.innerHTML = `<div><h4>${r.name}</h4><p>${new Date(r.created_at).toLocaleDateString()}</p></div><a href="${apk.browser_download_url}" target="_blank">⬇ Download</a>`;
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = '<p class="history-empty">Login to see build history.</p>';
  }
}

// ===== LOGIN =====
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
  loadHistory();
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
  document.getElementById("greeting").textContent = "Hi, " + (localStorage.getItem("github_user") || "User");
}

function getToken() {
  return localStorage.getItem("github_token");
}

// ===== BUILD =====
async function startBuild() {
  const token = getToken();
  if (!token) { handleLogout(); showError("Session expired. Please login again."); return; }

  const url = document.getElementById("urlInput").value.trim();
  const name = document.getElementById("nameInput").value.trim();
  const version = document.getElementById("versionInput").value.trim() || "1.0.0";
  const pkg = document.getElementById("packageInput").value.trim() || "";
  const icon = document.getElementById("iconInput").value.trim() || "";
  const orientation = document.getElementById("orientationInput").value || "default";

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
  btn.innerHTML = '<span>⏳</span> Starting...';

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
        inputs: { url, app_name: name, build_id: buildId, app_version: version, package_name: pkg, icon_url: icon, orientation }
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
  document.getElementById("downloadAppName").textContent = appName + " v" + (document.getElementById("versionInput").value.trim() || "1.0.0");
  document.getElementById("downloadLink").href = url;
  enableBuildBtn();
  loadHistory();
}

function showError(message) {
  document.getElementById("progress").classList.add("hidden");
  document.getElementById("errorArea").classList.remove("hidden");
  document.getElementById("errorMessage").textContent = message;
  enableBuildBtn();
}

function enableBuildBtn() {
  const btn = document.getElementById("buildBtn");
  btn.disabled = false;
  btn.innerHTML = '<span>⚡</span> Build APK';
}

function resetForm() {
  document.getElementById("downloadArea").classList.add("hidden");
  document.getElementById("errorArea").classList.add("hidden");
  document.getElementById("progress").classList.add("hidden");
  enableBuildBtn();
}
