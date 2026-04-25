// Report storage - IN-MEMORY (for ephemeral file systems like Render free tier)
const reports = [];

function addReport(report) {
  const newReport = {
    id: "rpt_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
    ...report,
    createdAt: Date.now(),
  };
  reports.push(newReport);
  return newReport;
}

function getReports(limit = 100) {
  return reports.slice(-limit);
}

function getReportsByUser(userId, limit = 50) {
  return reports.filter(r => r.reporterId === userId || r.reportedUserId === userId).slice(-limit);
}

module.exports = {
  addReport,
  getReports,
  getReportsByUser,
};