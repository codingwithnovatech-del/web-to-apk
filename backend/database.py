import aiosqlite
import os
import bcrypt

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "app.db")

async def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db

async def init_db():
    db = await get_db()
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'admin',
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP,
            rate_limit INTEGER DEFAULT 10
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            key TEXT UNIQUE NOT NULL,
            name TEXT,
            permissions TEXT DEFAULT 'read',
            last_used TIMESTAMP,
            usage_count INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS builds (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            app_name TEXT NOT NULL,
            status TEXT DEFAULT 'queued',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP,
            user_ip TEXT,
            user_id INTEGER REFERENCES users(id),
            api_key_id INTEGER REFERENCES api_keys(id),
            file_size INTEGER,
            error_log TEXT,
            build_duration INTEGER
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            action TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ip_blacklist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip_address TEXT UNIQUE NOT NULL,
            reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    # Create default admin if no users exist
    cursor = await db.execute("SELECT COUNT(*) as c FROM users")
    row = await cursor.fetchone()
    if row["c"] == 0:
        admin_user = os.getenv("ADMIN_USERNAME", "admin")
        admin_pass = os.getenv("ADMIN_PASSWORD", "admin123")
        hashed = bcrypt.hashpw(admin_pass.encode(), bcrypt.gensalt()).decode()
        await db.execute(
            "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)",
            (admin_user, "admin@webapk.local", hashed, "superadmin")
        )

    await db.commit()
    await db.close()
