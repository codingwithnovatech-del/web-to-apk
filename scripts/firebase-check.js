const admin = require("firebase-admin");

async function main() {
  const deviceId = process.env.INPUT_DEVICE_ID || "unknown";
  const buildId = process.env.INPUT_BUILD_ID || "unknown";

  // Allow build if Firebase is not configured
  const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!svcJson) {
    console.log("build_allowed=true");
    console.log("tier=free");
    console.log("branding=false");
    return;
  }

  let svc;
  try { svc = JSON.parse(svcJson); } catch {
    console.log("build_allowed=true");
    console.log("tier=free");
    console.log("branding=false");
    return;
  }

  admin.initializeApp({ credential: admin.credential.cert(svc) });
  const db = admin.firestore();

  const settingsDoc = await db.collection("settings").doc("default").get();
  const settings = settingsDoc.data() || { daily_limit: 3, branding_enabled: true };

  const userRef = db.collection("users").doc(deviceId);
  const userDoc = await userRef.get();
  const today = new Date().toISOString().slice(0, 10);

  if (!userDoc.exists) {
    await userRef.set({
      device_id: deviceId, tier: "free", builds_today: 1,
      last_build_date: today, banned: false,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log("build_allowed=true");
    console.log("tier=free");
    console.log(`branding=${settings.branding_enabled}`);
    return;
  }

  const data = userDoc.data();
  if (data.banned) {
    console.log("build_allowed=false");
    console.log("reason=banned");
    return;
  }

  if (data.tier === "paid") {
    await safeUpdate(userRef, { builds_today: admin.firestore.FieldValue.increment(1), last_build_date: today });
    console.log("build_allowed=true");
    console.log("tier=paid");
    console.log("branding=false");
    return;
  }

  if (data.last_build_date !== today) {
    await safeUpdate(userRef, { builds_today: 1, last_build_date: today });
    console.log("build_allowed=true");
    console.log("tier=free");
    console.log(`branding=${settings.branding_enabled}`);
    return;
  }

  const limit = settings.daily_limit || 3;
  if (data.builds_today >= limit) {
    console.log("build_allowed=false");
    console.log("reason=limit_reached");
    console.log(`limit=${limit}`);
    return;
  }

  await safeUpdate(userRef, { builds_today: admin.firestore.FieldValue.increment(1) });
  console.log("build_allowed=true");
  console.log("tier=free");
  console.log(`branding=${settings.branding_enabled}`);
}

async function safeUpdate(ref, data) {
  try { await ref.update(data); } catch { await ref.set(data, { merge: true }); }
}

main().catch(e => {
  console.log("build_allowed=true");
  console.log("tier=free");
  console.log("branding=false");
});
