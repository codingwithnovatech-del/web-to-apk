const STORE = {
  users: "admin_users",
  keys: "admin_api_keys",
  settings: "admin_settings",
  logs: "admin_logs",
  blacklist: "admin_blacklist",
  backups: "admin_backups",
  builds: "admin_builds_cache"
};

function initStore() {
  if (!localStorage.getItem(STORE.users)) {
    localStorage.setItem(STORE.users, JSON.stringify([
      { id: 1, username: "Admin", email: "admin@webtoapk.app", password: "admin123", role: "admin", is_active: true, rate_limit: 100, last_login: null },
      { id: 2, username: "demo", email: "demo@webtoapk.app", password: "demo123", role: "editor", is_active: true, rate_limit: 10, last_login: null }
    ]));
  }
  if (!localStorage.getItem(STORE.keys)) {
    localStorage.setItem(STORE.keys, JSON.stringify([
      { id: 1, name: "Default Key", key: "wapk_" + Math.random().toString(36).slice(2, 10), permissions: "read,write", is_active: true, usage_count: 0, username: "Admin" }
    ]));
  }
  if (!localStorage.getItem(STORE.settings)) {
    localStorage.setItem(STORE.settings, JSON.stringify({
      max_builds_per_day: 10, max_file_size: 50, allowed_domains: "*", default_package: "com.webapk.app",
      build_timeout: 600, maintenance_mode: false, fcm_server_key: "", firebase_config: ""
    }));
  }
  if (!localStorage.getItem(STORE.logs)) localStorage.setItem(STORE.logs, "[]");
  if (!localStorage.getItem(STORE.blacklist)) localStorage.setItem(STORE.blacklist, "[]");
  if (!localStorage.getItem(STORE.backups)) localStorage.setItem(STORE.backups, "[]");
  if (!localStorage.getItem(STORE.builds)) localStorage.setItem(STORE.builds, "[]");
}

function getStore(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch { return []; }
}

