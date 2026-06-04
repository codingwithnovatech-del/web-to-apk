const API_URL = "https://your-app.onrender.com";

// ─── Auth ─────────────────────────────────────────────────────────────────

function getToken() {
  return localStorage.getItem("admin_token");
}

function getUser() {
  try { return JSON.parse(localStorage.getItem("admin_user")); }
  catch { return null; }
}

async function apiCall(method, path, body) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getToken()}`
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_URL}${path}`, opts);
  const data = await res.json();

  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    window.location.href = "index.html";
    return null;
  }

  if (!res.ok) {
    throw new Error(data.detail || `HTTP ${res.status}`);
  }

  return data;
}

async function adminLogin() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const errEl = document.getElementById("loginError");

  if (!username || !password) {
    errEl.textContent = "Please fill all fields";
    errEl.classList.remove("hidden");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.detail || "Login failed";
      errEl.classList.remove("hidden");
      return;
    }

    localStorage.setItem("admin_token", data.token);
    localStorage.setItem("admin_user", JSON.stringify(data.user));
    window.location.href = "dashboard.html";
  } catch (e) {
    errEl.textContent = "Cannot connect to server";
    errEl.classList.remove("hidden");
  }
}

function adminLogout() {
  localStorage.removeItem("admin_token");
  localStorage.removeItem("admin_user");
  window.location.href = "index.html";
}

// Check auth on page load
(function checkAuth() {
  const token = getToken();
  if (!token && !window.location.pathname.endsWith("index.html")) {
    window.location.href = "index.html";
  }
  const user = getUser();
  if (user && document.getElementById("userName")) {
    document.getElementById("userName").textContent = user.username || "Admin";
  }
})();

// ─── Dashboard ────────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const stats = await apiCall("GET", "/api/admin/dashboard/stats");
    document.getElementById("statTotal").textContent = stats.total_builds;
    document.getElementById("statSuccess").textContent = stats.successful;
    document.getElementById("statFailed").textContent = stats.failed;
    document.getElementById("statToday").textContent = stats.today;
    document.getElementById("statQueued").textContent = stats.queued + stats.in_progress;
    document.getElementById("statAvgTime").textContent = stats.avg_build_time ? stats.avg_build_time + "s" : "-";
    document.getElementById("lastUpdate").textContent = `Last updated: ${new Date().toLocaleTimeString()}`;

    await loadChart(7);

    const urls = await apiCall("GET", "/api/admin/dashboard/top-urls");
    document.getElementById("topUrls").innerHTML = urls.length
      ? urls.map((u, i) => `<div style="padding:6px 0;border-bottom:1px solid #1f1f30;display:flex;justify-content:space-between"><span>${i+1}. ${u.url}</span><span style="color:#888">${u.count}</span></div>`).join("")
      : '<p class="text-muted">No data yet</p>';

    const recent = await apiCall("GET", "/api/admin/dashboard/recent?limit=5");
    document.getElementById("recentBuilds").innerHTML = recent.length
      ? recent.map(r => `<div style="padding:8px 0;border-bottom:1px solid #1f1f30;display:flex;justify-content:space-between;align-items:center">
          <div><strong>${r.app_name}</strong><br><span style="font-size:0.75rem;color:#888">${r.url}</span></div>
          <span class="status-badge ${r.status}">${r.status}</span>
        </div>`).join("")
      : '<p class="text-muted">No builds yet</p>';
  } catch (e) {
    document.querySelector(".stats-grid").innerHTML = `<div class="card"><p style="color:#ff453a">Error loading dashboard: ${e.message}</p></div>`;
  }
}

let chartInstance = null;

