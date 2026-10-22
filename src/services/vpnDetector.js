/**
 * ─────────────────────────────────────────────────────────────
 * VPN, Proxy, and Tor Detection Engine for Ping
 * ─────────────────────────────────────────────────────────────
 * Multi-layer detection:
 *  1. Header inspection (Tor T1 headers, proxy headers)
 *  2. Datacenter, hosting provider, and VPN ASN/ISP heuristics
 *  3. External IP intelligence with in-memory LRU caching
 *  4. Client-side Timezone vs IP Geolocation mismatch heuristics
 */

const https = require("https");
const http = require("http");

// Fast in-memory cache for IP lookups (10,000 entries max, 24-hour TTL)
const ipCache = new Map();
const MAX_CACHE_SIZE = 10000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Global setting for enforcing VPN blocking (default: true)
let vpnShieldEnabled = true;

// Known VPN / Datacenter ASN, ISP, and Organization keywords
const DATACENTER_OR_VPN_KEYWORDS = [
  "vpn",
  "proxy",
  "hosting",
  "datacenter",
  "data center",
  "cloud",
  "m247",
  "ovh",
  "hetzner",
  "digitalocean",
  "digital ocean",
  "linode",
  "vultr",
  "choopa",
  "leaseweb",
  "packethub",
  "datacamp",
  "kamatera",
  "scaleway",
  "contabo",
  "cogent",
  "amazon",
  "aws",
  "google cloud",
  "microsoft azure",
  "oracle cloud",
  "alibaba",
  "tencent",
  "nordvpn",
  "expressvpn",
  "surfshark",
  "mullvad",
  "protonvpn",
  "proton ag",
  "windscribe",
  "private internet access",
  "cyberghost",
  "ipvanish",
  "tunnelbear",
  "purevpn",
  "tor-exit",
  "shadowsocks",
  "wireguard",
];

/**
 * Checks if an IP is local, loopback, or private RFC1918
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateOrLocalIp(ip) {
  if (!ip) return true;
  const cleanIp = ip.replace(/^::ffff:/, "").trim();
  if (
    cleanIp === "127.0.0.1" ||
    cleanIp === "::1" ||
    cleanIp === "localhost" ||
    cleanIp === "0.0.0.0"
  ) {
    return true;
  }
  // 10.0.0.0/8
  if (/^10\./.test(cleanIp)) return true;
  // 172.16.0.0/12
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(cleanIp)) return true;
  // 192.168.0.0/16
  if (/^192\.168\./.test(cleanIp)) return true;
  // 169.254.0.0/16 (link-local)
  if (/^169\.254\./.test(cleanIp)) return true;
  return false;
}

/**
 * Extracts normalized IP address from Socket.IO handshake or Express request headers
 * @param {object} headers
 * @param {string} [remoteAddress]
 * @returns {string}
 */
function extractClientIp(headers = {}, remoteAddress = "") {
  let rawIp =
    headers["cf-connecting-ip"] ||
    headers["x-real-ip"] ||
    headers["x-client-ip"] ||
    headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    headers["x-forwarded-ip"] ||
    remoteAddress ||
    "127.0.0.1";

  // Strip IPv6-mapped IPv4 prefix
  return rawIp.replace(/^::ffff:/, "").trim();
}

/**
 * Checks suspicious HTTP headers that indicate proxies or Tor exit nodes
 * @param {object} headers
 * @returns {{ isSuspicious: boolean, reason?: string }}
 */
function checkProxyHeaders(headers = {}) {
  // Cloudflare Tor country indicator
  if (headers["cf-ipcountry"] && headers["cf-ipcountry"].toUpperCase() === "T1") {
    return { isSuspicious: true, reason: "Tor exit node network detected (Cloudflare T1)" };
  }
  // Standard proxy headers
  if (headers["via"] || headers["x-proxy-id"] || headers["proxy-connection"]) {
    return { isSuspicious: true, reason: "HTTP Proxy headers detected" };
  }
  return { isSuspicious: false };
}

/**
 * Fetches IP intelligence with timeout and caching
 * @param {string} ip
 * @returns {Promise<object>}
 */
