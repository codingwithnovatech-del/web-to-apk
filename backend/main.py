import os, sys, uuid, json, asyncio, datetime, secrets, hashlib, zipfile, io
import httpx
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
import bcrypt

print("Importing database...", flush=True)
sys.stdout.flush()
from database import get_db, init_db

print("Creating app...", flush=True)
sys.stdout.flush()
app = FastAPI(title="Website to APK Converter", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
REPO = os.getenv("REPO", "yourusername/website-to-apk")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_hex(32))
API_URL = os.getenv("API_URL", "http://localhost:8000")

@app.on_event("startup")
async def startup():
    print("Starting up...", flush=True)
    sys.stdout.flush()
    try:
        await init_db()
        print("DB initialized", flush=True)
    except Exception as e:
        print(f"Startup error: {e}", flush=True)
    print("Startup complete", flush=True)
    sys.stdout.flush()

# ─── Models ────────────────────────────────────────────────────────────────

class BuildRequest(BaseModel):
    url: str
    app_name: str

class AdminLogin(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    username: str
    password: str
    email: str = ""
    role: str = "admin"
    rate_limit: int = 10

class SettingUpdate(BaseModel):
    key: str
    value: str

class SettingsBulkUpdate(BaseModel):
    settings: dict

class ApiKeyCreate(BaseModel):
    name: str = ""
    permissions: str = "read"

# ─── Auth Helpers ──────────────────────────────────────────────────────────

def create_jwt(user_id: int, role: str):
    import jwt
    exp = datetime.datetime.utcnow() + datetime.timedelta(days=1)
    payload = {"sub": user_id, "role": role, "exp": exp, "iat": datetime.datetime.utcnow()}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def verify_jwt(token: str):
    import jwt
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except:
        return None

async def get_current_user(request: Request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Unauthorized")
    payload = verify_jwt(auth[7:])
    if not payload:
        raise HTTPException(401, "Invalid or expired token")
    return payload

async def check_admin(request: Request):
    user = await get_current_user(request)
    if user["role"] not in ("admin", "superadmin"):
        raise HTTPException(403, "Admin access required")
    return user

async def check_superadmin(request: Request):
    user = await get_current_user(request)
    if user["role"] != "superadmin":
        raise HTTPException(403, "Superadmin access required")
    return user

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def check_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

# ─── User-Facing APIs ──────────────────────────────────────────────────────

@app.post("/api/build")
async def start_build(req: BuildRequest, request: Request):
    if not req.url.startswith(("http://", "https://")):
        raise HTTPException(400, "Invalid URL. Must start with http:// or https://")
    if not req.app_name.strip():
        raise HTTPException(400, "App name required")
    if len(req.app_name) > 50:
        raise HTTPException(400, "App name too long (max 50 chars)")

    # Check blacklist
    client_ip = request.client.host if request.client else "unknown"
    db = await get_db()
    cursor = await db.execute("SELECT id FROM ip_blacklist WHERE ip_address = ?", (client_ip,))
    if await cursor.fetchone():
        await db.close()
        raise HTTPException(403, "Your IP is blocked")
    await db.close()

    build_id = str(uuid.uuid4())[:8]

    db = await get_db()
    await db.execute(
        "INSERT INTO builds (id, url, app_name, status, user_ip) VALUES (?, ?, ?, 'queued', ?)",
        (build_id, req.url, req.app_name, client_ip)
    )
    await db.commit()
    await db.close()

    # Trigger GitHub Actions workflow via workflow_dispatch
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"https://api.github.com/repos/{REPO}/actions/workflows/build.yml/dispatches",
                headers={
                    "Authorization": f"Bearer {GITHUB_TOKEN}",
                    "Accept": "application/vnd.github.v3+json"
                },
                json={
                    "ref": "main",
                    "inputs": {
                        "url": req.url,
                        "app_name": req.app_name,
                        "build_id": build_id
                    }
                }
            )
            if resp.status_code not in (204, 201):
                db = await get_db()
                await db.execute("UPDATE builds SET status = 'failed', error_log = ? WHERE id = ?",
                    (f"GitHub trigger failed: {resp.status_code}", build_id))
                await db.commit()
                await db.close()
                raise HTTPException(502, "Build trigger failed")
    except httpx.RequestError as e:
        db = await get_db()
        await db.execute("UPDATE builds SET status = 'failed', error_log = ? WHERE id = ?",
            (f"Network error: {str(e)}", build_id))
        await db.commit()
        await db.close()
        raise HTTPException(502, "Cannot reach GitHub API")

    # Also log audit
    db = await get_db()
    await db.execute("INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (NULL, 'build_started', ?, ?)",
        (f"URL: {req.url}, App: {req.app_name}", client_ip))
    await db.commit()
    await db.close()

    return {"build_id": build_id, "app_name": req.app_name, "message": "Build started"}

@app.get("/api/status/{build_id}")
async def get_status(build_id: str):
    db = await get_db()
    cursor = await db.execute("SELECT status, error_log, build_duration FROM builds WHERE id = ?", (build_id,))
    row = await cursor.fetchone()
    await db.close()
    if not row:
        raise HTTPException(404, "Build not found")
    return {"status": row["status"], "error": row["error_log"], "duration": row["build_duration"]}

@app.get("/api/download/{build_id}")
async def download_apk(build_id: str):
    db = await get_db()
    cursor = await db.execute("SELECT status, app_name FROM builds WHERE id = ?", (build_id,))
    row = await cursor.fetchone()
    await db.close()
    if not row:
        raise HTTPException(404, "Build not found")
    if row["status"] != "completed":
        raise HTTPException(400, "Build not completed yet")
    # Redirect to GitHub artifact URL
    return {
        "url": f"https://github.com/{REPO}/releases/download/{build_id}/{row['app_name']}.apk",
        "app_name": row["app_name"]
    }

# ─── Admin Auth APIs ───────────────────────────────────────────────────────

@app.post("/api/admin/login")
async def admin_login(req: AdminLogin, request: Request):
    db = await get_db()
    cursor = await db.execute("SELECT id, username, password_hash, role, is_active FROM users WHERE username = ?", (req.username,))
    user = await cursor.fetchone()
    await db.close()

    if not user or not check_password(req.password, user["password_hash"]):
        # Log failed attempt
        db = await get_db()
        await db.execute("INSERT INTO audit_logs (action, details, ip_address) VALUES (?, ?, ?)",
            ("login_failed", f"Username: {req.username}", request.client.host if request.client else "unknown"))
        await db.commit()
        await db.close()
        raise HTTPException(401, "Invalid credentials")

    if not user["is_active"]:
        raise HTTPException(403, "Account is deactivated")

    token = create_jwt(user["id"], user["role"])
    db = await get_db()
    await db.execute("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", (user["id"],))
    await db.execute("INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)",
        (user["id"], "login", "Login successful", request.client.host if request.client else "unknown"))
    await db.commit()
    await db.close()

    return {"token": token, "user": {"id": user["id"], "username": user["username"], "role": user["role"]}}

@app.post("/api/admin/logout")
async def admin_logout(user: dict = Depends(get_current_user)):
    return {"message": "Logged out"}

@app.get("/api/admin/me")
async def admin_me(user: dict = Depends(get_current_user)):
    db = await get_db()
    cursor = await db.execute("SELECT id, username, email, role, created_at, last_login, rate_limit FROM users WHERE id = ?", (user["sub"],))
    row = await cursor.fetchone()
    await db.close()
    if not row:
        raise HTTPException(404, "User not found")
    return dict(row)

@app.put("/api/admin/me/password")
async def change_my_password(data: dict, request: Request, user: dict = Depends(get_current_user)):
    new_pass = data.get("new_password", "")
    if len(new_pass) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    db = await get_db()
    hashed = hash_password(new_pass)
    await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hashed, user["sub"]))
    await db.execute("INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)",
        (user["sub"], "password_change", "Password changed", request.client.host if request.client else "unknown"))
    await db.commit()
    await db.close()
    return {"message": "Password changed"}