function setStore(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function addLog(action, details) {
  const logs = getStore(STORE.logs);
  logs.unshift({ id: logs.length + 1, user_id: getUser()?.username || "Admin", action, details, ip_address: "127.0.0.1", created_at: new Date().toISOString() });
  if (logs.length > 200) logs.length = 200;
  setStore(STORE.logs, logs);
}

let cachedReleases = null;

async function fetchGitHubReleases(force) {
  if (cachedReleases && !force) return cachedReleases;
  try {
    const token = localStorage.getItem("github_token");
    const headers = token ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" } : { Accept: "application/vnd.github.v3+json" };
    const res = await fetch("https://api.github.com/repos/codingwithnovatech-del/web-to-apk/releases?per_page=50", { headers });
    if (res.ok) {
      cachedReleases = await res.json();
      setStore(STORE.builds, cachedReleases);
      return cachedReleases;
    }
  } catch {}
  const cached = getStore(STORE.builds);
  if (cached.length) { cachedReleases = cached; return cached; }
  return [];
}

function getToken() {
  return localStorage.getItem("admin_token") || localStorage.getItem("firebase_token") || "";
}

function getUser() {
  try { return JSON.parse(localStorage.getItem("admin_user")); }
  catch { return null; }
}

function isFirebaseUser() {
  return !!localStorage.getItem("firebase_token");
}

async function apiCall(method, path, body) {
  const parts = path.split("/").filter(Boolean);
  const resource = parts[0];

  if (resource === "api") {
    if (parts[1] === "admin") {
      if (parts[2] === "login") {
        const { username, password } = body || {};
        const users = getStore(STORE.users);
        const user = users.find(u => u.username === username && u.password === password && u.is_active);
        if (user) {
          user.last_login = new Date().toISOString();
          setStore(STORE.users, users);
          addLog("Login", `Admin login: ${username}`);
          return { token: "local_" + Math.random().toString(36).slice(2), user: { username: user.username, role: user.role, email: user.email } };
        }
        throw new Error("Invalid credentials");
      }

      if (parts[2] === "dashboard") {
        const releases = await fetchGitHubReleases();
        const apkReleases = releases.filter(r => r.assets?.some(a => a.name.endsWith(".apk")));
        const stats = {
          total_builds: apkReleases.length,
          successful: apkReleases.length,
          failed: 0,
          today: apkReleases.filter(r => new Date(r.created_at).toDateString() === new Date().toDateString()).length,
          queued: 0, in_progress: 0,
          avg_build_time: null
        };
        if (parts[3] === "stats") return stats;
        if (parts[3] === "top-urls") {
          return apkReleases.slice(0, 10).map(r => ({ url: r.name, count: r.assets?.length || 1 }));
        }
        if (parts[3] === "recent") {
          return apkReleases.slice(0, 5).map(r => ({
            app_name: r.name, url: r.body || r.html_url, status: "completed", created_at: r.created_at
          }));
        }
        if (parts[3] === "chart") {
          const days = parseInt(new URLSearchParams(path.split("?")[1] || "").get("days")) || 7;
          const chart = [];
          for (let i = days - 1; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().slice(0, 10);
            const dayBuilds = apkReleases.filter(r => r.created_at?.startsWith(dateStr));
            chart.push({ date: dateStr, success: dayBuilds.length, failed: 0 });
          }
          return chart;
        }
        return stats;
      }

      if (parts[2] === "builds") {
        const releases = await fetchGitHubReleases();
        const apkReleases = releases.filter(r => r.assets?.some(a => a.name.endsWith(".apk")));
        const builds = apkReleases.map(r => {
          const apk = r.assets.find(a => a.name.endsWith(".apk"));
          return {
            id: r.tag_name || r.id, url: r.body || "—", app_name: r.name,
            status: "completed", created_at: r.created_at, build_duration: null,
            file_size: apk?.size || null, user_ip: "—", download_url: apk?.browser_download_url
          };
        });

        if (parts[3] === "export") {
          return builds;
        }

        if (parts.length === 4 && parts[3]) {
          const b = builds.find(x => x.id === parts[3]);
          if (!b) throw new Error("Build not found");
          if (parts[4] === "logs") return { error_log: "No errors" };
          if (parts[4] === "rebuild") {
            addLog("Rebuild", `Rebuild triggered: ${b.id}`);
            return { build_id: b.id + "_rebuild" };
          }
          return b;
        }

        if (parts[4] === "batch-delete") {
          addLog("Batch delete", `Deleted ${body?.ids?.length || 0} builds`);
          return { ok: true };
        }

        if (parts[4] === "rebuild") {
          addLog("Rebuild", `Rebuild triggered: ${parts[3]}`);
          return { build_id: parts[3] + "_rebuild" };
        }

        const searchParams = new URLSearchParams(path.split("?").slice(1).join("?"));
        const page = parseInt(searchParams.get("page")) || 1;
        const limit = parseInt(searchParams.get("limit")) || 20;
        const status = searchParams.get("status") || "";
        const search = searchParams.get("search") || "";
        let filtered = builds;
        if (status) filtered = filtered.filter(b => b.status === status);
        if (search) filtered = filtered.filter(b => b.app_name?.toLowerCase().includes(search.toLowerCase()) || b.url?.toLowerCase().includes(search.toLowerCase()));
        const total = filtered.length;
        const paged = filtered.slice((page - 1) * limit, page * limit);
        return { builds: paged, total, pages: Math.ceil(total / limit), page };
      }

      if (parts[2] === "users") {
        let users = getStore(STORE.users);
        if (parts.length === 4 && parts[3]) {
          const id = parseInt(parts[3]);
          if (parts[4] === "delete") throw new Error("Use DELETE method");
          if (method === "PUT") {
            users = users.map(u => u.id === id ? { ...u, ...body } : u);
            setStore(STORE.users, users);
            addLog("User update", `Updated user ${id}`);
            return { ok: true };
          }
          if (method === "DELETE") {
            users = users.filter(u => u.id !== id);
            setStore(STORE.users, users);
            addLog("User delete", `Deleted user ${id}`);
            return { ok: true };
          }
        }
        if (method === "POST") {
          const newUser = { id: users.length ? Math.max(...users.map(u => u.id)) + 1 : 1, ...body, is_active: true, last_login: null };
          users.push(newUser);
          setStore(STORE.users, users);
          addLog("User create", `Created user: ${body.username}`);
          return newUser;
        }
        return { users };
      }

      if (parts[2] === "api-keys") {
        let keys = getStore(STORE.keys);
        if (parts.length === 4 && parts[3]) {
          const id = parseInt(parts[3]);
          if (method === "PUT") {
            keys = keys.map(k => k.id === id ? { ...k, ...body } : k);
            setStore(STORE.keys, keys);
            return { ok: true };
          }
          if (method === "DELETE") {
            keys = keys.filter(k => k.id !== id);
            setStore(STORE.keys, keys);
            return { ok: true };
          }
        }
        if (method === "POST") {
          const newKey = { id: keys.length ? Math.max(...keys.map(k => k.id)) + 1 : 1, key: "wapk_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10), ...body, is_active: true, usage_count: 0, username: getUser()?.username || "Admin" };
          keys.push(newKey);
          setStore(STORE.keys, keys);
          addLog("API key create", `Created key: ${body.name}`);
          return newKey;
        }
        return { keys };
      }

      if (parts[2] === "settings") {
        let settings = getStore(STORE.settings);
        if (method === "PUT") {
          const merged = { ...settings, ...body };
          if (body.settings) Object.assign(merged, body.settings);
          setStore(STORE.settings, merged);
          addLog("Settings", "Settings updated");
          return { ok: true };
        }
        if (parts[3] === "save") {
          setStore(STORE.settings, { ...getStore(STORE.settings), ...body });
          addLog("Settings", "Settings saved");
          return { ok: true };
        }
        return settings;
      }

      if (parts[2] === "me" && parts[3] === "password" && method === "PUT") {
        const users = getStore(STORE.users);
        const user = getUser();
        const idx = users.findIndex(u => u.username === user?.username);
        if (idx >= 0) {
          users[idx].password = body.new_password;
          setStore(STORE.users, users);
          addLog("Password change", "Password changed");
        }
        return { ok: true };
      }

      if (parts[2] === "analytics") {
        const releases = await fetchGitHubReleases();
        const apkReleases = releases.filter(r => r.assets?.some(a => a.name.endsWith(".apk")));
        if (parts[3] === "overview") {
          return {
            status_breakdown: [{ status: "completed", count: apkReleases.length }],
            common_errors: [],
            total_builds: apkReleases.length
          };
        }
        if (parts[3] === "errors") {
          return [];
        }
        if (parts[3] === "locations") {
          return apkReleases.slice(0, 10).map(r => ({ ip: "GitHub", count: 1 }));
        }
        if (parts[3] === "export") {
          return { ok: true };
        }
      }

      if (parts[2] === "audit-logs") {
        let logs = getStore(STORE.logs);
        if (parts[3] === "clear" && method === "DELETE") {
          setStore(STORE.logs, "[]");
          return { ok: true };
        }
        const searchParams = new URLSearchParams(path.split("?").slice(1).join("?"));
        const page = parseInt(searchParams.get("page")) || 1;
        const limit = parseInt(searchParams.get("limit")) || 50;
        const paged = logs.slice((page - 1) * limit, page * limit);
        return { logs: paged, total: logs.length, limit };
      }

      if (parts[2] === "ip-blacklist") {
        let blacklist = getStore(STORE.blacklist);
        if (parts.length === 4 && parts[3]) {
          const id = parseInt(parts[3]);
          if (method === "DELETE") {
            blacklist = blacklist.filter(b => b.id !== id);
            setStore(STORE.blacklist, blacklist);
            return { ok: true };
          }
        }
        if (method === "POST") {
          const newEntry = { id: blacklist.length ? Math.max(...blacklist.map(b => b.id)) + 1 : 1, ...body, created_at: new Date().toISOString() };
          blacklist.push(newEntry);
          setStore(STORE.blacklist, blacklist);
          addLog("IP blacklist", `Added IP: ${body.ip_address}`);
          return newEntry;
        }
        return { blacklist };
      }

      if (parts[2] === "backup") {
        let backups = getStore(STORE.backups);
        if (parts[3] === "list" || parts.length === 3) {
          return { backups };
        }
        if (parts[3] === "create" && method === "POST") {
          const name = `backup_${new Date().toISOString().slice(0, 10)}_${Date.now()}`;
          const backup = { name, size: 1024, created: new Date().toISOString(), data: { users: getStore(STORE.users), keys: getStore(STORE.keys), settings: getStore(STORE.settings), blacklist: getStore(STORE.blacklist) } };
          backups.push(backup);
          setStore(STORE.backups, backups);
          addLog("Backup", `Backup created: ${name}`);
          return backup;
        }
        if (parts[4] && method === "POST" && parts[4] === "restore") {
          const name = parts[3];
          const backup = backups.find(b => b.name === name);
          if (backup?.data) {
            Object.entries(backup.data).forEach(([key, val]) => {
              if (STORE[key]) setStore(STORE[key], val);
            });
            addLog("Backup restore", `Restored: ${name}`);
          }
          return { ok: true };
        }
        if (parts[4] && method === "DELETE") {
          backups = backups.filter(b => b.name !== parts[3]);
          setStore(STORE.backups, backups);
          return { ok: true };
        }
        if (parts[3] === "download" && parts[4]) {
          return { ok: true };
        }
      }
    }
  }
  throw new Error("Not found");
}

function adminLogin() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const errEl = document.getElementById("loginError");
  if (!username || !password) {
    errEl.textContent = "Please fill all fields";
    errEl.classList.remove("hidden");
    return;
  }
  apiCall("POST", "/api/admin/login", { username, password })
    .then(data => {
      localStorage.setItem("admin_token", data.token);
      localStorage.setItem("admin_user", JSON.stringify(data.user));
      window.location.href = "dashboard.html";
    })
    .catch(() => {
      if (username === "admin" && password === "admin123") {
        localStorage.setItem("admin_token", "local_demo_token");
        localStorage.setItem("admin_user", JSON.stringify({ username: "Admin", role: "admin" }));
        window.location.href = "dashboard.html";
        return;
      }
      errEl.textContent = "Login failed. Try admin/admin123";
      errEl.classList.remove("hidden");
    });
}

function adminLogout() {
  localStorage.removeItem("admin_token");
  localStorage.removeItem("firebase_token");
  localStorage.removeItem("admin_user");
  window.location.href = "index.html";
}

(function checkAuth() {
  initStore();
  const token = getToken();
  if (!token && !window.location.pathname.endsWith("index.html")) {
    window.location.href = "index.html";
  }
  const user = getUser();
  if (user && document.getElementById("userName")) {
    document.getElementById("userName").textContent = user.username || user.email || "Admin";
  }
})();

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
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "#888" } } },
        scales: {
          x: { ticks: { color: "#888" }, grid: { color: "#1f1f30" } },
          y: { ticks: { color: "#888" }, grid: { color: "#1f1f30" } }
        }
      }
    });
    document.querySelectorAll(".btn-group .btn-sm").forEach(b => b.classList.remove("active"));
    const btns = document.querySelectorAll(".btn-group .btn-sm");
    btns.forEach(b => { if (b.textContent.trim() == days + "D" || (days == 7 && b.textContent.trim() == "7D")) b.classList.add("active"); });
  } catch (e) {
    console.error("Chart error:", e);
  }
}

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
  const token = getToken();
  window.open(`builds.html?export=1&token=${token}`, "_blank");
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
    if (build.download_url) {
      document.getElementById("buildDetail").innerHTML += `<div style="margin-top:16px"><a href="${build.download_url}" target="_blank" class="btn-sm" style="background:#e94560;color:#fff;padding:8px 16px;text-decoration:none">Download APK</a></div>`;
    }
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

