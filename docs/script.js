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
  document.getElementById("tabSignIn").classList.toggle("active", tab === "signin");
  document.getElementById("tabSignUp").classList.toggle("active", tab === "signup");
  document.getElementById("signInForm").classList.toggle("hidden", tab !== "signin");
  document.getElementById("signUpForm").classList.toggle("hidden", tab !== "signup");
  document.getElementById("authTitle").textContent = tab === "signin" ? "Sign In" : "Create Account";
  document.getElementById("authSubtitle").textContent = tab === "signin" ? "Welcome back! Sign in to continue." : "Create an account to start building APKs.";
  document.getElementById("toggleAuthText").innerHTML = tab === "signin"
    ? "Don't have an account? <a href=\"#\" onclick=\"switchAuthTab('signup');return false\">Sign Up</a>"
    : "Already have an account? <a href=\"#\" onclick=\"switchAuthTab('signin');return false\">Sign In</a>";
}

async function signInWithEmail() {
  try {
    clearAuthError();
    const email = document.getElementById("signInEmail").value.trim();
    const password = document.getElementById("signInPassword").value;
    if (!email || !password) { showAuthError("Please fill in all fields"); return; }
    document.getElementById("signInBtn").disabled = true;
    if (typeof firebase === "undefined" || !firebase.auth) { showAuthError("Firebase not loaded. Check internet."); document.getElementById("signInBtn").disabled = false; return; }
    await firebase.auth().signInWithEmailAndPassword(email, password);
  } catch (e) {
    showAuthError(e.message);
    document.getElementById("signInBtn").disabled = false;
  }
}

async function signUpWithEmail() {
  try {
    clearAuthError();
    const name = document.getElementById("signUpName").value.trim();
    const email = document.getElementById("signUpEmail").value.trim();
    const password = document.getElementById("signUpPassword").value;
    if (!name || !email || !password) { showAuthError("Please fill in all fields"); return; }
    if (password.length < 6) { showAuthError("Password must be at least 6 characters"); return; }
    document.getElementById("signUpBtn").disabled = true;
    if (typeof firebase === "undefined" || !firebase.auth) { showAuthError("Firebase not loaded. Check internet."); document.getElementById("signUpBtn").disabled = false; return; }
    const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
  } catch (e) {
    showAuthError(e.message);
    document.getElementById("signUpBtn").disabled = false;
  }
}

async function signInWithGoogle() {
  clearAuthError();
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebase.auth().signInWithPopup(provider);
  } catch (e) {
    showAuthError(e.message);
  }
}

async function signInWithGitHub() {
  clearAuthError();
  try {
    const provider = new firebase.auth.GithubAuthProvider();
    await firebase.auth().signInWithPopup(provider);
  } catch (e) {
    showAuthError(e.message);
  }
}

function handleLogout() {
  firebase.auth().signOut().catch(() => {});
  localStorage.removeItem("device_id");
}

function showApp(user) {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appScreen").classList.remove("hidden");
  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  document.getElementById("greeting").textContent = "Hi, " + displayName;
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
      loadHistory();
    } else {
      cachedToken = "";
      showLoginScreen();
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("buildBtn").addEventListener("click", startBuild);
  document.getElementById("resetBtn1").addEventListener("click", resetForm);
  document.getElementById("resetBtn2").addEventListener("click", resetForm);
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
  document.getElementById("refreshHistory").addEventListener("click", loadHistory);
  document.getElementById("nameInput").addEventListener("input", updateMockup);
  document.getElementById("payNowBtn")?.addEventListener("click", payNow);
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);

  document.querySelectorAll(".toggle-item").forEach(el => {
    el.addEventListener("click", () => el.classList.toggle("active"));
  });

  document.getElementById("signInEmail").addEventListener("keydown", e => { if (e.key === "Enter") signInWithEmail(); });
  document.getElementById("signInPassword").addEventListener("keydown", e => { if (e.key === "Enter") signInWithEmail(); });
  document.getElementById("signUpPassword").addEventListener("keydown", e => { if (e.key === "Enter") signUpWithEmail(); });

  if (localStorage.getItem("theme") === "light") {
    document.body.classList.add("light");
    document.getElementById("themeToggle").innerHTML = "&#9728;&#65039;";
  }

  loadPublicStats();
  initAuth();
  initParticles();
  initScrollEffect();
});

