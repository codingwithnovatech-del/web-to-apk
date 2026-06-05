let currentUser = null;
let useFirebase = true;
let fbReady = false;

const DEMO_ADMIN = { email: "admin@webtoapk.app", password: "admin123" };

try {
  auth.onAuthStateChanged(u => {
    currentUser = u;
    fbReady = true;
    onAuth();
  });
  setTimeout(() => { if (!fbReady) { useFirebase = false; onAuth(); } }, 3000);
} catch (e) { useFirebase = false; setTimeout(onAuth, 100); }

function onAuth() {
  initStore();
  const nameEl = document.getElementById("userName");
  if (nameEl) nameEl.textContent = currentUser?.email || localStorage.getItem("admin_user") || "Admin";
  if (!currentUser && !useFirebase && window.location.pathname.endsWith("index.html")) {
    return;
  }
  if (!currentUser && !window.location.pathname.endsWith("index.html") && !window.location.pathname.endsWith("admin/")) {
    const localUser = localStorage.getItem("admin_token");
    if (!localUser) { window.location.href = "index.html"; return; }
  }
  if (currentUser && window.location.pathname.endsWith("index.html")) {
    window.location.href = "dashboard.html";
  }
  const page = window.location.pathname.split("/").pop();
  if (page === "dashboard.html") loadDashboard();
  else if (page === "builds.html") loadBuilds();
  else if (page === "users.html") loadUsers();
  else if (page === "settings.html") loadSettings();
  else if (page === "payments.html") loadPayments();
  else if (page === "store.html") loadStore();
}

async function initStore() {
  if (!localStorage.getItem("admin_settings")) {
    localStorage.setItem("admin_settings", JSON.stringify({
      daily_limit: 3, branding_enabled: true, github_token: "",
      upi_id: "@tsayush", upi_qr_url: "",
      free_price: 99, paid_price: 499, adsense_id: "", affiliate_link: "", namecheap_link: ""
    }));
  }
  if (!localStorage.getItem("admin_users")) localStorage.setItem("admin_users", "[]");
  if (!localStorage.getItem("admin_payments")) localStorage.setItem("admin_payments", "[]");
  if (!localStorage.getItem("admin_store")) localStorage.setItem("admin_store", "[]");

  if (useFirebase) {
    try {
      const ref = db.collection("settings").doc("default");
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set(JSON.parse(localStorage.getItem("admin_settings")));
      } else {
        localStorage.setItem("admin_settings", JSON.stringify(snap.data()));
      }
    } catch {}
  }
}

const GITHUB_REPO = "codingwithnovatech-del/web-to-apk";
let cachedReleases = null;