# ─── Admin Dashboard APIs ──────────────────────────────────────────────────

@app.get("/api/admin/dashboard/stats")
async def dashboard_stats(user: dict = Depends(check_admin)):
    db = await get_db()
    total = await db.execute("SELECT COUNT(*) as c FROM builds")
    total_row = await total.fetchone()
    success = await db.execute("SELECT COUNT(*) as c FROM builds WHERE status = 'completed'")
    success_row = await success.fetchone()
    failed = await db.execute("SELECT COUNT(*) as c FROM builds WHERE status = 'failed'")
    failed_row = await failed.fetchone()
    queued = await db.execute("SELECT COUNT(*) as c FROM builds WHERE status = 'queued'")
    queued_row = await queued.fetchone()
    building = await db.execute("SELECT COUNT(*) as c FROM builds WHERE status = 'building'")
    building_row = await building.fetchone()
    today = await db.execute("SELECT COUNT(*) as c FROM builds WHERE date(created_at) = date('now')")
    today_row = await today.fetchone()
    avg_time = await db.execute("SELECT AVG(build_duration) as avg FROM builds WHERE build_duration IS NOT NULL")
    avg_row = await avg.fetchone()
    await db.close()

    return {
        "total_builds": total_row["c"],
        "successful": success_row["c"],
        "failed": failed_row["c"],
        "queued": queued_row["c"],
        "in_progress": building_row["c"],
        "today": today_row["c"],
        "avg_build_time": round(avg_row["avg"]) if avg_row["avg"] else 0
    }

