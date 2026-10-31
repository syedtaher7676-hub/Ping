// Report storage - IN-MEMORY with Asynchronous Debounced Disk Persistence & Training Dataset Ingestion
const fs = require('fs');
const path = require('path');
const { recordChatSampleForTraining } = require('../services/modelTrainer');

const REPORTS_FILE = path.join(__dirname, '../../data/reports.json');

const reports = [];
const MAX_REPORTS = 1000;

// Hydrate from disk if available at startup
try {
  if (fs.existsSync(REPORTS_FILE)) {
    const raw = fs.readFileSync(REPORTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      reports.push(...parsed.slice(-MAX_REPORTS));
    }
  }
} catch (_) {}

// Non-blocking debounced file persistence (prevents event loop lag under 10k CCU)
let saveTimeout = null;
let isSaving = false;

function saveReportsToFile() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    if (isSaving) return;
    isSaving = true;
    try {
      await fs.promises.writeFile(REPORTS_FILE, JSON.stringify(reports, null, 2), 'utf8');
    } catch (_) {
      // Non-blocking fail-open
    } finally {
      isSaving = false;
    }
  }, 1000);
  if (typeof saveTimeout.unref === 'function') {
    saveTimeout.unref();
  }
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

  // Persist to Cloud Firestore
  try {
    const dbService = require('../services/dbService');
    if (typeof dbService.saveReport === 'function') {
      dbService.saveReport({
        reportId: newReport.id,
        reporterId: newReport.reporterId,
        reporterCountry: newReport.reporterCountry || 'Unknown',
        reportedUserId: newReport.reportedUserId,
        reportedUserCountry: newReport.reportedUserCountry || 'Unknown',
        roomId: newReport.roomId || '',
        reason: newReport.reason || 'user_reported',
        flags: newReport.flags || [],
        status: newReport.status || 'pending_review',
      }).catch(() => {});
    }
  } catch (_) {}

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

// Hydrate from Firestore if available
(async () => {
  try {
    const dbService = require('../services/dbService');
    if (typeof dbService.getRecentReports === 'function') {
      const remoteReports = await dbService.getRecentReports(100);
      if (Array.isArray(remoteReports) && remoteReports.length > 0) {
        for (const r of remoteReports) {
          const id = r.reportId || r.id;
          if (id && !reports.some(existing => existing.id === id || existing.reportId === id)) {
            reports.push({
              id,
              ...r,
              createdAt: r.createdAt ? (typeof r.createdAt === 'string' ? new Date(r.createdAt).getTime() : r.createdAt) : Date.now(),
            });
          }
        }
      }
    }
  } catch (_) {}
})();

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