async function lookupIpIntelligence(ip) {
  if (isPrivateOrLocalIp(ip)) {
    return {
      ip,
      isLocal: true,
      proxy: false,
      hosting: false,
      country: "Localhost",
      isp: "Local Loopback",
      org: "Local Network",
    };
  }

  // Check in-memory cache
  const cached = ipCache.get(ip);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  return new Promise((resolve) => {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,region,city,timezone,isp,org,as,proxy,hosting,query`;

    const req = http.get(url, { timeout: 1800 }, (res) => {
      let rawData = "";
      res.on("data", (chunk) => (rawData += chunk));
      res.on("end", () => {
        try {
          const data = JSON.parse(rawData);
          if (data && data.status === "success") {
            // Cache successful lookup
            if (ipCache.size >= MAX_CACHE_SIZE) {
              const firstKey = ipCache.keys().next().value;
              ipCache.delete(firstKey);
            }
            ipCache.set(ip, { timestamp: Date.now(), data });
            resolve(data);
          } else {
            resolve({ ip, failed: true, reason: data?.message || "Lookup failed" });
          }
        } catch (_) {
          resolve({ ip, failed: true });
        }
      });
    });

    req.on("error", () => resolve({ ip, failed: true }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ip, failed: true, timeout: true });
    });
  });
}

/**
 * Analyzes whether an IP and client metadata indicate VPN / Proxy / Datacenter usage
 *
 * @param {string} ip
 * @param {object} [clientMeta]
 * @param {string} [clientMeta.timezone] - Client browser timezone from Intl API
 * @param {object} [clientMeta.headers] - HTTP headers
 * @returns {Promise<{ isVpn: boolean, provider?: string, reason?: string, details?: object }>}
 */
async function detectVpn(ip, clientMeta = {}) {
  // 1. Localhost / Private IPs are always allowed
  if (isPrivateOrLocalIp(ip)) {
    return {
      isVpn: false,
      reason: "Localhost / Internal Development Address",
      details: { ip, isLocal: true },
    };
  }

  // 2. Check HTTP proxy / Tor headers
  if (clientMeta.headers) {
    const headerCheck = checkProxyHeaders(clientMeta.headers);
    if (headerCheck.isSuspicious) {
      return {
        isVpn: true,
        provider: "Proxy/Tor Header",
        reason: headerCheck.reason,
        details: { ip, headerFlag: true },
      };
    }
  }

  // 3. Query IP intelligence
  const info = await lookupIpIntelligence(ip);

  if (info && !info.failed) {
    const ispLower = (info.isp || "").toLowerCase();
    const orgLower = (info.org || "").toLowerCase();
    const asLower = (info.as || "").toLowerCase();

    // Check direct proxy / hosting flags from intelligence database
    if (info.proxy === true) {
      return {
        isVpn: true,
        provider: info.org || info.isp || "Proxy",
        reason: "Commercial Proxy or VPN connection detected",
        details: { ip, country: info.country, isp: info.isp, org: info.org, as: info.as },
      };
    }

    if (info.hosting === true) {
      return {
        isVpn: true,
        provider: info.org || info.isp || "Datacenter Host",
        reason: "Datacenter / Cloud hosting IP detected (non-residential network)",
        details: { ip, country: info.country, isp: info.isp, org: info.org, as: info.as },
      };
    }

    // Keyword match on ISP / Org / ASN
    const matchKeyword = DATACENTER_OR_VPN_KEYWORDS.find(
      (kw) => ispLower.includes(kw) || orgLower.includes(kw) || asLower.includes(kw)
    );

    if (matchKeyword) {
      return {
        isVpn: true,
        provider: info.org || info.isp || matchKeyword,
        reason: `Associated with VPN/Hosting provider (${matchKeyword})`,
        details: { ip, country: info.country, isp: info.isp, org: info.org, as: info.as },
      };
    }

    // 4. Timezone Divergence Check (Client browser reported vs IP geolocation)
    if (clientMeta.timezone && info.timezone) {
      const clientTz = String(clientMeta.timezone).trim().toLowerCase();
      const ipTz = String(info.timezone).trim().toLowerCase();

      // Check continent or primary zone mismatch (e.g. client is in Asia, IP is in America)
      const clientRegion = clientTz.split("/")[0];
      const ipRegion = ipTz.split("/")[0];

      if (
        clientRegion &&
        ipRegion &&
        clientRegion !== ipRegion &&
        clientRegion !== "etc" &&
        ipRegion !== "etc" &&
        !isPrivateOrLocalIp(ip)
      ) {
        // High confidence mismatch
        return {
          isVpn: true,
          provider: `${info.isp || "VPN"} (Location Tunnel)`,
          reason: `Timezone geographic mismatch (Device: ${clientMeta.timezone}, IP: ${info.timezone})`,
          details: { ip, clientTimezone: clientMeta.timezone, ipTimezone: info.timezone },
        };
      }
    }

    return {
      isVpn: false,
      reason: "Residential / Verified Direct Connection",
      details: { ip, country: info.country, isp: info.isp },
    };
  }

  // Fallback: If intelligence API timed out or is unavailable, fail-open to avoid blocking innocent users
  return {
    isVpn: false,
    reason: "Direct Connection (Unverified)",
    details: { ip },
  };
}

/**
 * Gets or sets the VPN Shield enforcement status
 */
function isVpnShieldEnabled() {
  return vpnShieldEnabled;
}

function setVpnShieldEnabled(enabled) {
  vpnShieldEnabled = Boolean(enabled);
  return vpnShieldEnabled;
}

module.exports = {
  detectVpn,
  extractClientIp,
  isPrivateOrLocalIp,
  isVpnShieldEnabled,
  setVpnShieldEnabled,
  lookupIpIntelligence,
};