async function loadChart(days) {
  try {
    const data = await apiCall("GET", `/api/admin/dashboard/chart?days=${days}`);
    const ctx = document.getElementById("chartCanvas");
    if (!ctx) return;

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.map(d => d.date),
        datasets: [
          { label: "Successful", data: data.map(d => d.success), backgroundColor: "#4cd964", borderRadius: 4 },
          { label: "Failed", data: data.map(d => d.failed), backgroundColor: "#ff453a", borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#888" } } },
        scales: {
          x: { ticks: { color: "#888" }, grid: { color: "#1f1f30" } },
          y: { ticks: { color: "#888" }, grid: { color: "#1f1f30" } }
        }
      }
    });

    // Update active button
    document.querySelectorAll(".btn-group .btn-sm").forEach(b => b.classList.remove("active"));
    const btns = document.querySelectorAll(".btn-group .btn-sm");
    btns.forEach(b => { if (b.textContent.trim() == days + "D" || (days == 7 && b.textContent.trim() == "7D")) b.classList.add("active"); });
  } catch (e) {
    console.error("Chart error:", e);
  }
}

// ─── Builds ───────────────────────────────────────────────────────────────

let currentBuildPage = 1;

async function loadBuilds(page) {
  currentBuildPage = page || currentBuildPage;
  const search = document.getElementById("searchInput")?.value || "";
  const status = document.getElementById("statusFilter")?.value || "";
  const sortVal = document.getElementById("sortSelect")?.value || "created_at";
  const [sort, order] = sortVal.includes("|") ? sortVal.split("|") : [sortVal, "desc"];

  try {
    const data = await apiCall("GET", `/api/admin/builds?page=${currentBuildPage}&limit=20&status=${status}&search=${encodeURIComponent(search)}&sort=${sort}&order=${order}`);
    const tbody = document.getElementById("buildsTableBody");
    if (!tbody) return;

    if (!data.builds.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#888">No builds found</td></tr>`;
      document.getElementById("pagination").innerHTML = "";
      return;
    }

    tbody.innerHTML = data.builds.map(b => `
      <tr>
        <td><input type="checkbox" class="build-check" value="${b.id}"></td>
        <td><a href="build-detail.html?id=${b.id}" style="color:#e94560;text-decoration:none">${b.id}</a></td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.url}</td>
        <td>${b.app_name}</td>
        <td><span class="status-badge ${b.status}">${b.status}</span></td>
        <td>${b.created_at ? new Date(b.created_at).toLocaleDateString() : "-"}</td>
        <td>${b.build_duration ? b.build_duration + "s" : "-"}</td>
        <td>
          <a href="build-detail.html?id=${b.id}" class="btn-sm">View</a>
          <button class="btn-sm danger" onclick="deleteSingleBuild('${b.id}')">🗑</button>
        </td>
      </tr>
    `).join("");

    // Pagination
    const pages = data.pages;
    let pagHtml = "";
    for (let i = 1; i <= pages; i++) {
      pagHtml += `<button class="${i == currentBuildPage ? 'active' : ''}" onclick="loadBuilds(${i})">${i}</button>`;
    }
    document.getElementById("pagination").innerHTML = pagHtml;
  } catch (e) {
    console.error("Builds error:", e);
  }
}

function filterBuilds() { loadBuilds(1); }

function toggleAll() {
  const checked = document.getElementById("selectAll").checked;
  document.querySelectorAll(".build-check").forEach(c => c.checked = checked);
}

function exportBuilds() {
  window.open(`${API_URL}/api/admin/builds/export?format=csv&token=${getToken()}`, "_blank");
}

async function batchDelete() {
  const ids = [...document.querySelectorAll(".build-check:checked")].map(c => c.value);
  if (!ids.length) return alert("Select builds to delete");
  if (!confirm(`Delete ${ids.length} builds?`)) return;
  try {
    await apiCall("POST", "/api/admin/builds/batch-delete", { ids });
    loadBuilds();
  } catch (e) { alert(e.message); }
}

async function deleteSingleBuild(id) {
  if (!confirm("Delete this build?")) return;
  try {
    await apiCall("DELETE", `/api/admin/builds/${id}`);
    loadBuilds(currentBuildPage);
  } catch (e) { alert(e.message); }
}

// ─── Build Detail ─────────────────────────────────────────────────────────

let currentBuildId = null;

