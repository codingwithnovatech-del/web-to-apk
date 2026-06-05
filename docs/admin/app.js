let currentUser = null;
let authUnsub = null;

auth.onAuthStateChanged(u => {
  currentUser = u;
  const nameEl = document.getElementById("userName");
  if (nameEl && u) nameEl.textContent = u.email || "Admin";
  if (!u && !window.location.pathname.endsWith("index.html") && !window.location.pathname.endsWith("admin/")) {
    window.location.href = "index.html";
  }
  if (u && window.location.pathname.endsWith("index.html")) {
    window.location.href = "dashboard.html";
  }
  initStore();
  const page = window.location.pathname.split("/").pop();
  if (page === "dashboard.html") loadDashboard();
  else if (page === "builds.html") loadBuilds();
  else if (page === "users.html") loadUsers();
  else if (page === "settings.html") loadSettings();
  else if (page === "payments.html") loadPayments();
  else if (page === "store.html") loadStore();
});

async function initStore() {
  const ref = db.collection("settings").doc("default");
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      daily_limit: 3, branding_enabled: true,
      upi_id: "@tsayush", upi_qr_url: "",
      free_price: 99, paid_price: 499,
      adsense_id: "", affiliate_link: "", namecheap_link: ""
    });
  }
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
  auth.signInWithEmailAndPassword(email, password)
    .catch(e => {
      errEl.textContent = e.message;
      errEl.classList.remove("hidden");
    });
}

function adminLogout() {
  auth.signOut();
  window.location.href = "index.html";
}

async function loadDashboard() {
  try {
    const buildsSnap = await db.collection("builds").get();
    const usersSnap = await db.collection("users").get();
    const today = new Date().toISOString().slice(0, 10);
    const builds = buildsSnap.docs.map(d => d.data());
    const todayBuilds = builds.filter(b => b.created_at?.startsWith(today));
    const successful = builds.filter(b => b.status === "completed");
    const failed = builds.filter(b => b.status === "failed");

    document.getElementById("statTotal").textContent = builds.length;
    document.getElementById("statSuccess").textContent = successful.length;
    document.getElementById("statToday").textContent = todayBuilds.length;
    document.getElementById("statUsers").textContent = usersSnap.size;

    await loadChart(7);

    const recent = builds.slice(-5).reverse();
    document.getElementById("recentBuilds").innerHTML = recent.length
      ? recent.map(b => `<div style="padding:8px 0;border-bottom:1px solid #1f1f30;display:flex;justify-content:space-between">
          <div><strong>${b.app_name || "—"}</strong><br><span style="font-size:0.75rem;color:#888">${b.url || b.device_id || ""}</span></div>
          <span class="status-badge ${b.status || "pending"}">${b.status || "pending"}</span>
        </div>`).join("")
      : '<p class="text-muted">No builds yet</p>';
  } catch (e) {
    console.error("Dashboard error:", e);
  }
}

let chartInstance = null;

async function loadChart(days) {
  try {
    const buildsSnap = await db.collection("builds").get();
    const builds = buildsSnap.docs.map(d => d.data());
    const chart = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayBuilds = builds.filter(b => b.created_at?.startsWith(dateStr));
      chart.push({ date: dateStr, success: dayBuilds.length, failed: 0 });
    }
    const ctx = document.getElementById("chartCanvas");
    if (!ctx) return;
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: chart.map(c => c.date.slice(5)),
        datasets: [{ label: "Builds", data: chart.map(c => c.success), backgroundColor: "#4cd964", borderRadius: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#888" } } },
        scales: {
          x: { ticks: { color: "#888" }, grid: { color: "#1f1f30" } },
          y: { ticks: { color: "#888" }, grid: { color: "#1f1f30" } }
        }
      }
    });
    document.querySelectorAll("#chartBtns .btn-sm").forEach(b => b.classList.remove("active"));
    const btns = document.querySelectorAll("#chartBtns .btn-sm");
    btns.forEach(b => { if (b.textContent.trim() == days + "D") b.classList.add("active"); });
  } catch (e) {
    console.error("Chart error:", e);
  }
}

async function loadBuilds() {
  try {
    const snap = await db.collection("builds").orderBy("created_at", "desc").limit(50).get();
    const builds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const tbody = document.getElementById("buildsTableBody");
    if (!tbody) return;
    if (!builds.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#888">No builds</td></tr>`;
      return;
    }
    tbody.innerHTML = builds.map(b => `
      <tr>
        <td><input type="checkbox" class="build-check" value="${b.id}"></td>
        <td>${b.id.slice(0, 12)}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${b.url || "—"}</td>
        <td>${b.app_name || "—"}</td>
        <td><span class="status-badge ${b.status || "pending"}">${b.status || "pending"}</span></td>
        <td>${b.created_at ? new Date(b.created_at).toLocaleDateString() : "—"}</td>
        <td><button class="btn-sm danger" onclick="deleteBuild('${b.id}')">&#128465;</button></td>
      </tr>
    `).join("");
  } catch (e) {
    console.error("Builds error:", e);
  }
}

function filterBuilds() { loadBuilds(); }
function toggleAll() {
  const checked = document.getElementById("selectAll").checked;
  document.querySelectorAll(".build-check").forEach(c => c.checked = checked);
}

async function batchDelete() {
  const ids = [...document.querySelectorAll(".build-check:checked")].map(c => c.value);
  if (!ids.length) return alert("Select builds first");
  if (!confirm(`Delete ${ids.length} builds?`)) return;
  const batch = db.batch();
  ids.forEach(id => batch.delete(db.collection("builds").doc(id)));
  await batch.commit();
  loadBuilds();
}

