function log(event, details = {}) {
  const timestamp = new Date().toISOString();
  console.log(
    JSON.stringify({
      timestamp,
      event,
      ...details,
    })
  );
}

module.exports = {
  log,
};