async function loadBuildDetail() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) { document.getElementById("buildDetail").innerHTML = '<p style="color:#ff453a">No build ID provided</p>'; return; }
  currentBuildId = id;

  try {
    const build = await apiCall("GET", `/api/admin/builds/${id}`);
    document.getElementById("buildDetail").innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><strong>Build ID</strong><br>${build.id}</div>
        <div><strong>Status</strong><br><span class="status-badge ${build.status}">${build.status}</span></div>
        <div><strong>URL</strong><br>${build.url}</div>
        <div><strong>App Name</strong><br>${build.app_name}</div>
        <div><strong>Created</strong><br>${build.created_at || "-"}</div>
        <div><strong>Completed</strong><br>${build.completed_at || "-"}</div>
        <div><strong>Duration</strong><br>${build.build_duration ? build.build_duration + "s" : "-"}</div>
        <div><strong>User IP</strong><br>${build.user_ip || "-"}</div>
        <div><strong>File Size</strong><br>${build.file_size ? (build.file_size / 1024).toFixed(1) + " KB" : "-"}</div>
      </div>
    `;

    const logs = await apiCall("GET", `/api/admin/builds/${id}/logs`);
    document.getElementById("buildLogs").textContent = logs.error_log || "No errors";
  } catch (e) {
    document.getElementById("buildDetail").innerHTML = `<p style="color:#ff453a">Error: ${e.message}</p>`;
  }
}

async function rebuildBuild() {
  if (!currentBuildId || !confirm("Rebuild this APK?")) return;
  try {
    const data = await apiCall("POST", `/api/admin/builds/${currentBuildId}/rebuild`);
    alert(`Rebuild started! New build ID: ${data.build_id}`);
    window.location.href = `build-detail.html?id=${data.build_id}`;
  } catch (e) { alert(e.message); }
}

async function deleteBuild() {
  if (!currentBuildId || !confirm("Delete this build?")) return;
  try {
    await apiCall("DELETE", `/api/admin/builds/${currentBuildId}`);
    window.location.href = "builds.html";
  } catch (e) { alert(e.message); }
}

// ─── Users ─────────────────────────────────────────────────────────────────

async function loadUsers() {
  try {
    const data = await apiCall("GET", "/api/admin/users");
    const tbody = document.getElementById("usersTableBody");
    if (!tbody) return;

    tbody.innerHTML = (data.users || []).map(u => `
      <tr>
        <td>${u.id}</td>
        <td>${u.username}</td>
        <td>${u.email || "-"}</td>
        <td><span class="status-badge">${u.role}</span></td>
        <td>${u.is_active ? "✅" : "❌"}</td>
        <td>${u.rate_limit}/day</td>
        <td>${u.last_login ? new Date(u.last_login).toLocaleString() : "-"}</td>
        <td>
          <button class="btn-sm" onclick="toggleUserActive(${u.id}, ${u.is_active})">${u.is_active ? "Deactivate" : "Activate"}</button>
          <button class="btn-sm danger" onclick="deleteUser(${u.id})">🗑</button>
        </td>
      </tr>
    `).join("");
  } catch (e) {
    console.error("Users error:", e);
  }
}

async function toggleUserActive(id, current) {
  try {
    await apiCall("PUT", `/api/admin/users/${id}`, { is_active: current ? 0 : 1 });
    loadUsers();
  } catch (e) { alert(e.message); }
}

async function deleteUser(id) {
  if (!confirm("Delete this user?")) return;
  try {
    await apiCall("DELETE", `/api/admin/users/${id}`);
    loadUsers();
  } catch (e) { alert(e.message); }
}

function showAddUserModal() {
  document.getElementById("addUserModal").classList.remove("hidden");
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

async function createUser() {
  const username = document.getElementById("newUsername").value.trim();
  const email = document.getElementById("newEmail").value.trim();
  const password = document.getElementById("newPassword").value;
  const role = document.getElementById("newRole").value;
  const rateLimit = parseInt(document.getElementById("newRateLimit").value) || 10;

  if (!username || !password) return alert("Username and password required");

  try {
    await apiCall("POST", "/api/admin/users", { username, email, password, role, rate_limit: rateLimit });
    closeModal("addUserModal");
    loadUsers();
  } catch (e) { alert(e.message); }
}

// ─── API Keys ──────────────────────────────────────────────────────────────

async function loadApiKeys() {
  try {
    const data = await apiCall("GET", "/api/admin/api-keys");
    const tbody = document.getElementById("keysTableBody");
    if (!tbody) return;

    tbody.innerHTML = (data.keys || []).map(k => `
      <tr>
        <td>${k.id}</td>
        <td>${k.name || "-"}</td>
        <td style="font-family:monospace;font-size:0.8rem">${k.key.substring(0, 20)}...</td>
        <td>${k.permissions}</td>
        <td>${k.is_active ? "✅" : "❌"}</td>
        <td>${k.usage_count || 0}</td>
        <td>${k.username || "-"}</td>
        <td>
          <button class="btn-sm" onclick="toggleKeyActive(${k.id}, ${k.is_active})">${k.is_active ? "Disable" : "Enable"}</button>
          <button class="btn-sm danger" onclick="deleteKey(${k.id})">🗑</button>
        </td>
      </tr>
    `).join("");
  } catch (e) {
    console.error("API keys error:", e);
  }
}

function showAddKeyModal() {
  document.getElementById("addKeyModal").classList.remove("hidden");
}

async function createApiKey() {
  const name = document.getElementById("keyName").value.trim();
  const permissions = document.getElementById("keyPermissions").value;
  try {
    const data = await apiCall("POST", "/api/admin/api-keys", { name, permissions });
    closeModal("addKeyModal");
    document.getElementById("keyResult").textContent = data.key;
    document.getElementById("keyResultModal").classList.remove("hidden");
    loadApiKeys();
  } catch (e) { alert(e.message); }
}

function copyKey() {
  const key = document.getElementById("keyResult").textContent;
  navigator.clipboard.writeText(key).then(() => alert("Copied!"));
}

async function toggleKeyActive(id, current) {
  try {
    await apiCall("PUT", `/api/admin/api-keys/${id}`, { is_active: current ? 0 : 1 });
    loadApiKeys();
  } catch (e) { alert(e.message); }
}

async function deleteKey(id) {
  if (!confirm("Delete this API key?")) return;
  try {
    await apiCall("DELETE", `/api/admin/api-keys/${id}`);
    loadApiKeys();
  } catch (e) { alert(e.message); }
}

// ─── Settings ──────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const data = await apiCall("GET", "/api/admin/settings");
    Object.keys(data).forEach(key => {
      const el = document.getElementById(`set_${key}`);
      if (el) el.value = data[key];
    });
  } catch (e) {
    console.error("Settings error:", e);
  }
}

async function saveSettings() {
  const els = document.querySelectorAll("#settingsForm input, #settingsForm select");
  const settings = {};
  els.forEach(el => {
    const key = el.id.replace("set_", "");
    settings[key] = el.value;
  });
  try {
    await apiCall("PUT", "/api/admin/settings", { settings });
    alert("Settings saved!");
  } catch (e) { alert(e.message); }
}

async function changePassword() {
  const newPass = document.getElementById("newPasswordInput").value;
  if (newPass.length < 6) return alert("Password must be at least 6 characters");
  try {
    await apiCall("PUT", "/api/admin/me/password", { new_password: newPass });
    alert("Password changed!");
    document.getElementById("newPasswordInput").value = "";
  } catch (e) { alert(e.message); }
}

// ─── Analytics ─────────────────────────────────────────────────────────────

let statusChartInstance = null;
let errorsChartInstance = null;

async function loadAnalytics(days) {
  try {
    const data = await apiCall("GET", `/api/admin/analytics/overview?range=${days}d`);

    // Status pie chart
    const ctx1 = document.getElementById("statusChart");
    if (ctx1) {
      if (statusChartInstance) statusChartInstance.destroy();
      statusChartInstance = new Chart(ctx1, {
        type: "pie",
        data: {
          labels: (data.status_breakdown || []).map(s => s.status),
          datasets: [{
            data: (data.status_breakdown || []).map(s => s.count),
            backgroundColor: ["#007aff", "#4cd964", "#ff453a", "#ffd60a", "#888"]
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: "bottom", labels: { color: "#888" } } }
        }
      });
    }

    // Errors bar chart
    const errorsData = await apiCall("GET", "/api/admin/analytics/errors");
    const ctx2 = document.getElementById("errorsChart");
    if (ctx2) {
      if (errorsChartInstance) errorsChartInstance.destroy();
      errorsChartInstance = new Chart(ctx2, {
        type: "line",
        data: {
          labels: (errorsData || []).map(e => e.date).reverse(),
          datasets: [{
            label: "Errors",
            data: (errorsData || []).map(e => e.count).reverse(),
            borderColor: "#ff453a",
            backgroundColor: "rgba(255,69,58,0.1)",
            fill: true,
            tension: 0.3
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: "#888" } } },
          scales: {
            x: { ticks: { color: "#888" }, grid: { color: "#1f1f30" } },
            y: { ticks: { color: "#888" }, grid: { color: "#1f1f30" } }
          }
        }
      });
    }

    // Common errors
    const errDiv = document.getElementById("commonErrors");
    if (errDiv) {
      errDiv.innerHTML = (data.common_errors || []).length
        ? data.common_errors.map(e => `<div style="padding:6px 0;border-bottom:1px solid #1f1f30">${e.error} — <strong>${e.count}</strong></div>`).join("")
        : '<p class="text-muted">No errors found</p>';
    }

    // Top IPs
    const ipData = await apiCall("GET", "/api/admin/analytics/locations");
    const ipDiv = document.getElementById("topIps");
    if (ipDiv) {
      ipDiv.innerHTML = (ipData || []).length
        ? ipData.map(ip => `<div style="padding:6px 0;border-bottom:1px solid #1f1f30;display:flex;justify-content:space-between"><span>${ip.ip}</span><span style="color:#888">${ip.count}</span></div>`).join("")
        : '<p class="text-muted">No data</p>';
    }

    // Update active button
    document.querySelectorAll("#analytics .btn-sm, .page-header .btn-sm").forEach(b => b.classList.remove("active"));
    const btns = document.querySelectorAll(".btn-sm");
    btns.forEach(b => { if (b.textContent.includes(`${days} Day`)) b.classList.add("active"); });
  } catch (e) {
    console.error("Analytics error:", e);
  }
}

function exportAnalytics() {
  window.open(`${API_URL}/api/admin/analytics/export?token=${getToken()}`, "_blank");
}

// ─── Logs ──────────────────────────────────────────────────────────────────

let currentLogPage = 1;

async function loadLogs(page) {
  currentLogPage = page || currentLogPage;
  try {
    const data = await apiCall("GET", `/api/admin/audit-logs?page=${currentLogPage}&limit=50`);
    const tbody = document.getElementById("logsTableBody");
    if (!tbody) return;

    if (!data.logs.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:#888">No logs found</td></tr>`;
      return;
    }

    tbody.innerHTML = data.logs.map(l => `
      <tr>
        <td>${l.id}</td>
        <td>${l.user_id || "-"}</td>
        <td>${l.action}</td>
        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.details || "-"}</td>
        <td>${l.ip_address || "-"}</td>
        <td>${l.created_at ? new Date(l.created_at).toLocaleString() : "-"}</td>
      </tr>
    `).join("");

    const pages = Math.ceil(data.total / data.limit);
    let pagHtml = "";
    for (let i = 1; i <= pages; i++) {
      pagHtml += `<button class="${i == currentLogPage ? 'active' : ''}" onclick="loadLogs(${i})">${i}</button>`;
    }
    document.getElementById("logsPagination").innerHTML = pagHtml;
  } catch (e) {
    console.error("Logs error:", e);
  }
}