async function fetchGitHubReleases(force) {
  if (cachedReleases && !force) return cachedReleases;
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=50`, {
      headers: { Accept: "application/vnd.github.v3+json" }
    });
    if (res.ok) {
      cachedReleases = await res.json();
      return cachedReleases;
    }
  } catch {}
  return [];
}

function adminLogin() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const errEl = document.getElementById("loginError");
  if (!email || !password) {
    errEl.textContent = "Enter email and password";
    errEl.classList.remove("hidden");
    return;
  }
  if (useFirebase && typeof auth !== "undefined") {
    auth.signInWithEmailAndPassword(email, password).catch(e => {
      if (email === DEMO_ADMIN.email && password === DEMO_ADMIN.password) {
        localStorage.setItem("admin_token", "local_demo");
        localStorage.setItem("admin_user", email);
        window.location.href = "dashboard.html";
      } else {
        errEl.textContent = e.message;
        errEl.classList.remove("hidden");
      }
    });
  } else {
    if (email === DEMO_ADMIN.email && password === DEMO_ADMIN.password) {
      localStorage.setItem("admin_token", "local_demo");
      localStorage.setItem("admin_user", email);
      window.location.href = "dashboard.html";
    } else {
      errEl.textContent = "Invalid credentials. Try admin@webtoapk.app / admin123";
      errEl.classList.remove("hidden");
    }
  }
}

function adminLogout() {
  if (useFirebase && currentUser) { try { auth.signOut(); } catch {} }
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin_user");
  currentUser = null;
  window.location.href = "index.html";
}

function getStore(key) {
  try { return JSON.parse(localStorage.getItem(key)) || (key.includes("settings") ? {} : []); }
  catch { return key.includes("settings") ? {} : []; }
}
function setStore(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

async function getSettings() {
  let s = getStore("admin_settings") || {};
  if (useFirebase) {
    try { const snap = await db.collection("settings").doc("default").get();
      if (snap.exists) { s = snap.data(); setStore("admin_settings", s); } } catch {}
  }
  return s;
}

async function loadDashboard() {
  try {
    const releases = await fetchGitHubReleases();
    const apkBuilds = releases.filter(r => r.assets?.some(a => a.name.endsWith(".apk")));
    const today = new Date().toISOString().slice(0, 10);
    const todayBuilds = apkBuilds.filter(r => r.created_at?.startsWith(today));
    let fbUsers = [];
    if (useFirebase) { try { const snap = await db.collection("users").get(); fbUsers = snap.docs.map(d => d.data()); } catch {} }
    document.getElementById("statTotal").textContent = apkBuilds.length;
    document.getElementById("statSuccess").textContent = apkBuilds.length;
    document.getElementById("statToday").textContent = todayBuilds.length;
    document.getElementById("statUsers").textContent = fbUsers.length;
    await loadChart(7, apkBuilds);
    const recent = apkBuilds.slice(0, 5);
    document.getElementById("recentBuilds").innerHTML = recent.length
      ? recent.map(r => {
          const apk = r.assets?.find(a => a.name.endsWith(".apk"));
          return `<div style="padding:8px 0;border-bottom:1px solid #1f1f30;display:flex;justify-content:space-between">
            <div><strong>${r.name}</strong><br><span style="font-size:0.75rem;color:#888">${r.html_url || ""}</span></div>
            <span class="status-badge completed">completed</span>
          </div>`;
        }).join("")
      : '<p class="text-muted">No builds yet</p>';
  } catch (e) {
    document.querySelector(".stats-grid").innerHTML = `<div class="card"><p style="color:#ff453a">Error loading dashboard</p></div>`;
  }
}

let chartInstance = null;

async function loadChart(days, releases) {
  try {
    if (!releases) releases = await fetchGitHubReleases();
    const chart = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      chart.push({ date: dateStr.slice(5), success: releases.filter(r => r.created_at?.startsWith(dateStr)).length });
    }
    const ctx = document.getElementById("chartCanvas");
    if (!ctx) return;
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type: "bar",
      data: { labels: chart.map(c => c.date), datasets: [{ label: "Builds", data: chart.map(c => c.success), backgroundColor: "#4cd964", borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#888" } } },
        scales: { x: { ticks: { color: "#888" }, grid: { color: "#1f1f30" } }, y: { ticks: { color: "#888" }, grid: { color: "#1f1f30" } } }
      }
    });
    document.querySelectorAll("#chartBtns .btn-sm").forEach(b => b.classList.remove("active"));
    const btns = document.querySelectorAll("#chartBtns .btn-sm");
    btns.forEach(b => { if (b.textContent.trim() == days + "D") b.classList.add("active"); });
  } catch (e) {}
}

async function loadBuilds() {
  const releases = await fetchGitHubReleases(true);
  const apkBuilds = releases.filter(r => r.assets?.some(a => a.name.endsWith(".apk")));
  let fbBuilds = [];
  if (useFirebase && firebase.apps.length) {
    try { const snap = await db.collection("builds").orderBy("created_at", "desc").limit(50).get();
      fbBuilds = snap.docs.map(d => ({ id: d.id, ...d.data() })); } catch {}
  }
  const allBuilds = apkBuilds.map(r => ({
    id: r.tag_name || r.id, url: r.body || r.html_url || "—",
    app_name: r.name || "—", status: "completed",
    created_at: r.created_at, download_url: r.assets?.find(a => a.name.endsWith(".apk"))?.browser_download_url
  }));
  const tbody = document.getElementById("buildsTableBody");
  if (!tbody) return;
  if (!allBuilds.length) { tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#888">No builds</td></tr>`; return; }
  tbody.innerHTML = allBuilds.map(b => `<tr>
    <td><input type="checkbox" class="build-check" value="${b.id}"></td>
    <td>${(b.id || "").slice(0, 12)}</td>
    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${b.url}</td>
    <td>${b.app_name}</td>
    <td><span class="status-badge completed">completed</span></td>
    <td>${b.created_at ? new Date(b.created_at).toLocaleDateString() : "—"}</td>
    <td>${b.download_url ? `<a href="${b.download_url}" target="_blank" class="btn-sm">Download</a>` : "—"}</td>
  </tr>`).join("");
}

function filterBuilds() { loadBuilds(); }
function toggleAll() { const c = document.getElementById("selectAll").checked; document.querySelectorAll(".build-check").forEach(x => x.checked = c); }

function deleteLocalBuild(id) {
  if (!confirm("Delete?")) return;
  let builds = getStore("admin_builds");
  builds = builds.filter(b => b.id !== id);
  setStore("admin_builds", builds);
  loadBuilds();
}