async function loadPublicStats() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`, {
      headers: { Accept: "application/vnd.github.v3+json" }
    });
    if (!res.ok) return;
    const releases = await res.json();
    const withApk = releases.filter(r => r.assets?.some(a => a.name.endsWith(".apk")));
    const totalDl = withApk.reduce((s, r) => s + r.assets.reduce((a, as) => a + (as.download_count || 0), 0), 0);
    document.getElementById("dashTotal").textContent = withApk.length;
    document.getElementById("dashDownloads").textContent = totalDl;
    document.getElementById("dashActive").textContent = withApk.length;
    document.getElementById("dashCredits").textContent = "∞";
  } catch {}
}

// ===== PARTICLES =====
function initParticles() {
  const canvas = document.getElementById("particles-canvas");
  const ctx = canvas.getContext("2d");
  let w, h, particles = [];

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  for (let i = 0; i < 80; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      r: Math.random() * 2 + 0.5
    });
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    particles.forEach((p, i) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(139,92,246,0.3)";
      ctx.fill();

      for (let j = i + 1; j < particles.length; j++) {
        const dx = p.x - particles[j].x;
        const dy = p.y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(139,92,246,${0.1 * (1 - dist / 150)})`;
          ctx.stroke();
        }
      }
    });
    requestAnimationFrame(draw);
  }
  draw();
}

// ===== SCROLL EFFECT =====
function initScrollEffect() {
  const navbar = document.getElementById("navbar");
  window.addEventListener("scroll", () => {
    navbar.classList.toggle("scrolled", window.scrollY > 50);
  });
}

// ===== THEME =====
function toggleTheme() {
  const isLight = document.body.classList.toggle("light");
  localStorage.setItem("theme", isLight ? "light" : "dark");
  document.getElementById("themeToggle").innerHTML = isLight ? "&#9728;&#65039;" : "&#127769;";
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
      list.innerHTML = '<p class="history-empty">No builds yet. Create your first APK!</p>';
      updateDashStats([]);
      updateRecentBuilds([]);
      return;
    }
    list.innerHTML = "";
    const withApk = releases.filter(r => r.assets.some(a => a.name.endsWith(".apk")));
    withApk.forEach(r => {
      const apk = r.assets.find(a => a.name.endsWith(".apk"));
      const item = document.createElement("div");
      item.className = "history-item";
      item.innerHTML = `<div><h4>${r.name}</h4><p>${new Date(r.created_at).toLocaleDateString()}</p></div><a href="${apk.browser_download_url}" target="_blank">&#11015; Download</a>`;
      list.appendChild(item);
    });
    updateDashStats(withApk);
    updateRecentBuilds(withApk);
  } catch (e) {
    list.innerHTML = '<p class="history-empty">Login to see build history.</p>';
    updateDashStats([]);
    updateRecentBuilds([]);
  }
}

function updateDashStats(releases) {
  document.getElementById("dashTotal").textContent = releases.length;
  const dl = releases.reduce((sum, r) => sum + (r.assets ? r.assets.reduce((s, a) => s + (a.download_count || 0), 0) : 0), 0);
  document.getElementById("dashDownloads").textContent = dl;
  document.getElementById("dashActive").textContent = releases.filter(r => r.assets.some(a => a.name.endsWith(".apk"))).length;
}

function updateRecentBuilds(releases) {
  const container = document.getElementById("recentBuilds");
  const recent = releases.slice(0, 5);
  if (recent.length === 0) {
    container.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--muted);font-size:0.9rem;">No builds yet.</div>';
    return;
  }
  container.innerHTML = "";
  recent.forEach(r => {
    const apk = r.assets.find(a => a.name.endsWith(".apk"));
    const row = document.createElement("div");
    row.className = "table-row";
    const status = apk ? "ready" : "pending";
    row.innerHTML = `
      <span style="font-weight:600;">${r.name}</span>
      <span><span class="status-badge ${status}">${status === "ready" ? "Ready" : "Building"}</span></span>
      <span style="color:var(--muted);font-size:0.78rem;">${new Date(r.created_at).toLocaleDateString()}</span>
      <span>${apk ? `<a href="${apk.browser_download_url}" target="_blank" class="table-dl">Download</a>` : "—"}</span>
    `;
    container.appendChild(row);
  });
}

function showPaywall(settings) {
  const modal = document.getElementById("paywallModal");
  const msg = document.getElementById("paywallMessage");
  const price = document.getElementById("paywallPrice");
  const qr = document.getElementById("paywallQr");
  const upi = document.getElementById("paywallUpi");
  const btn = document.getElementById("payNowBtn");
  if (!modal) return;
  const s = settings || {};
  const p = s.free_price || 99;
  msg.textContent = `You've used all free builds. Pay &#8377;${p} to unlock unlimited builds for a day.`;
  price.innerHTML = `&#8377;${p}`;
  if (s.upi_qr_url) qr.innerHTML = `<img src="${s.upi_qr_url}" style="width:160px;height:160px;border-radius:8px;object-fit:contain">`;
  else qr.innerHTML = "";
  upi.textContent = s.upi_id ? `UPI: ${s.upi_id}` : "";
  btn.textContent = `Pay &#8377;${p}`;
  modal.classList.remove("hidden");
}

function closePaywall() {
  const modal = document.getElementById("paywallModal");
  if (modal) modal.classList.add("hidden");
}

