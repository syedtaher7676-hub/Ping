const { randomUUID } = require("crypto");

function createId(prefix = "") {
  const id = randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

module.exports = {
  createId,
};