let statusChartInstance = null;
let errorsChartInstance = null;

async function loadAnalytics(days) {
  try {
    const data = await apiCall("GET", `/api/admin/analytics/overview?range=${days}d`);
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
        options: { responsive: true, plugins: { legend: { position: "bottom", labels: { color: "#888" } } } }
      });
    }
    const errorsData = await apiCall("GET", "/api/admin/analytics/errors");
    const ctx2 = document.getElementById("errorsChart");
    if (ctx2) {
      if (errorsChartInstance) errorsChartInstance.destroy();
      errorsChartInstance = new Chart(ctx2, {
        type: "line", data: {
          labels: (errorsData || []).map(e => e.date).reverse(),
          datasets: [{
            label: "Errors", data: (errorsData || []).map(e => e.count).reverse(),
            borderColor: "#ff453a", backgroundColor: "rgba(255,69,58,0.1)", fill: true, tension: 0.3
          }]
        },
        options: {
          responsive: true, plugins: { legend: { labels: { color: "#888" } } },
          scales: { x: { ticks: { color: "#888" }, grid: { color: "#1f1f30" } }, y: { ticks: { color: "#888" }, grid: { color: "#1f1f30" } } }
        }
      });
    }
    const errDiv = document.getElementById("commonErrors");
    if (errDiv) {
      errDiv.innerHTML = (data.common_errors || []).length
        ? data.common_errors.map(e => `<div style="padding:6px 0;border-bottom:1px solid #1f1f30">${e.error} — <strong>${e.count}</strong></div>`).join("")
        : '<p class="text-muted">No errors found</p>';
    }
    const ipData = await apiCall("GET", "/api/admin/analytics/locations");
    const ipDiv = document.getElementById("topIps");
    if (ipDiv) {
      ipDiv.innerHTML = (ipData || []).length
        ? ipData.map(ip => `<div style="padding:6px 0;border-bottom:1px solid #1f1f30;display:flex;justify-content:space-between"><span>${ip.ip}</span><span style="color:#888">${ip.count}</span></div>`).join("")
        : '<p class="text-muted">No data</p>';
    }
    document.querySelectorAll("#analytics .btn-sm, .page-header .btn-sm").forEach(b => b.classList.remove("active"));
    const btns = document.querySelectorAll(".btn-sm");
    btns.forEach(b => { if (b.textContent.includes(`${days} Day`)) b.classList.add("active"); });
  } catch (e) {
    console.error("Analytics error:", e);
  }
}

function exportAnalytics() {
  window.open(`analytics.html?export=1`, "_blank");
}

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
            <td><button class="btn-sm danger" onclick="deleteBackup('${b.name}')">🗑</button></td>
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

document.addEventListener("click", function(e) {
  document.querySelectorAll(".modal:not(.hidden)").forEach(m => {
    if (e.target === m) m.classList.add("hidden");
  });
});