@app.get("/api/admin/dashboard/chart")
async def dashboard_chart(days: int = 7, user: dict = Depends(check_admin)):
    db = await get_db()
    rows = await db.execute("""
        SELECT date(created_at) as day, COUNT(*) as count,
               SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as success,
               SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as fail
        FROM builds WHERE created_at >= datetime('now', ? || ' days')
        GROUP BY day ORDER BY day
    """, (f"-{days}",))
    data = await rows.fetchall()
    await db.close()
    return [{"date": r["day"], "total": r["count"], "success": r["success"], "failed": r["fail"]} for r in data]

@app.get("/api/admin/dashboard/top-urls")
async def top_urls(limit: int = 5, user: dict = Depends(check_admin)):
    db = await get_db()
    rows = await db.execute("SELECT url, COUNT(*) as count FROM builds GROUP BY url ORDER BY count DESC LIMIT ?", (limit,))
    data = await rows.fetchall()
    await db.close()
    return [{"url": r["url"], "count": r["count"]} for r in data]

@app.get("/api/admin/dashboard/recent")
async def recent_builds(limit: int = 10, user: dict = Depends(check_admin)):
    db = await get_db()
    rows = await db.execute("SELECT id, url, app_name, status, created_at, build_duration FROM builds ORDER BY created_at DESC LIMIT ?", (limit,))
    data = await rows.fetchall()
    await db.close()
    return [dict(r) for r in data]

# ─── Admin Build Management APIs ───────────────────────────────────────────

@app.get("/api/admin/builds")
async def list_builds(page: int = 1, limit: int = 20, status: str = "", search: str = "", sort: str = "created_at", order: str = "desc", user: dict = Depends(check_admin)):
    db = await get_db()
    query = "SELECT * FROM builds WHERE 1=1"
    params = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if search:
        query += " AND (url LIKE ? OR app_name LIKE ? OR id LIKE ?)"
        s = f"%{search}%"
        params.extend([s, s, s])

    # Count
    count_cursor = await db.execute(query.replace("SELECT *", "SELECT COUNT(*) as c"), params)
    count_row = await count_cursor.fetchone()
    total = count_row["c"]

    allowed_sort = {"created_at", "app_name", "url", "status", "build_duration"}
    if sort not in allowed_sort:
        sort = "created_at"
    order_sql = "DESC" if order == "desc" else "ASC"
    offset = (page - 1) * limit
    query += f" ORDER BY {sort} {order_sql} LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    rows = await db.execute(query, params)
    data = await rows.fetchall()
    await db.close()
    return {
        "builds": [dict(r) for r in data],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": -(-total // limit)  # ceil division
    }

@app.get("/api/admin/builds/{build_id}")
async def get_build_detail(build_id: str, user: dict = Depends(check_admin)):
    db = await get_db()
    cursor = await db.execute("SELECT * FROM builds WHERE id = ?", (build_id,))
    row = await cursor.fetchone()
    await db.close()
    if not row:
        raise HTTPException(404, "Build not found")
    return dict(row)

@app.get("/api/admin/builds/{build_id}/logs")
async def get_build_logs(build_id: str, user: dict = Depends(check_admin)):
    db = await get_db()
    cursor = await db.execute("SELECT error_log, status, created_at, completed_at, build_duration FROM builds WHERE id = ?", (build_id,))
    row = await cursor.fetchone()
    await db.close()
    if not row:
        raise HTTPException(404, "Build not found")
    return dict(row)

