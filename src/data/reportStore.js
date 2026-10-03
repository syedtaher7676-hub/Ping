// Report storage - IN-MEMORY with Disk Persistence & Training Dataset Ingestion
const fs = require('fs');
const path = require('path');
const { recordChatSampleForTraining } = require('../services/modelTrainer');

const REPORTS_FILE = path.join(__dirname, '../../data/reports.json');

const reports = [];
const MAX_REPORTS = 1000;

// Hydrate from disk if available
try {
  if (fs.existsSync(REPORTS_FILE)) {
    const raw = fs.readFileSync(REPORTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      reports.push(...parsed.slice(-MAX_REPORTS));
    }
  }
} catch (_) {}

function saveReportsToFile() {
  try {
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2), 'utf8');
  } catch (_) {}
}

function addReport(report) {
  const newReport = {
    id: "rpt_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
    ...report,
    createdAt: Date.now(),
  };
  reports.push(newReport);

  // Keep only last 1000 reports
  if (reports.length > MAX_REPORTS) {
    reports.splice(0, reports.length - MAX_REPORTS);
  }

  saveReportsToFile();

  // Ingest reported message content into model training dataset
  const reportedText = report.message || report.text || report.reason;
  if (reportedText && typeof reportedText === 'string') {
    recordChatSampleForTraining(reportedText, 1, 'user_report_violation', {
      reportId: newReport.id,
      reportedUserId: report.reportedUserId
    });
  }

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
