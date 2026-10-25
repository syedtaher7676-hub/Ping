/**
 * ==============================================================================
 * PING: Software Architecture Root Directory Catalog (src/index.js)
 * ==============================================================================
 * Central linking registry categorizing the entire software architecture:
 * - backend: Core business services, real-time socket layer, state stores, data models, utils
 * - frontend: Client SPA views, app scripts, stylesheets, PWA service workers, static branding assets
 * - server: Node.js / Express server bootstrap
 * ==============================================================================
 */

const backend = require("./backend");
const frontend = require("./frontend");
const server = require("./server");

module.exports = {
  backend,
  frontend,
  server,
};