@app.delete("/api/admin/builds/{build_id}")
async def delete_build(build_id: str, user: dict = Depends(check_admin)):
    db = await get_db()
    await db.execute("DELETE FROM builds WHERE id = ?", (build_id,))
    await db.commit()
    await db.close()
    return {"message": "Build deleted"}

@app.post("/api/admin/builds/batch-delete")
async def batch_delete_builds(data: dict, user: dict = Depends(check_admin)):
    ids = data.get("ids", [])
    if not ids:
        raise HTTPException(400, "No IDs provided")
    placeholders = ",".join("?" * len(ids))
    db = await get_db()
    await db.execute(f"DELETE FROM builds WHERE id IN ({placeholders})", ids)
    await db.commit()
    await db.close()
    return {"message": f"Deleted {len(ids)} builds"}

@app.post("/api/admin/builds/{build_id}/rebuild")
async def rebuild_apk(build_id: str, user: dict = Depends(check_admin)):
    db = await get_db()
    cursor = await db.execute("SELECT url, app_name FROM builds WHERE id = ?", (build_id,))
    row = await cursor.fetchone()
    if not row:
        await db.close()
        raise HTTPException(404, "Build not found")

    new_id = str(uuid.uuid4())[:8]
    await db.execute(
        "INSERT INTO builds (id, url, app_name, status) VALUES (?, ?, ?, 'queued')",
        (new_id, row["url"], row["app_name"])
    )
    await db.commit()
    await db.close()

    # Trigger GitHub Action
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            await client.post(
                f"https://api.github.com/repos/{REPO}/dispatches",
                headers={
                    "Authorization": f"Bearer {GITHUB_TOKEN}",
                    "Accept": "application/vnd.github.v3+json"
                },
                json={
                    "event_type": "build-apk",
                    "client_payload": {
                        "url": row["url"],
                        "app_name": row["app_name"],
                        "build_id": new_id
                    }
                }
            )
        except:
            pass

    return {"build_id": new_id, "message": "Rebuild started"}

@app.get("/api/admin/builds/export")
async def export_builds(format: str = "csv", user: dict = Depends(check_admin)):
    db = await get_db()
    rows = await db.execute("SELECT id, url, app_name, status, created_at, completed_at, build_duration, user_ip FROM builds ORDER BY created_at DESC")
    data = await rows.fetchall()
    await db.close()

    if format == "json":
        return JSONResponse(content=[dict(r) for r in data])

    # CSV
    import csv, io
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "URL", "App Name", "Status", "Created", "Completed", "Duration (s)", "User IP"])
    for r in data:
        writer.writerow([r["id"], r["url"], r["app_name"], r["status"], r["created_at"], r["completed_at"], r["build_duration"], r["user_ip"]])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=builds_export.csv"})

# ─── Admin User Management APIs ────────────────────────────────────────────

@app.get("/api/admin/users")
async def list_users(user: dict = Depends(check_superadmin)):
    db = await get_db()
    rows = await db.execute("SELECT id, username, email, role, is_active, created_at, last_login, rate_limit FROM users")
    data = await rows.fetchall()
    await db.close()
    return {"users": [dict(r) for r in data]}

