// Data storage exports
const userStore = require("./userStore");
const reportStore = require("./reportStore");
const spamStore = require("./spamStore");
const slurFilter = require("./slurFilter");
const securityStore = require("./securityStore");
const moderation = require("./moderation");

module.exports = {
  userStore,
  reportStore,
  spamStore,
  slurFilter,
  securityStore,
  moderation,
};