function payNow() {
  const settings = {};
  const upiEl = document.getElementById("paywallUpi");
  if (upiEl && upiEl.textContent) {
    const upiId = upiEl.textContent.replace("UPI: ", "");
    if (upiId) {
      const amt = document.getElementById("paywallPrice")?.textContent?.replace("₹", "") || "99";
      const url = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=WebToAPK&am=${amt}&cu=INR&tn=Build%20Upgrade`;
      window.open(url, "_blank");
      alert(`Pay &#8377;${amt} to ${upiId}. After payment, contact admin for approval.`);
    }
  }
  closePaywall();
}

// ===== MOCKUP =====
function updateMockup() {
  const name = document.getElementById("nameInput").value.trim() || "My App";
  document.getElementById("mockupAppName").textContent = name;
}

// ===== BUILD =====
async function startBuild() {
  const token = getToken();
  if (!token) { showError("Setup required: Admin needs to add GitHub token in Settings."); return; }

  const url = document.getElementById("urlInput").value.trim();
  const name = document.getElementById("nameInput").value.trim();
  const version = document.getElementById("versionInput").value.trim() || "1.0.0";
  const pkg = document.getElementById("packageInput").value.trim() || "";
  const icon = document.getElementById("iconInput").value.trim() || "";
  const orientation = document.getElementById("orientationInput").value || "default";
  const template = document.getElementById("templateInput").value || "default";
  const primaryColor = document.getElementById("colorInput").value.trim() || "#FF5C7A";

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
  btn.innerHTML = '<span>&#9203;</span> Starting...';

  const buildId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const deviceId = fbUser?.uid || localStorage.getItem("device_id") || "unknown";
  if (!localStorage.getItem("device_id")) localStorage.setItem("device_id", deviceId);

  animateProcessStep(1);
  setProgress("&#9203;", "Checking limits...", "Verifying daily build allowance...", 5);

  try {
    if (fbUser && typeof firebase !== "undefined") {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const userRef = firebase.firestore().collection("users").doc(fbUser.uid);
        const userSnap = await userRef.get();

        if (userSnap.exists) {
          const data = userSnap.data();
          if (data.banned) {
            btn.disabled = false; btn.innerHTML = "&#9989; Build APK";
            showError("Account is banned.");
            return;
          }
          if (data.tier !== "paid" && data.last_build_date === today) {
            const settingsSnap = await firebase.firestore().collection("settings").doc("default").get();
            const limit = (settingsSnap.data()?.daily_limit) || 3;
            if (data.builds_today >= limit) {
              btn.disabled = false; btn.innerHTML = "&#9989; Build APK";
              showPaywall(settingsSnap.data());
              return;
            }
          }
        }
      } catch (fe) { console.warn("Firebase check failed, proceeding anyway:", fe); }
    }

    setProgress("&#9203;", "Triggering build...", "Contacting GitHub Actions...", 15);

    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { url, app_name: name, build_id: buildId, app_version: version, package_name: pkg, icon_url: icon, orientation, template, primary_color: primaryColor, device_id: deviceId }
      })
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        showError("GitHub token expired. Contact admin to update it in Settings.");
      } else {
        const errBody = await res.text().catch(() => "");
        showError("Failed to trigger build (HTTP " + res.status + "): " + errBody.slice(0, 300));
      }
      return;
    }

    animateProcessStep(2);
    setProgress("&#128230;", "Build queued", "Waiting for build to start...", 15);
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
    const progressVal = Math.min(pollCount * 2, 90);

    if (pollCount < 5) animateProcessStep(2);
    else if (pollCount < 15) animateProcessStep(3);
    else if (pollCount < 30) animateProcessStep(4);
    else if (pollCount < 45) animateProcessStep(5);
    else animateProcessStep(6);

    setProgress("&#9203;", `Building${dots}`, "Compiling APK... This takes 2-3 minutes", progressVal);

    try {
      const res = await fetch(statusUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "completed") {
          clearInterval(interval);
          document.querySelectorAll(".process-step").forEach(s => s.classList.add("completed"));
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

function animateProcessStep(step) {
  document.querySelectorAll(".process-step").forEach((el, i) => {
    el.classList.toggle("active", i + 1 === step);
    if (i + 1 < step) el.classList.add("completed");
  });
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
  document.getElementById("builderCard").scrollIntoView({ behavior: "smooth" });
}

function showError(message) {
  document.getElementById("progress").classList.add("hidden");
  document.getElementById("errorArea").classList.remove("hidden");
  document.getElementById("errorMessage").textContent = message;
  enableBuildBtn();
  document.getElementById("builderCard").scrollIntoView({ behavior: "smooth" });
}

function enableBuildBtn() {
  const btn = document.getElementById("buildBtn");
  btn.disabled = false;
  btn.innerHTML = '<span>&#9889;</span> Build APK';
}

function resetForm() {
  document.getElementById("downloadArea").classList.add("hidden");
  document.getElementById("errorArea").classList.add("hidden");
  document.getElementById("progress").classList.add("hidden");
  document.querySelectorAll(".process-step").forEach(s => s.classList.remove("active", "completed"));
  document.querySelector(".process-step").classList.add("active");
  enableBuildBtn();
}