@app.post("/api/admin/users")
async def create_user(req: UserCreate, request: Request, user: dict = Depends(check_superadmin)):
    if len(req.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    db = await get_db()
    hashed = hash_password(req.password)
    try:
        cursor = await db.execute(
            "INSERT INTO users (username, email, password_hash, role, rate_limit) VALUES (?, ?, ?, ?, ?)",
            (req.username, req.email, hashed, req.role, req.rate_limit)
        )
        await db.commit()
        uid = cursor.lastrowid
        await db.execute("INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)",
            (user["sub"], "user_created", f"Created user: {req.username}", request.client.host if request.client else "unknown"))
        await db.commit()
    except Exception as e:
        await db.close()
        if "UNIQUE" in str(e):
            raise HTTPException(409, "Username already exists")
        raise HTTPException(500, str(e))
    await db.close()
    return {"id": uid, "username": req.username, "message": "User created"}

@app.put("/api/admin/users/{user_id}")
async def update_user(user_id: int, data: dict, request: Request, user: dict = Depends(check_superadmin)):
    db = await get_db()
    allowed = {"email", "role", "is_active", "rate_limit"}
    updates = []
    params = []
    for key, val in data.items():
        if key in allowed:
            updates.append(f"{key} = ?")
            params.append(val)
    if not updates:
        await db.close()
        raise HTTPException(400, "No valid fields to update")
    params.append(user_id)
    await db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
    await db.execute("INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)",
        (user["sub"], "user_updated", f"Updated user {user_id}: {json.dumps(data)}", request.client.host if request.client else "unknown"))
    await db.commit()
    await db.close()
    return {"message": "User updated"}

@app.delete("/api/admin/users/{user_id}")
async def delete_user(user_id: int, request: Request, user: dict = Depends(check_superadmin)):
    db = await get_db()
    await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    await db.execute("INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)",
        (user["sub"], "user_deleted", f"Deleted user {user_id}", request.client.host if request.client else "unknown"))
    await db.commit()
    await db.close()
    return {"message": "User deleted"}

@app.put("/api/admin/users/{user_id}/reset-password")
async def reset_user_password(user_id: int, data: dict, request: Request, user: dict = Depends(check_superadmin)):
    new_pass = data.get("new_password", "")
    if len(new_pass) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    db = await get_db()
    hashed = hash_password(new_pass)
    await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hashed, user_id))
    await db.execute("INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)",
        (user["sub"], "password_reset", f"Reset password for user {user_id}", request.client.host if request.client else "unknown"))
    await db.commit()
    await db.close()
    return {"message": "Password reset"}

# ─── Admin API Key Management ──────────────────────────────────────────────

@app.get("/api/admin/api-keys")
async def list_api_keys(user: dict = Depends(check_admin)):
    db = await get_db()
    rows = await db.execute("""
        SELECT k.id, k.key, k.name, k.permissions, k.last_used, k.usage_count, k.is_active, k.created_at, u.username
        FROM api_keys k LEFT JOIN users u ON k.user_id = u.id
    """)
    data = await rows.fetchall()
    await db.close()
    return {"keys": [dict(r) for r in data]}

@app.post("/api/admin/api-keys")
async def create_api_key(req: ApiKeyCreate, user: dict = Depends(check_admin)):
    key = "wapk_" + secrets.token_hex(24)
    db = await get_db()
    await db.execute(
        "INSERT INTO api_keys (user_id, key, name, permissions) VALUES (?, ?, ?, ?)",
        (user["sub"], key, req.name, req.permissions)
    )
    await db.commit()
    await db.close()
    return {"key": key, "name": req.name, "permissions": req.permissions, "message": "API key created"}

@app.put("/api/admin/api-keys/{key_id}")
async def update_api_key(key_id: int, data: dict, user: dict = Depends(check_admin)):
    db = await get_db()
    allowed = {"name", "permissions", "is_active"}
    updates = []
    params = []
    for k, v in data.items():
        if k in allowed:
            updates.append(f"{k} = ?")
            params.append(v)
    if not updates:
        await db.close()
        raise HTTPException(400, "No valid fields")
    params.append(key_id)
    await db.execute(f"UPDATE api_keys SET {', '.join(updates)} WHERE id = ?", params)
    await db.commit()
    await db.close()
    return {"message": "API key updated"}

@app.delete("/api/admin/api-keys/{key_id}")
async def delete_api_key(key_id: int, user: dict = Depends(check_admin)):
    db = await get_db()
    await db.execute("DELETE FROM api_keys WHERE id = ?", (key_id,))
    await db.commit()
    await db.close()
    return {"message": "API key deleted"}

# ─── Admin Settings APIs ───────────────────────────────────────────────────

@app.get("/api/admin/settings")
async def get_settings(user: dict = Depends(check_admin)):
    db = await get_db()
    rows = await db.execute("SELECT key, value FROM settings")
    data = await rows.fetchall()
    await db.close()
    return {r["key"]: r["value"] for r in data}

@app.put("/api/admin/settings")
async def update_settings(req: SettingsBulkUpdate, user: dict = Depends(check_superadmin)):
    db = await get_db()
    for key, val in req.settings.items():
        await db.execute("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP",
            (key, str(val), str(val)))
    await db.commit()
    await db.close()
    return {"message": "Settings updated"}

@app.put("/api/admin/settings/{key}")
async def update_setting(key: str, req: SettingUpdate, user: dict = Depends(check_superadmin)):
    db = await get_db()
    await db.execute("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP",
        (key, req.value, req.value))
    await db.commit()
    await db.close()
    return {"message": f"Setting '{key}' updated"}