async function clearLogs() {
  if (!confirm("Clear all audit logs?")) return;
  try {
    await apiCall("DELETE", "/api/admin/audit-logs/clear");
    loadLogs(1);
  } catch (e) { alert(e.message); }
}

// ─── IP Blacklist ──────────────────────────────────────────────────────────

async function loadBlacklist() {
  try {
    const data = await apiCall("GET", "/api/admin/ip-blacklist");
    const tbody = document.getElementById("blacklistTableBody");
    if (!tbody) return;

    tbody.innerHTML = (data.blacklist || []).length
      ? data.blacklist.map(b => `
        <tr>
          <td>${b.id}</td>
          <td style="font-family:monospace">${b.ip_address}</td>
          <td>${b.reason || "-"}</td>
          <td>${b.created_at ? new Date(b.created_at).toLocaleString() : "-"}</td>
          <td><button class="btn-sm danger" onclick="removeFromBlacklist(${b.id})">Remove</button></td>
        </tr>
      `).join("")
      : '<tr><td colspan="5" style="text-align:center;padding:40px;color:#888">No blacklisted IPs</td></tr>';
  } catch (e) {
    console.error("Blacklist error:", e);
  }
}

function showAddIpModal() {
  document.getElementById("addIpModal").classList.remove("hidden");
}