async function deleteBuild(id) {
  if (!confirm("Delete this build?")) return;
  await db.collection("builds").doc(id).delete();
  loadBuilds();
}

async function loadUsers() {
  try {
    const snap = await db.collection("users").orderBy("last_build_date", "desc").limit(100).get();
    const tbody = document.getElementById("usersTableBody");
    if (!tbody) return;
    tbody.innerHTML = snap.docs.map(d => {
      const u = d.data();
      return `<tr>
        <td style="font-family:monospace;font-size:0.8rem">${d.id.slice(0, 16)}</td>
        <td><span class="status-badge">${u.tier || "free"}</span></td>
        <td>${u.builds_today || 0}</td>
        <td>${u.last_build_date || "—"}</td>
        <td>${u.banned ? '<span style="color:#ff453a">Banned</span>' : '<span style="color:#4cd964">Active</span>'}</td>
        <td>
          <button class="btn-sm" onclick="toggleTier('${d.id}', '${u.tier === "paid" ? "free" : "paid"}')">${u.tier === "paid" ? "Downgrade" : "Upgrade"}</button>
          <button class="btn-sm danger" onclick="toggleBan('${d.id}', ${u.banned})">${u.banned ? "Unban" : "Ban"}</button>
        </td>
      </tr>`;
    }).join("");
  } catch (e) {
    console.error("Users error:", e);
  }
}

async function toggleTier(id, tier) {
  await db.collection("users").doc(id).update({ tier });
  loadUsers();
}

async function toggleBan(id, banned) {
  await db.collection("users").doc(id).update({ banned: !banned });
  loadUsers();
}

async function loadSettings() {
  const snap = await db.collection("settings").doc("default").get();
  if (snap.exists) {
    const data = snap.data();
    Object.keys(data).forEach(key => {
      const el = document.getElementById(`set_${key}`);
      if (el) el.value = data[key];
    });
  }
}

async function saveSettings() {
  const els = document.querySelectorAll("#settingsForm input, #settingsForm select");
  const settings = {};
  els.forEach(el => {
    const key = el.id.replace("set_", "");
    settings[key] = el.value;
  });
  await db.collection("settings").doc("default").set(settings, { merge: true });
  alert("Settings saved!");
}

async function loadPayments() {
  try {
    const snap = await db.collection("payments").orderBy("created_at", "desc").limit(50).get();
    const tbody = document.getElementById("paymentsTableBody");
    if (!tbody) return;
    tbody.innerHTML = snap.docs.map(d => {
      const p = d.data();
      return `<tr>
        <td>${d.id.slice(0, 10)}</td>
        <td style="font-family:monospace;font-size:0.8rem">${(p.device_id || "").slice(0, 12)}</td>
        <td>&#8377;${p.amount || 0}</td>
        <td>${p.upi_ref || "—"}</td>
        <td><span class="status-badge ${p.approved ? "completed" : "pending"}">${p.approved ? "Approved" : "Pending"}</span></td>
        <td>${p.created_at ? new Date(p.created_at).toLocaleDateString() : "—"}</td>
        <td>${p.approved ? "—" : `<button class="btn-sm" onclick="approvePayment('${d.id}', '${p.device_id}')">Approve</button>`}</td>
      </tr>`;
    }).join("");
  } catch (e) {
    console.error("Payments error:", e);
  }
}

async function approvePayment(paymentId, deviceId) {
  await db.collection("payments").doc(paymentId).update({ approved: true });
  if (deviceId) {
    await db.collection("users").doc(deviceId).set({ tier: "paid" }, { merge: true });
  }
  loadPayments();
}

async function loadStore() {
  try {
    const snap = await db.collection("store").orderBy("created_at", "desc").get();
    const tbody = document.getElementById("storeTableBody");
    if (!tbody) return;
    tbody.innerHTML = snap.docs.map(d => {
      const app = d.data();
      return `<tr>
        <td><strong>${app.name}</strong></td>
        <td style="font-family:monospace;font-size:0.8rem">${app.package || "—"}</td>
        <td>${app.category || "—"}</td>
        <td>${app.featured ? "&#11088;" : "—"}</td>
        <td>
          <button class="btn-sm" onclick="toggleFeatured('${d.id}', ${!app.featured})">${app.featured ? "Unfeature" : "Feature"}</button>
          <button class="btn-sm danger" onclick="deleteApp('${d.id}')">&#128465;</button>
        </td>
      </tr>`;
    }).join("");
  } catch (e) {
    console.error("Store error:", e);
  }
}

function showAddApp() {
  document.getElementById("addAppModal").classList.remove("hidden");
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

async function createApp() {
  const app = {
    name: document.getElementById("newAppName").value.trim(),
    package: document.getElementById("newAppPackage").value.trim(),
    category: document.getElementById("newAppCategory").value,
    icon: document.getElementById("newAppIcon").value.trim(),
    description: document.getElementById("newAppDesc").value.trim(),
    download_url: document.getElementById("newAppUrl").value.trim(),
    featured: false,
    created_at: new Date().toISOString()
  };
  if (!app.name) return alert("App name required");
  await db.collection("store").add(app);
  closeModal("addAppModal");
  loadStore();
}

async function toggleFeatured(id, featured) {
  await db.collection("store").doc(id).update({ featured });
  loadStore();
}

async function deleteApp(id) {
  if (!confirm("Delete this app?")) return;
  await db.collection("store").doc(id).delete();
  loadStore();
}