# ─── Admin Analytics APIs ──────────────────────────────────────────────────

@app.get("/api/admin/analytics/overview")
async def analytics_overview(range: str = "7d", user: dict = Depends(check_admin)):
    days_map = {"7d": 7, "30d": 30, "90d": 90}
    d = days_map.get(range, 7)
    db = await get_db()
    rows = await db.execute("""
        SELECT status, COUNT(*) as count FROM builds
        WHERE created_at >= datetime('now', ? || ' days')
        GROUP BY status
    """, (f"-{d}",))
    data = await rows.fetchall()
    # Error breakdown
    errors = await db.execute("""
        SELECT error_log, COUNT(*) as count FROM builds
        WHERE status='failed' AND created_at >= datetime('now', ? || ' days')
        AND error_log IS NOT NULL
        GROUP BY error_log ORDER BY count DESC LIMIT 10
    """, (f"-{d}",))
    error_data = await errors.fetchall()
    await db.close()
    return {
        "status_breakdown": [{"status": r["status"], "count": r["count"]} for r in data],
        "common_errors": [{"error": r["error_log"], "count": r["count"]} for r in error_data]
    }

@app.get("/api/admin/analytics/errors")
async def analytics_errors(user: dict = Depends(check_admin)):
    db = await get_db()
    rows = await db.execute("""
        SELECT strftime('%Y-%m-%d', created_at) as day, COUNT(*) as count
        FROM builds WHERE status='failed'
        GROUP BY day ORDER BY day DESC LIMIT 30
    """)
    data = await rows.fetchall()
    await db.close()
    return [{"date": r["day"], "count": r["count"]} for r in data]

@app.get("/api/admin/analytics/locations")
async def analytics_locations(user: dict = Depends(check_admin)):
    db = await get_db()
    rows = await db.execute("SELECT user_ip, COUNT(*) as count FROM builds WHERE user_ip IS NOT NULL GROUP BY user_ip ORDER BY count DESC LIMIT 20")
    data = await rows.fetchall()
    await db.close()
    return [{"ip": r["user_ip"], "count": r["count"]} for r in data]

@app.get("/api/admin/analytics/export")
async def export_analytics(user: dict = Depends(check_admin)):
    db = await get_db()
    rows = await db.execute("""
        SELECT strftime('%Y-%m-%d', created_at) as day, COUNT(*) as total,
               SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as success,
               SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
        FROM builds GROUP BY day ORDER BY day
    """)
    data = await rows.fetchall()
    await db.close()
    import csv, io
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Total", "Successful", "Failed"])
    for r in data:
        writer.writerow([r["day"], r["total"], r["success"], r["failed"]])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=analytics_report.csv"})

# ─── Admin IP Blacklist APIs ───────────────────────────────────────────────

@app.get("/api/admin/ip-blacklist")
async def list_blacklist(user: dict = Depends(check_superadmin)):
    db = await get_db()
    rows = await db.execute("SELECT id, ip_address, reason, created_at FROM ip_blacklist ORDER BY created_at DESC")
    data = await rows.fetchall()
    await db.close()
    return {"blacklist": [dict(r) for r in data]}

@app.post("/api/admin/ip-blacklist")
async def add_to_blacklist(data: dict, user: dict = Depends(check_superadmin)):
    ip = data.get("ip_address", "")
    reason = data.get("reason", "")
    if not ip:
        raise HTTPException(400, "IP address required")
    db = await get_db()
    try:
        await db.execute("INSERT INTO ip_blacklist (ip_address, reason) VALUES (?, ?)", (ip, reason))
        await db.commit()
    except:
        await db.close()
        raise HTTPException(409, "IP already blacklisted")
    await db.close()
    return {"message": f"IP {ip} blacklisted"}

@app.delete("/api/admin/ip-blacklist/{entry_id}")
async def remove_from_blacklist(entry_id: int, user: dict = Depends(check_superadmin)):
    db = await get_db()
    await db.execute("DELETE FROM ip_blacklist WHERE id = ?", (entry_id,))
    await db.commit()
    await db.close()
    return {"message": "IP removed from blacklist"}

# ─── Admin Audit Log APIs ─────────────────────────────────────────────────

