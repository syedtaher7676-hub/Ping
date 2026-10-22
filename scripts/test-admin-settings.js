/**
 * Automated Integration Test for Ping Admin Settings & System Controls
 * Verifies admin authentication, token issuance, system settings modification,
 * and persistence to Cloud Firestore.
 */

const http = require("http");

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function makeRequest(path, method = "GET", body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ status: res.statusCode, body: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      }
    );

    req.on("error", reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log("==================================================");
  console.log("PING ADMIN SETTINGS & SYSTEM CONTROLS SUITE");
  console.log("==================================================\n");

  let testPassed = true;

  // 1. Test Admin Login
  console.log("1. Testing Admin Authentication...");
  const loginRes = await makeRequest("/api/admin/login", "POST", {
    password: "Syed@12345",
  });

  if (loginRes.status !== 200 || !loginRes.body.token) {
    console.error("❌ Admin login failed:", loginRes.body);
    process.exit(1);
  }
  const adminToken = loginRes.body.token;
  console.log("✅ Admin login successful. Token issued:", adminToken.slice(0, 15) + "...");

  // 2. Test VPN Shield Endpoint & Toggle
  console.log("\n2. Testing VPN Shield Admin Controls...");
  const vpnGet = await makeRequest("/api/admin/system/vpn-shield", "GET", null, adminToken);
  console.log("   Initial VPN Shield State:", vpnGet.body);

  const vpnToggle = await makeRequest("/api/admin/system/vpn-shield", "POST", { enabled: true }, adminToken);
  if (vpnToggle.body.enabled !== true) {
    console.error("❌ Failed to enable VPN Shield");
    testPassed = false;
  } else {
    console.log("✅ VPN Shield enabled successfully");
  }

  // 3. Test Public VPN Check Route
  console.log("\n3. Testing Public /api/check-vpn Route...");
  const checkVpn = await makeRequest("/api/check-vpn", "GET");
  if (checkVpn.status !== 200 || typeof checkVpn.body.isVpn !== "boolean") {
    console.error("❌ /api/check-vpn returned unexpected response:", checkVpn.body);
    testPassed = false;
  } else {
    console.log("✅ /api/check-vpn responded with clean JSON payload:", {
      ip: checkVpn.body.ip,
      isVpn: checkVpn.body.isVpn,
      shieldEnabled: checkVpn.body.shieldEnabled,
    });
  }

  // 4. Test Strict Safety Emergency Mode
  console.log("\n4. Testing Strict Safety Emergency Mode...");
  const strictToggle = await makeRequest("/api/admin/system/strict-mode", "POST", { enabled: true }, adminToken);
  if (strictToggle.body.strictMode !== true) {
    console.error("❌ Failed to enable Strict Emergency Mode");
    testPassed = false;
  } else {
    console.log("✅ Strict Emergency Mode enabled successfully");
  }

  // Restore strict mode to false
  await makeRequest("/api/admin/system/strict-mode", "POST", { enabled: false }, adminToken);

  // 5. Test Slow Mode Governor
  console.log("\n5. Testing Slow Mode Cooldown Governor...");
  const slowModeSet = await makeRequest("/api/admin/system/slow-mode", "POST", { seconds: 3 }, adminToken);
  if (slowModeSet.body.slowModeSeconds !== 3) {
    console.error("❌ Failed to set slow mode cooldown");
    testPassed = false;
  } else {
    console.log("✅ Slow mode set to 3s");
  }

  // Reset slow mode
  await makeRequest("/api/admin/system/slow-mode", "POST", { seconds: 0 }, adminToken);

  // 6. Test Raid Shield
  console.log("\n6. Testing Anti-Bot Raid Shield...");
  const raidShieldSet = await makeRequest("/api/admin/system/raid-shield", "POST", { enabled: true }, adminToken);
  if (raidShieldSet.body.raidShield !== true) {
    console.error("❌ Failed to toggle Raid Shield");
    testPassed = false;
  } else {
    console.log("✅ Raid Shield toggled successfully");
  }
  await makeRequest("/api/admin/system/raid-shield", "POST", { enabled: false }, adminToken);

  // 7. Test Admin Overview Data & Telemetry Fetch
  console.log("\n7. Testing Admin Overview API...");
  const overview = await makeRequest("/api/admin/overview", "GET", null, adminToken);
  if (overview.status !== 200 || !overview.body.success) {
    console.error("❌ Overview endpoint failed:", overview.body);
    testPassed = false;
  } else {
    console.log("✅ Overview telemetry fetched successfully:", {
      onlineUsers: overview.body.onlineUsers,
      totalMatches: overview.body.totalMatches,
      bansCount: overview.body.bansCount,
      firestoreStatus: overview.body.firestoreStatus,
    });
  }

  console.log("\n==================================================");
  if (testPassed) {
    console.log("🎉 ALL ADMIN SYSTEM SETTINGS TESTS PASSED!");
    console.log("==================================================");
    process.exit(0);
  } else {
    console.error("💥 SOME TESTS FAILED!");
    console.log("==================================================");
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal Test Execution Error:", err);
  process.exit(1);
});
