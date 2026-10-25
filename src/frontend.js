/**
 * ==============================================================================
 * PING: Unified Frontend Subsystem Index (src/frontend.js)
 * ==============================================================================
 * Maps, categorizes, and provides path references and manifest definitions
 * for all client-side Single Page Application (SPA) frontend assets.
 * ==============================================================================
 */

const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "../public");

module.exports = {
  publicDir: PUBLIC_DIR,

  // Category 1: Client Application Scripts
  scripts: {
    app: path.join(PUBLIC_DIR, "app.js"),
    admin: path.join(PUBLIC_DIR, "admin.js"),
    animations: path.join(PUBLIC_DIR, "animations.js"),
    firebaseClient: path.join(PUBLIC_DIR, "firebase-client.js"),
    serviceWorker: path.join(PUBLIC_DIR, "sw.js"),
    chart: path.join(PUBLIC_DIR, "chart.umd.js"),
  },

  // Category 2: Styling & Animations
  styles: {
    main: path.join(PUBLIC_DIR, "styles.css"),
    animations: path.join(PUBLIC_DIR, "animations.css"),
  },

  // Category 3: HTML Views & Modals
  views: {
    index: path.join(PUBLIC_DIR, "index.html"),
    privacy: path.join(PUBLIC_DIR, "privacy.html"),
    terms: path.join(PUBLIC_DIR, "terms.html"),
    safety: path.join(PUBLIC_DIR, "safety.html"),
    notFound: path.join(PUBLIC_DIR, "404.html"),
  },

  // Category 4: App Manifest & Icons
  manifest: {
    manifestJson: path.join(PUBLIC_DIR, "manifest.json"),
    favicon: path.join(PUBLIC_DIR, "favicon.png"),
    logoSvg: path.join(PUBLIC_DIR, "logo.svg"),
    logoPng: path.join(PUBLIC_DIR, "logo.png"),
    logoMark: path.join(PUBLIC_DIR, "logo-mark.svg"),
    iconSvg: path.join(PUBLIC_DIR, "icon.svg"),
    appleTouchIcon: path.join(PUBLIC_DIR, "apple-touch-icon.png"),
    pwa192: path.join(PUBLIC_DIR, "pwa-192x192.png"),
    pwa512: path.join(PUBLIC_DIR, "pwa-512x512.png"),
    pwaMaskable: path.join(PUBLIC_DIR, "pwa-maskable-512x512.png"),
  },
};