@app.get("/api/admin/audit-logs")
async def get_audit_logs(page: int = 1, limit: int = 50, user: dict = Depends(check_superadmin)):
    db = await get_db()
    offset = (page - 1) * limit
    rows = await db.execute("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset))
    data = await rows.fetchall()
    count_row = await db.execute("SELECT COUNT(*) as c FROM audit_logs")
    total = (await count_row.fetchone())["c"]
    await db.close()
    return {"logs": [dict(r) for r in data], "total": total, "page": page, "limit": limit}

@app.delete("/api/admin/audit-logs/clear")
async def clear_audit_logs(user: dict = Depends(check_superadmin)):
    db = await get_db()
    await db.execute("DELETE FROM audit_logs")
    await db.commit()
    await db.close()
    return {"message": "Audit logs cleared"}

# ─── Admin Backup APIs ─────────────────────────────────────────────────────

BACKUP_DIR = os.path.join(os.path.dirname(__file__), "data", "backups")

@app.post("/api/admin/backup/create")
async def create_backup(user: dict = Depends(check_superadmin)):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(BACKUP_DIR, f"backup_{timestamp}.db")
    src = os.path.join(os.path.dirname(__file__), "data", "app.db")
    if not os.path.exists(src):
        raise HTTPException(404, "No database found")
    import shutil
    shutil.copy2(src, backup_path)
    return {"message": "Backup created", "file": f"backup_{timestamp}.db"}

@app.get("/api/admin/backup/list")
async def list_backups(user: dict = Depends(check_superadmin)):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    files = []
    for f in os.listdir(BACKUP_DIR):
        if f.endswith(".db"):
            path = os.path.join(BACKUP_DIR, f)
            files.append({"name": f, "size": os.path.getsize(path), "created": datetime.datetime.fromtimestamp(os.path.getmtime(path)).isoformat()})
    files.sort(key=lambda x: x["created"], reverse=True)
    return {"backups": files}

@app.post("/api/admin/backup/restore/{backup_file}")
async def restore_backup(backup_file: str, user: dict = Depends(check_superadmin)):
    backup_path = os.path.join(BACKUP_DIR, backup_file)
    if not os.path.exists(backup_path):
        raise HTTPException(404, "Backup file not found")
    src = os.path.join(os.path.dirname(__file__), "data", "app.db")
    import shutil
    shutil.copy2(backup_path, src)
    await init_db()
    return {"message": "Backup restored"}

@app.get("/api/admin/backup/download/{backup_file}")
async def download_backup(backup_file: str, user: dict = Depends(check_superadmin)):
    backup_path = os.path.join(BACKUP_DIR, backup_file)
    if not os.path.exists(backup_path):
        raise HTTPException(404, "Backup file not found")
    def iterfile():
        with open(backup_path, "rb") as f:
            yield from f
    return StreamingResponse(iterfile(), media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={backup_file}"})

@app.delete("/api/admin/backup/{backup_file}")
async def delete_backup(backup_file: str, user: dict = Depends(check_superadmin)):
    backup_path = os.path.join(BACKUP_DIR, backup_file)
    if not os.path.exists(backup_path):
        raise HTTPException(404, "Backup file not found")
    os.remove(backup_path)
    return {"message": "Backup deleted"}

# ─── Webhook (callback from GitHub Actions) ───────────────────────────────

WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "webapk-secret-2024")

@app.post("/api/webhook/build-status")
async def build_status_webhook(data: dict, request: Request):
    secret = request.headers.get("X-Webhook-Secret", "")
    if secret != WEBHOOK_SECRET:
        raise HTTPException(401, "Invalid secret")

    build_id = data.get("build_id", "")
    status = data.get("status", "")
    error_log = data.get("error", "")
    duration = data.get("duration")

    if not build_id or not status:
        raise HTTPException(400, "build_id and status required")

    db = await get_db()
    if status == "building":
        await db.execute("UPDATE builds SET status = 'building' WHERE id = ?", (build_id,))
    elif status == "completed":
        await db.execute(
            "UPDATE builds SET status = 'completed', completed_at = CURRENT_TIMESTAMP, build_duration = ? WHERE id = ?",
            (duration, build_id)
        )
    elif status == "failed":
        await db.execute(
            "UPDATE builds SET status = 'failed', error_log = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (error_log, build_id)
        )
    await db.commit()
    await db.close()
    return {"message": "Status updated"}

# ─── Health ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
