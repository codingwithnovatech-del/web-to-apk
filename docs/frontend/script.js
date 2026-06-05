const GITHUB_REPO = "codingwithnovatech-del/web-to-apk";
const WORKFLOW_FILE = "apk-builder.yml";

let fbUser = null;
let cachedToken = "";

async function loadTokenFromFirestore() {
  if (typeof firebase === "undefined" || !firebase.firestore) return;
  try {
    const snap = await firebase.firestore().collection("settings").doc("default").get();
    if (snap.exists && snap.data().github_token) {
      cachedToken = snap.data().github_token;
    }
  } catch {}
}

function showAuthError(msg) {
  const el = document.getElementById("authError");
  if (el) { el.textContent = msg; el.classList.remove("hidden"); }
}

function clearAuthError() {
  const el = document.getElementById("authError");
  if (el) el.classList.add("hidden");
}

function switchAuthTab(tab) {
  clearAuthError();
  document.querySelectorAll(".auth-tab").forEach((t, i) => t.classList.toggle("active", (i === 0 && tab === "signin") || (i === 1 && tab === "signup")));
  document.getElementById("signInForm").classList.toggle("hidden", tab !== "signin");
  document.getElementById("signUpForm").classList.toggle("hidden", tab !== "signup");
}

async function signInWithEmail() {
  clearAuthError();
  const email = document.getElementById("signInEmail").value.trim();
  const password = document.getElementById("signInPassword").value;
  if (!email || !password) { showAuthError("Please fill in all fields"); return; }
  try { await firebase.auth().signInWithEmailAndPassword(email, password); }
  catch (e) { showAuthError(e.message); }
}

async function signUpWithEmail() {
  clearAuthError();
  const name = document.getElementById("signUpName").value.trim();
  const email = document.getElementById("signUpEmail").value.trim();
  const password = document.getElementById("signUpPassword").value;
  if (!name || !email || !password) { showAuthError("Please fill in all fields"); return; }
  if (password.length < 6) { showAuthError("Password must be at least 6 characters"); return; }
  try {
    const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
  } catch (e) { showAuthError(e.message); }
}

async function signInWithGoogle() {
  clearAuthError();
  try { await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
  catch (e) { showAuthError(e.message); }
}

async function signInWithGitHub() {
  clearAuthError();
  try { await firebase.auth().signInWithPopup(new firebase.auth.GithubAuthProvider()); }
  catch (e) { showAuthError(e.message); }
}

function handleLogout() {
  firebase.auth().signOut().catch(() => {});
  localStorage.removeItem("device_id");
}

function showApp(user) {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appScreen").classList.remove("hidden");
  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  document.getElementById("greeting").textContent = "👋 Hi, " + displayName;
}

function showLoginScreen() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("appScreen").classList.add("hidden");
  document.getElementById("downloadArea").classList.add("hidden");
  document.getElementById("errorArea").classList.add("hidden");
  document.getElementById("progress").classList.add("hidden");
}

function getToken() {
  return cachedToken;
}

function initAuth() {
  if (typeof firebase === "undefined" || !firebase.auth) return;
  firebase.auth().onAuthStateChanged(async (user) => {
    fbUser = user;
    if (user) {
      await loadTokenFromFirestore();
      showApp(user);
    } else {
      cachedToken = "";
      showLoginScreen();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("signInEmail").addEventListener("keydown", e => { if (e.key === "Enter") signInWithEmail(); });
  document.getElementById("signInPassword").addEventListener("keydown", e => { if (e.key === "Enter") signInWithEmail(); });
  document.getElementById("signUpPassword").addEventListener("keydown", e => { if (e.key === "Enter") signUpWithEmail(); });
  initAuth();
});

async function startBuild() {
  const token = getToken();
  if (!token) { showError("Setup required: Admin needs to add GitHub token in Settings."); return; }

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
  const deviceId = fbUser?.uid || localStorage.getItem("device_id") || "unknown";
  if (!localStorage.getItem("device_id")) localStorage.setItem("device_id", deviceId);

  setProgress("⏳", "Checking limits...", "Verifying daily build allowance...", 5);

  try {
    if (fbUser && typeof firebase !== "undefined") {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const userRef = firebase.firestore().collection("users").doc(fbUser.uid);
        const userSnap = await userRef.get();

        if (userSnap.exists) {
          const data = userSnap.data();
          if (data.banned) {
            btn.disabled = false; btn.innerHTML = '⚡ Build APK';
            showError("Account is banned.");
            return;
          }
          if (data.tier !== "paid" && data.last_build_date === today) {
            const settingsSnap = await firebase.firestore().collection("settings").doc("default").get();
            const limit = (settingsSnap.data()?.daily_limit) || 3;
            if (data.builds_today >= limit) {
              btn.disabled = false; btn.innerHTML = '⚡ Build APK';
              showError("Daily build limit reached. Contact admin to upgrade.");
              return;
            }
          }
        }
      } catch (fe) { console.warn("Firebase check failed, proceeding anyway:", fe); }
    }

    setProgress("⏳", "Triggering build...", "Contacting GitHub Actions...", 15);

    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { url, app_name: name, build_id: buildId, device_id: deviceId }
      })
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        showError("GitHub token expired. Contact admin to update it in Settings.");
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