async function loadUsers() {
  let users = [];
  if (useFirebase && firebase.apps.length) {
    try { const snap = await db.collection("users").limit(100).get();
      users = snap.docs.map(d => ({ id: d.id, ...d.data() })); } catch {}
  }
  const tbody = document.getElementById("usersTableBody");
  if (!tbody) return;
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:#888">No users yet. Users appear after someone builds an APK.</td></tr>`;
    return;
  }
  tbody.innerHTML = users.map(u => `<tr>
    <td style="font-family:monospace;font-size:0.8rem">${(u.id || "").slice(0, 16)}</td>
    <td><span class="status-badge">${u.tier || "free"}</span></td>
    <td>${u.builds_today || 0}</td>
    <td>${u.last_build_date || "—"}</td>
    <td>${u.banned ? '<span style="color:#ff453a">Banned</span>' : '<span style="color:#4cd964">Active</span>'}</td>
    <td><button class="btn-sm" onclick="toggleLocalTier('${u.id}')">Toggle Tier</button></td>
  </tr>`).join("");
}

function toggleLocalTier(id) {
  let users = getStore("admin_users");
  const idx = users.findIndex(u => u.id === id);
  if (idx >= 0) { users[idx].tier = users[idx].tier === "paid" ? "free" : "paid"; setStore("admin_users", users); }
  loadUsers();
}

async function loadSettings() {
  const settings = await getSettings();
  Object.keys(settings).forEach(key => {
    const el = document.getElementById(`set_${key}`);
    if (el) el.value = settings[key];
  });
}

async function saveSettings() {
  const els = document.querySelectorAll("#settingsForm input, #settingsForm select");
  const settings = {};
  els.forEach(el => { settings[el.id.replace("set_", "")] = el.value; });
  setStore("admin_settings", settings);
  if (useFirebase) {
    try { await db.collection("settings").doc("default").set(settings, { merge: true }); } catch {}
  }
  alert("Settings saved!");
}

async function loadPayments() {
  let payments = getStore("admin_payments");
  if (useFirebase) {
    try { const snap = await db.collection("payments").orderBy("created_at", "desc").limit(50).get();
      payments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStore("admin_payments", payments); } catch {}
  }
  const tbody = document.getElementById("paymentsTableBody");
  if (!tbody) return;
  tbody.innerHTML = payments.map(p => `<tr>
    <td>${(p.id || "").slice(0, 10)}</td>
    <td style="font-family:monospace;font-size:0.8rem">${(p.device_id || "").slice(0, 12)}</td>
    <td>&#8377;${p.amount || 0}</td>
    <td>${p.upi_ref || "—"}</td>
    <td><span class="status-badge ${p.approved ? "completed" : "pending"}">${p.approved ? "Approved" : "Pending"}</span></td>
    <td>${p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"}</td>
    <td>${p.approved ? "—" : `<button class="btn-sm" onclick="approveLocalPayment('${p.id}')">Approve</button>`}</td>
  </tr>`).join("");
}

function approveLocalPayment(id) {
  let payments = getStore("admin_payments");
  const p = payments.find(x => x.id === id);
  if (p) { p.approved = true; setStore("admin_payments", payments); }
  let users = getStore("admin_users");
  const u = users.find(x => x.id === p?.device_id);
  if (u) { u.tier = "paid"; setStore("admin_users", users); }
  loadPayments();
}

async function loadStore() {
  let apps = getStore("admin_store");
  if (useFirebase) {
    try { const snap = await db.collection("store").orderBy("created_at", "desc").get();
      apps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStore("admin_store", apps); } catch {}
  }
  const tbody = document.getElementById("storeTableBody");
  if (!tbody) return;
  tbody.innerHTML = apps.map(a => `<tr>
    <td><strong>${a.name || "—"}</strong></td>
    <td style="font-family:monospace;font-size:0.8rem">${a.package || "—"}</td>
    <td>${a.category || "—"}</td>
    <td>${a.featured ? "&#11088;" : "—"}</td>
    <td><button class="btn-sm danger" onclick="deleteLocalApp('${a.id}')">&#128465;</button></td>
  </tr>`).join("");
}

function showAddApp() { document.getElementById("addAppModal").classList.remove("hidden"); }
function closeModal(id) { document.getElementById(id).classList.add("hidden"); }

function createApp() {
  const app = {
    id: "app_" + Date.now(),
    name: document.getElementById("newAppName").value.trim(),
    package: document.getElementById("newAppPackage").value.trim(),
    category: document.getElementById("newAppCategory").value,
    icon: document.getElementById("newAppIcon").value.trim(),
    description: document.getElementById("newAppDesc").value.trim(),
    download_url: document.getElementById("newAppUrl").value.trim(),
    featured: false, created_at: new Date().toISOString()
  };
  if (!app.name) return alert("Name required");
  let apps = getStore("admin_store");
  apps.push(app);
  setStore("admin_store", apps);
  closeModal("addAppModal");
  loadStore();
}

function deleteLocalApp(id) {
  if (!confirm("Delete?")) return;
  let apps = getStore("admin_store");
  apps = apps.filter(a => a.id !== id);
  setStore("admin_store", apps);
  loadStore();
}