async function addToBlacklist() {
  const ip = document.getElementById("blacklistIp").value.trim();
  const reason = document.getElementById("blacklistReason").value.trim();
  if (!ip) return alert("IP address required");
  try {
    await apiCall("POST", "/api/admin/ip-blacklist", { ip_address: ip, reason });
    closeModal("addIpModal");
    document.getElementById("blacklistIp").value = "";
    document.getElementById("blacklistReason").value = "";
    loadBlacklist();
  } catch (e) { alert(e.message); }
}

async function removeFromBlacklist(id) {
  if (!confirm("Remove this IP from blacklist?")) return;
  try {
    await apiCall("DELETE", `/api/admin/ip-blacklist/${id}`);
    loadBlacklist();
  } catch (e) { alert(e.message); }
}

// ─── Backup ────────────────────────────────────────────────────────────────

async function loadBackups() {
  try {
    const data = await apiCall("GET", "/api/admin/backup/list");
    const tbody = document.getElementById("backupTableBody");
    const noBackups = document.getElementById("noBackups");
    const restoreSel = document.getElementById("restoreSelect");

    if (tbody) {
      if ((data.backups || []).length) {
        tbody.innerHTML = data.backups.map(b => `
          <tr>
            <td>${b.name}</td>
            <td>${(b.size / 1024).toFixed(1)} KB</td>
            <td>${b.created ? new Date(b.created).toLocaleString() : "-"}</td>
            <td>
              <a href="${API_URL}/api/admin/backup/download/${b.name}?token=${getToken()}" class="btn-sm">⬇ Download</a>
              <button class="btn-sm danger" onclick="deleteBackup('${b.name}')">🗑</button>
            </td>
          </tr>
        `).join("");
        if (noBackups) noBackups.classList.add("hidden");
      } else {
        tbody.innerHTML = "";
        if (noBackups) noBackups.classList.remove("hidden");
      }
    }

    if (restoreSel) {
      restoreSel.innerHTML = (data.backups || []).length
        ? '<option value="">Select a backup...</option>' + data.backups.map(b => `<option value="${b.name}">${b.name}</option>`).join("")
        : '<option value="">No backups available</option>';
    }
  } catch (e) {
    console.error("Backups error:", e);
  }
}

async function createBackup() {
  try {
    await apiCall("POST", "/api/admin/backup/create");
    alert("Backup created!");
    loadBackups();
  } catch (e) { alert(e.message); }
}

async function restoreBackup() {
  const sel = document.getElementById("restoreSelect");
  if (!sel || !sel.value) return alert("Select a backup first");
  if (!confirm("Restore will overwrite current data. Continue?")) return;
  try {
    await apiCall("POST", `/api/admin/backup/restore/${sel.value}`);
    alert("Backup restored!");
  } catch (e) { alert(e.message); }
}

async function deleteBackup(name) {
  if (!confirm("Delete this backup?")) return;
  try {
    await apiCall("DELETE", `/api/admin/backup/${name}`);
    loadBackups();
  } catch (e) { alert(e.message); }
}

// Close modal on outside click
document.addEventListener("click", function(e) {
  document.querySelectorAll(".modal:not(.hidden)").forEach(m => {
    if (e.target === m) m.classList.add("hidden");
  });
});
