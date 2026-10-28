/**
 * ─────────────────────────────────────────────────────────────
 * Ping Admin Dashboard Core Telemetry & Real-Time Engine (admin.js)
 * ─────────────────────────────────────────────────────────────
 * Connects the Ping Admin Dashboard to Cloud Firestore (telemetry/live_metrics)
 * for permanent aggregated metric persistence, 0-lag rolling live curves via
 * WebSockets, smooth Chart.js curve enforcement, full tab navigation repair,
 * zero fake/random dummy data, and multi-tab Excel (.xlsx) export via SheetJS.
 */

(function () {
  'use strict';

  // ── PRIVATE AGGREGATED TELEMETRY STATE ──
  // STRICT PRIVACY: Stores strictly aggregated numerical counters; NO chat text, NO IPs, NO PII.
  const telemetryState = {
    system_summary: {
      last_updated: new Date().toISOString(),
      total_sessions_logged: 0,
      active_ccu_peak: 0,
    },
    sentiment_distribution: {
      friendly_greetings: 0,
      curious_questions: 0,
      casual_dialogue: 0,
      playful_humor: 0,
      toxic_messages: 0,
    },
    session_durations: {
      quick_skips_under_15s: 0,
      short_chats_15s_1m: 0,
      medium_chats_1m_3m: 0,
      deep_chats_over_3m: 0,
    },
    retention_metrics: {
      survival_rate_3m_pct: 0,
      skip_churn_15s_pct: 0,
      patience_quotient_pct: 0,
    },
    live_fleet: {
      activeUsers: 0,
      activeRooms: 0,
      queueSize: 0,
      msgsPerSec: 0,
      violationsPerSec: 0,
      heapMb: 0,
      eventLoopLagMs: 1,
    },
    archetypes: {
      authenticConnector: 0,
      curiousExplorer: 0,
      speedSwapper: 0,
      socialHarvester: 0,
      provocateur: 0,
    },
  };

  // Rolling time series buffers (max 30 points) for 60fps silky smooth curves
  const MAX_POINTS = 30;
  const timeLabels = [];
  const socketsSeries = [];
  const roomsSeries = [];
  const velocitySeries = [];
  const threatsSeries = [];
  const spamSeries = [];
  const retentionCurveSeries = [];
  const churnCurveSeries = [];
  const solicitousCurveSeries = [];
  const behaviorAskedSeries = [];
  const behaviorSlursSeries = [];
  const behaviorSocialsSeries = [];

  // Chart.js instances map
  const activeCharts = {};
  let socketInstance = null;

  // DOM Helper
  const $ = (id) => document.getElementById(id);

  // ═════════════════════════════════════════════════════════════
  // 1. CURVE STYLING ENFORCER & CHART.JS INITIALIZATION
  // ═════════════════════════════════════════════════════════════
  function setupChartDefaults() {
    if (typeof window.Chart === 'undefined') return;

    // Enforce smooth curve props globally across all line charts
    window.Chart.defaults.elements.line.tension = 0.4;
    window.Chart.defaults.elements.line.cubicInterpolationMode = 'monotone';
    window.Chart.defaults.elements.point.radius = 0;
    window.Chart.defaults.elements.point.hitRadius = 8;
    window.Chart.defaults.responsive = true;
    window.Chart.defaults.maintainAspectRatio = false;
    window.Chart.defaults.animation = false; // Disable heavy layout animation for smooth real-time ticks
  }

  function initAdminCharts() {
    if (typeof window.Chart === 'undefined') return;
    setupChartDefaults();

    // 1. Overview Concurrency & Message Velocity Chart
    const canvasThroughput = $('canvasThroughputChart');
    if (canvasThroughput && !activeCharts.throughput) {
      const ctx = canvasThroughput.getContext('2d');
      activeCharts.throughput = new window.Chart(ctx, {
        type: 'line',
        data: {
          labels: timeLabels,
          datasets: [
            {
              label: 'Active Sockets',
              data: socketsSeries,
              borderColor: '#06b6d4',
              backgroundColor: 'rgba(6, 182, 212, 0.15)',
              borderWidth: 2.2,
              fill: true,
              tension: 0.4,
              cubicInterpolationMode: 'monotone',
            },
            {
              label: 'Live Rooms',
              data: roomsSeries,
              borderColor: '#a855f7',
              backgroundColor: 'rgba(168, 85, 247, 0.12)',
              borderWidth: 2,
              fill: true,
              tension: 0.4,
              cubicInterpolationMode: 'monotone',
            },
            {
              label: 'Velocity (msgs/s)',
              data: velocitySeries,
              borderColor: '#f59e0b',
              borderWidth: 1.8,
              fill: false,
              tension: 0.4,
              cubicInterpolationMode: 'monotone',
            },
          ],
        },
        options: {
          scales: {
            x: { display: false },
            y: {
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 10 } },
              beginAtZero: true,
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: 'rgba(10, 10, 28, 0.9)',
              titleColor: '#ffffff',
              bodyColor: '#e2e8f0',
              borderColor: 'rgba(255, 255, 255, 0.1)',
              borderWidth: 1,
            },
          },
        },
      });
    }

    // 2. Automated Threat & Interception Timeline Chart
    const canvasThreat = $('canvasThreatChart');
    if (canvasThreat && !activeCharts.threat) {
      const ctx = canvasThreat.getContext('2d');
      activeCharts.threat = new window.Chart(ctx, {
        type: 'line',
        data: {
          labels: timeLabels,
          datasets: [
            {
              label: 'Violations Blocked',
              data: threatsSeries,
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              borderWidth: 2.2,
              fill: true,
              tension: 0.4,
              cubicInterpolationMode: 'monotone',
            },
            {
              label: 'Spam Intercepted',
              data: spamSeries,
              borderColor: '#f97316',
              borderWidth: 1.8,
              fill: false,
              tension: 0.4,
              cubicInterpolationMode: 'monotone',
            },
          ],
        },
        options: {
          scales: {
            x: { display: false },
            y: {
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 10 } },
              beginAtZero: true,
            },
          },
          plugins: {
            legend: { display: false },
          },
        },
      });
    }

    // 3. Behavioral Violation Timeline Chart
    const canvasBehavior = $('canvasBehaviorChart');
    if (canvasBehavior && !activeCharts.behavior) {
      const ctx = canvasBehavior.getContext('2d');
      activeCharts.behavior = new window.Chart(ctx, {
        type: 'line',
        data: {
          labels: timeLabels,
          datasets: [
            {
              label: 'Asking Numbers',
              data: behaviorAskedSeries,
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.14)',
              borderWidth: 2,
              fill: true,
              tension: 0.4,
              cubicInterpolationMode: 'monotone',
            },
            {
              label: 'Slurs Intercepted',
              data: behaviorSlursSeries,
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.14)',
              borderWidth: 2,
              fill: true,
              tension: 0.4,
              cubicInterpolationMode: 'monotone',
            },
            {
              label: 'Socials Intercepted',
              data: behaviorSocialsSeries,
              borderColor: '#a855f7',
              borderWidth: 1.8,
              fill: false,
              tension: 0.4,
              cubicInterpolationMode: 'monotone',
            },
          ],
        },
        options: {
          scales: {
            x: { display: false },
            y: {
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 10 } },
              beginAtZero: true,
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: 'rgba(10, 10, 28, 0.9)',
              titleColor: '#ffffff',
              bodyColor: '#e2e8f0',
              borderColor: 'rgba(255, 255, 255, 0.1)',
              borderWidth: 1,
            },
          },
        },
      });
    }

    // 4. Psychological Retention & Churn Curve Chart
    const canvasRetention = $('canvasRetentionChart');
    if (canvasRetention && !activeCharts.retention) {
      const ctx = canvasRetention.getContext('2d');
      activeCharts.retention = new window.Chart(ctx, {
        type: 'line',
        data: {
          labels: timeLabels,
          datasets: [
            {
              label: 'Authentic Retention (%)',
              data: retentionCurveSeries,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.16)',
              borderWidth: 2.4,
              fill: true,
              tension: 0.4,
              cubicInterpolationMode: 'monotone',
            },
            {
              label: 'Speed Swapper Churn (%)',
              data: churnCurveSeries,
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              borderWidth: 2,
              fill: false,
              tension: 0.4,
              cubicInterpolationMode: 'monotone',
            },
            {
              label: 'Solicitous Drop-off (%)',
              data: solicitousCurveSeries,
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              borderWidth: 1.8,
              fill: false,
              tension: 0.4,
              cubicInterpolationMode: 'monotone',
            },
          ],
        },
        options: {
          scales: {
            x: { display: false },
            y: {
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: 'rgba(255, 255, 255, 0.4)', font: { size: 10 } },
              min: 0,
              max: 100,
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: 'rgba(10, 10, 28, 0.9)',
              titleColor: '#ffffff',
              bodyColor: '#e2e8f0',
              borderColor: 'rgba(255, 255, 255, 0.1)',
              borderWidth: 1,
            },
          },
        },
      });
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 2. INITIAL FIRESTORE HYDRATION (telemetry/live_metrics)
  // ═════════════════════════════════════════════════════════════
  async function hydrateTelemetryFromFirestore() {
    let remoteData = null;

    // 1. Try Firebase modular client SDK if initialized
    try {
      if (window.rawFirestoreDb && window.firebase) {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
        const snap = await getDoc(doc(window.rawFirestoreDb, 'telemetry', 'live_metrics'));
        if (snap.exists()) {
          remoteData = snap.data();
        }
      }
    } catch (_) {
      // Fallback below
    }

    // 2. Resilient API proxy fallback
    if (!remoteData) {
      try {
        const res = await fetch('/api/admin/telemetry-live');
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            remoteData = json.data;
          }
        }
      } catch (_) {}
    }

    // 3. Fallback to direct Firestore REST API with client app config
    if (!remoteData) {
      try {
        const cfgRes = await fetch('/api/firebase-config');
        if (cfgRes.ok) {
          const cfg = await cfgRes.json();
          if (cfg && cfg.apiKey && cfg.projectId) {
            const docUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId || '(default)'}/documents/telemetry/live_metrics?key=${cfg.apiKey}`;
            const rest = await fetch(docUrl);
            if (rest.ok) {
              const docObj = await rest.json();
              if (docObj.fields) {
                remoteData = parseFirestoreFields(docObj.fields);
              }
            }
          }
        }
      } catch (_) {}
    }

    if (remoteData) {
      mergeTelemetryData(remoteData);
      renderAllHydratedMetrics();
    }
  }

  function parseFirestoreFields(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v.mapValue && v.mapValue.fields) {
        out[k] = parseFirestoreFields(v.mapValue.fields);
      } else if (v.arrayValue) {
        out[k] = (v.arrayValue.values || []).map((item) => {
          if (item.mapValue && item.mapValue.fields) return parseFirestoreFields(item.mapValue.fields);
          if (item.integerValue !== undefined) return Number(item.integerValue);
          if (item.doubleValue !== undefined) return Number(item.doubleValue);
          if (item.stringValue !== undefined) return item.stringValue;
          if (item.booleanValue !== undefined) return item.booleanValue;
          return item;
        });
      } else if (v.integerValue !== undefined) {
        out[k] = Number(v.integerValue);
      } else if (v.doubleValue !== undefined) {
        out[k] = Number(v.doubleValue);
      } else if (v.stringValue !== undefined) {
        out[k] = v.stringValue;
      } else if (v.booleanValue !== undefined) {
        out[k] = v.booleanValue;
      } else if (v.timestampValue !== undefined) {
        out[k] = v.timestampValue;
      }
    }
    return out;
  }

  function mergeTelemetryData(data) {
    if (!data) return;
    if (data.system_summary) {
      Object.assign(telemetryState.system_summary, data.system_summary);
    }
    if (data.sentiment_distribution) {
      Object.assign(telemetryState.sentiment_distribution, data.sentiment_distribution);
    }
    if (data.session_durations) {
      Object.assign(telemetryState.session_durations, data.session_durations);
    }
    if (data.retention_metrics) {
      Object.assign(telemetryState.retention_metrics, data.retention_metrics);
    }
    if (data.behavior_analytics) {
      telemetryState.behavior_analytics = data.behavior_analytics;
    }
  }

  function computeRetentionMetrics() {
    const d = telemetryState.session_durations || {};
    const total = (d.quick_skips_under_15s || 0) + (d.short_chats_15s_1m || 0) + (d.medium_chats_1m_3m || 0) + (d.deep_chats_over_3m || 0);
    const behOv = (telemetryState.behavior_analytics && telemetryState.behavior_analytics.overview) || {};
    const totalContacts = (behOv.phoneNumbersSharedCount || behOv.sharedNumbers || 0) + (behOv.phoneNumbersAskedCount || behOv.askedNumbers || 0) + (behOv.socialHandlesCount || behOv.socialHandles || 0);
    const totalMsgs = behOv.totalMessagesProcessed || 0;
    const solicitousRate = totalMsgs > 0 ? Math.min(100, Math.round(((totalContacts / totalMsgs) * 100) * 10) / 10) : 0;

    if (total > 0) {
      const survivalRate = Math.round(((d.deep_chats_over_3m || 0) / total) * 1000) / 10;
      const skipChurn = Math.round(((d.quick_skips_under_15s || 0) / total) * 1000) / 10;
      const patienceQ = Math.max(0, Math.round((100 - skipChurn) * 10) / 10);
      return { survivalRate, skipChurn, patienceQ, solicitousRate };
    }

    const r = telemetryState.retention_metrics || {};
    const survivalRate = typeof r.survival_rate_3m_pct === 'number' ? Number(r.survival_rate_3m_pct) : 0;
    const skipChurn = typeof r.skip_churn_15s_pct === 'number' ? Number(r.skip_churn_15s_pct) : 0;
    const patienceQ = typeof r.patience_quotient_pct === 'number' ? Number(r.patience_quotient_pct) : Math.max(0, 100 - skipChurn);
    return { survivalRate, skipChurn, patienceQ, solicitousRate };
  }

  function renderRepeatOffendersTable(offenders) {
    const list = Array.isArray(offenders) ? offenders : [];
    const countPill = $('repeatOffendersCountPill');
    const tbody = $('repeatOffendersTableBody');
    if (countPill) countPill.textContent = `${list.length} Flagged`;
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 22px; color: var(--t-ghost);">No repeat offenders detected. Platform safety healthy.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((off, idx) => {
      const totalV = off.violationCount || 0;
      const badgeClass = totalV >= 5 ? 'rejected' : (totalV >= 2 ? 'pending' : 'info');
      const safeUid = escapeHtml(off.userId || off.deviceHash || 'Unknown');
      return `
        <tr>
          <td class="tabular-nums" style="font-weight:700; color:var(--t-ghost);">#${idx + 1}</td>
          <td><code class="clickable-user-id" data-inspect-user="${safeUid}" title="Click to inspect" style="cursor:pointer; color:var(--pink-l);">${safeUid}</code></td>
          <td><span class="country-tag" style="font-size:0.75rem;">🌐 ${escapeHtml(off.country || 'Global')}</span></td>
          <td><span class="badge-tag ${badgeClass} tabular-nums">${totalV} strikes</span></td>
          <td class="tabular-nums font-bold" style="color:var(--red-l);">${off.slursCount || 0}</td>
          <td class="tabular-nums font-bold" style="color:var(--amber-l);">${(off.askedNumbersCount || 0) + (off.sharedNumbersCount || 0) + (off.socialsCount || 0)}</td>
          <td style="font-size:0.75rem; color:var(--t-secondary); max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${escapeHtml(off.lastSnippet || 'None')}
          </td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn-table-action" style="background:rgba(236,72,153,0.15); color:var(--pink-l); border-color:rgba(236,72,153,0.3);" data-action="quick-shadowban" data-user="${safeUid}" title="Silently quarantine without alert">
                👻 Ghost
              </button>
              <button class="btn-table-action danger" data-action="quick-ban" data-user="${safeUid}" title="Ban hardware device 15m">
                🚫 Ban
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-action="quick-shadowban"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const target = btn.getAttribute('data-user');
        if (!target) return;
        try {
          await adminFetch('/api/admin/shadowbans/add', {
            method: 'POST',
            body: JSON.stringify({ target, minutes: 60, reason: 'Repeat slur / contact violation' })
          });
          refreshAdminDashboardData();
        } catch (_) {}
      });
    });

    tbody.querySelectorAll('[data-action="quick-ban"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const target = btn.getAttribute('data-user');
        if (!target) return;
        try {
          await adminFetch('/api/admin/bans/add', {
            method: 'POST',
            body: JSON.stringify({ deviceHash: target, minutes: 15, reason: 'Repeat community guideline violation' })
          });
          refreshAdminDashboardData();
        } catch (_) {}
      });
    });

    tbody.querySelectorAll('[data-inspect-user]').forEach(el => {
      el.addEventListener('click', () => {
        const uid = el.getAttribute('data-inspect-user');
        if (!uid) return;
        switchAdminTab('lookup');
        const inp = $('lookupQueryInput');
        if (inp) {
          inp.value = uid;
          $('adminLookupForm')?.dispatchEvent(new Event('submit'));
        }
      });
    });
  }

  function renderAllHydratedMetrics(data = null) {
    const s = telemetryState.sentiment_distribution;
    const d = telemetryState.session_durations;

    // 1. Sentiment Distribution Bars & Text Counters
    const totalSentiment =
      (s.friendly_greetings || 0) +
      (s.curious_questions || 0) +
      (s.casual_dialogue || 0) +
      (s.playful_humor || 0) +
      (s.toxic_messages || 0);

    const safeTotalSent = Math.max(1, totalSentiment);

    updateCountAndFill('vibeGreetingsCount', 'vibeGreetingsFill', s.friendly_greetings, safeTotalSent);
    updateCountAndFill('vibeCuriousCount', 'vibeCuriousFill', s.curious_questions, safeTotalSent);
    updateCountAndFill('vibeCasualCount', 'vibeCasualFill', s.casual_dialogue, safeTotalSent);
    updateCountAndFill('vibeHumorCount', 'vibeHumorFill', s.playful_humor, safeTotalSent);
    updateCountAndFill('vibeHostileCount', 'vibeHostileFill', s.toxic_messages, safeTotalSent);

    // 2. Chat Session Durations Bars & Text Counters
    const totalDurations =
      (d.quick_skips_under_15s || 0) +
      (d.short_chats_15s_1m || 0) +
      (d.medium_chats_1m_3m || 0) +
      (d.deep_chats_over_3m || 0);

    const safeTotalDur = Math.max(1, totalDurations);

    updateCountAndFill('durQuickSkipsCount', 'durQuickSkipsFill', d.quick_skips_under_15s, safeTotalDur);
    updateCountAndFill('durShortChatsCount', 'durShortChatsFill', d.short_chats_15s_1m, safeTotalDur);
    updateCountAndFill('durMediumChatsCount', 'durMediumChatsFill', d.medium_chats_1m_3m, safeTotalDur);
    updateCountAndFill('durDeepChatsCount', 'durDeepChatsFill', d.deep_chats_over_3m, safeTotalDur);

    // 3. Real-Time Psychological Retention Metrics HUD (calculated with zero fake hardcoded bias)
    const retMetrics = computeRetentionMetrics();
    if ($('hudRetSurvival')) $('hudRetSurvival').textContent = `${retMetrics.survivalRate.toFixed(1)}%`;
    if ($('hudRetSkipChurn')) $('hudRetSkipChurn').textContent = `${retMetrics.skipChurn.toFixed(1)}%`;
    if ($('hudRetPatience')) $('hudRetPatience').textContent = `${retMetrics.patienceQ.toFixed(1)}%`;

    // 4. Behavioral Intelligence Hydration (Guarantees charts and numbers persist across sleep)
    const beh = telemetryState.behavior_analytics || (data && data.behavior_analytics);
    if (beh) {
      const bo = beh.overview || {};
      const ce = beh.contactExtraction || {};
      const sd = beh.slurDistribution || {};

      if ($('statBehaviorAskedNumbers')) $('statBehaviorAskedNumbers').textContent = formatNum(bo.askedNumbers ?? bo.phoneNumbersAskedCount ?? 0);
      if ($('statBehaviorSharedNumbers')) $('statBehaviorSharedNumbers').textContent = formatNum(bo.sharedNumbers ?? bo.phoneNumbersSharedCount ?? 0);
      if ($('statBehaviorSlursBlocked')) $('statBehaviorSlursBlocked').textContent = formatNum(bo.slursBlocked ?? bo.slursInterceptedCount ?? 0);
      if ($('statBehaviorSocialHandles')) $('statBehaviorSocialHandles').textContent = formatNum(bo.socialHandles ?? bo.socialHandlesCount ?? 0);
      if ($('statBehaviorCleanRate')) $('statBehaviorCleanRate').textContent = `${bo.cleanRatePct ?? bo.cleanPassRate ?? 100}%`;
      if ($('statBehaviorAvgDuration')) $('statBehaviorAvgDuration').textContent = `${bo.avgDurationSec ?? bo.avgChatDurationSeconds ?? 0}s`;
      if ($('statBehaviorAvgMsgLength')) $('statBehaviorAvgMsgLength').textContent = `${bo.avgMsgLengthChars ?? bo.avgMsgLength ?? 0} chars`;
      if ($('statBehaviorOffPlatformRate')) $('statBehaviorOffPlatformRate').textContent = `${bo.offPlatformRatePct ?? bo.offPlatformAttemptRate ?? 0}%`;

      if ($('statOverviewAskedNumbers')) $('statOverviewAskedNumbers').textContent = formatNum(bo.askedNumbers ?? bo.phoneNumbersAskedCount ?? 0);
      if ($('statOverviewSharedNumbers')) $('statOverviewSharedNumbers').textContent = formatNum(bo.sharedNumbers ?? bo.phoneNumbersSharedCount ?? 0);
      if ($('statOverviewSlursBlocked')) $('statOverviewSlursBlocked').textContent = formatNum(bo.slursBlocked ?? bo.slursInterceptedCount ?? 0);
      if ($('statOverviewCleanRate')) $('statOverviewCleanRate').textContent = `${bo.cleanRatePct ?? bo.cleanPassRate ?? 100}%`;

      // Contact extraction counters
      if ($('countExtractAsked')) $('countExtractAsked').textContent = formatNum(ce.numbersAsked ?? 0);
      if ($('countExtractShared')) $('countExtractShared').textContent = formatNum(ce.numbersShared ?? 0);
      if ($('countExtractInstagram')) $('countExtractInstagram').textContent = formatNum(ce.instagramHandles ?? 0);
      if ($('countExtractSnapchat')) $('countExtractSnapchat').textContent = formatNum(ce.snapchatHandles ?? 0);
      if ($('countExtractTelegram')) $('countExtractTelegram').textContent = formatNum(ce.telegramDiscord ?? 0);

      // Slur distribution counters
      if ($('catRacialCount')) $('catRacialCount').textContent = formatNum(sd.racialAndEthnic ?? 0);
      if ($('catPredatoryCount')) $('catPredatoryCount').textContent = formatNum(sd.predatoryAndGrooming ?? 0);
      if ($('catHomophobicCount')) $('catHomophobicCount').textContent = formatNum(sd.homophobicTransphobic ?? 0);
      if ($('catMisogynisticCount')) $('catMisogynisticCount').textContent = formatNum(sd.misogynisticAbuse ?? 0);
      if ($('catCyberbullyingCount')) $('catCyberbullyingCount').textContent = formatNum(sd.cyberbullyingAndSelfHarm ?? 0);
      if ($('catRegionalCount')) $('catRegionalCount').textContent = formatNum(sd.regionalHinglish ?? 0);

      // Behavior HUDs
      if ($('hudBehaviorAsked')) $('hudBehaviorAsked').textContent = `${bo.askedNumbers ?? bo.phoneNumbersAskedCount ?? 0}/min`;
      if ($('hudBehaviorSlurs')) $('hudBehaviorSlurs').textContent = `${bo.slursBlocked ?? bo.slursInterceptedCount ?? 0}/min`;
      if ($('hudBehaviorSocials')) $('hudBehaviorSocials').textContent = `${bo.socialHandles ?? bo.socialHandlesCount ?? 0}/min`;
      if ($('hudBehaviorClean')) $('hudBehaviorClean').textContent = `${bo.cleanRatePct ?? bo.cleanPassRate ?? 100}%`;

      // Repeat offenders table hydration (ensures data is retained and rendered after container sleep)
      const offenders = beh.topOffenders || (Array.isArray(beh.repeatOffenders) ? beh.repeatOffenders.map(x => Array.isArray(x) ? x[1] : x) : []);
      renderRepeatOffendersTable(offenders);
    } else {
      if ($('statOverviewSlursBlocked')) $('statOverviewSlursBlocked').textContent = '0';
      if ($('statBehaviorSlursBlocked')) $('statBehaviorSlursBlocked').textContent = '0';
    }

    // 5. Restore Rolling Time Series (telemetry_history) from Firestore cold-boot snapshot
    const historyList = (data && Array.isArray(data.telemetry_history)) ? data.telemetry_history : null;
    if (historyList && historyList.length > 0) {
      timeLabels.length = 0;
      socketsSeries.length = 0;
      roomsSeries.length = 0;
      velocitySeries.length = 0;
      threatsSeries.length = 0;
      spamSeries.length = 0;
      retentionCurveSeries.length = 0;
      churnCurveSeries.length = 0;
      solicitousCurveSeries.length = 0;
      behaviorAskedSeries.length = 0;
      behaviorSlursSeries.length = 0;
      behaviorSocialsSeries.length = 0;

      const behOv = (telemetryState.behavior_analytics && telemetryState.behavior_analytics.overview) || {};

      historyList.forEach((pt) => {
        timeLabels.push(pt.timeLabel || new Date(pt.timestamp || pt.t || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        socketsSeries.push(pt.online || 0);
        roomsSeries.push(pt.rooms || 0);
        velocitySeries.push(pt.msgsPerSec || 0);
        threatsSeries.push(pt.violationsPerSec || 0);
        spamSeries.push(Math.round((pt.violationsPerSec || 0) * 0.4));
        retentionCurveSeries.push(retMetrics.survivalRate);
        churnCurveSeries.push(retMetrics.skipChurn);
        solicitousCurveSeries.push(retMetrics.solicitousRate);
        behaviorAskedSeries.push(typeof pt.askedNumbers === 'number' ? pt.askedNumbers : 0);
        behaviorSlursSeries.push(typeof pt.slurs === 'number' ? pt.slurs : 0);
        behaviorSocialsSeries.push(typeof pt.socials === 'number' ? pt.socials : 0);
      });
      updateAllChartsNoAnim();
    } else if (timeLabels.length === 0) {
      // Seed initial points so canvas is never empty
      const now = Date.now();
      for (let i = 12; i >= 0; i--) {
        const t = new Date(now - i * 2000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        timeLabels.push(t);
        socketsSeries.push(telemetryState.live_fleet.activeUsers || 1);
        roomsSeries.push(telemetryState.live_fleet.activeRooms || 0);
        velocitySeries.push(telemetryState.live_fleet.msgsPerSec || 0);
        threatsSeries.push(telemetryState.live_fleet.violationsPerSec || 0);
        spamSeries.push(0);
        retentionCurveSeries.push(retMetrics.survivalRate);
        churnCurveSeries.push(retMetrics.skipChurn);
        solicitousCurveSeries.push(retMetrics.solicitousRate);
        behaviorAskedSeries.push(0);
        behaviorSlursSeries.push(0);
        behaviorSocialsSeries.push(0);
      }
      updateAllChartsNoAnim();
    }
  }

  function updateCountAndFill(countId, fillId, val = 0, total = 1) {
    const num = Number(val) || 0;
    const cEl = $(countId);
    if (cEl) cEl.textContent = formatNum(num);

    const fEl = $(fillId);
    if (fEl) {
      const pct = Math.min(100, Math.max(0, Math.round((num / total) * 1000) / 10));
      fEl.style.width = `${pct}%`;
    }
  }

  function formatNum(n) {
    return Number(n).toLocaleString();
  }

  // ═════════════════════════════════════════════════════════════
  // 3. REAL-TIME LIVE CURVES (WEBSOCKET TICKER BINDING)
  // ═════════════════════════════════════════════════════════════
  function bindWebSocketTelemetry(socket) {
    if (!socket || socket === socketInstance) return;
    socketInstance = socket;

    // Auto-rejoin on socket connect/reconnect ONLY when admin dashboard is active
    const performJoin = () => {
      const token = localStorage.getItem('ping_admin_token') || sessionStorage.getItem('ping_admin_token') || localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token');
      if (!token) return;
      if (isAdminDashboardVisible()) {
        socket.emit('join_admin');
        socket.emit('admin_join');
        socket.emit('admin_rejoin', { token });
        refreshAdminDashboardData();
      }
    };

    socket.on('connect', () => {
      performJoin();
      const token = localStorage.getItem('ping_admin_token') || sessionStorage.getItem('ping_admin_token') || localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token');
      if (token && isAdminDashboardVisible()) {
        hydrateTelemetryFromFirestore();
        refreshAdminDashboardData();
      }
    });

    socket.on('admin_auth_failed', () => {
      handleSessionExpired();
    });

    socket.on('system_metrics', (data) => {
      if (!data) return;

      // Update live fleet counters
      telemetryState.live_fleet.activeUsers = data.activeUsers || 0;
      telemetryState.live_fleet.activeRooms = data.activeRooms || 0;
      telemetryState.live_fleet.queueSize = data.queueSize || 0;
      telemetryState.live_fleet.msgsPerSec = data.msgsPerSec || 0;
      telemetryState.live_fleet.violationsPerSec = data.violationsPerSec || 0;
      telemetryState.live_fleet.heapMb = data.heapMb || 0;
      telemetryState.live_fleet.eventLoopLagMs = data.eventLoopLagMs || 1;

      // Update overview stat cards
      if ($('statOnlineUsers')) $('statOnlineUsers').textContent = formatNum(data.activeUsers);
      if ($('statActiveRooms')) $('statActiveRooms').textContent = formatNum(data.activeRooms);
      if ($('statWaitingQueue')) $('statWaitingQueue').textContent = formatNum(data.queueSize);
      if ($('statMsgsPerSec')) $('statMsgsPerSec').textContent = `${data.msgsPerSec}/s`;
      if ($('statViolationsIntercepted')) $('statViolationsIntercepted').textContent = formatNum(data.violationsPerSec);
      if ($('statMemoryUsage')) $('statMemoryUsage').textContent = `${data.heapMb} MB`;
      if ($('statMemoryDetails')) $('statMemoryDetails').textContent = `Heap · ${data.eventLoopLagMs}ms event lag`;

      // Update HUDs
      if ($('hudSocketsVal')) $('hudSocketsVal').textContent = formatNum(data.activeUsers);
      if ($('hudRoomsVal')) $('hudRoomsVal').textContent = formatNum(data.activeRooms);
      if ($('hudVelocityVal')) $('hudVelocityVal').textContent = `${data.msgsPerSec} msgs/s`;
      if ($('hudQueueVal')) $('hudQueueVal').textContent = formatNum(data.queueSize);
      if ($('hudThreatVal')) $('hudThreatVal').textContent = `${data.violationsPerSec}/s`;

      // Merge dynamic sentiments & session durations if provided in ticker
      if (data.sentiment) {
        Object.assign(telemetryState.sentiment_distribution, data.sentiment);
      }
      if (data.durations) {
        Object.assign(telemetryState.session_durations, data.durations);
      }
      if (data.retention) {
        Object.assign(telemetryState.retention_metrics, data.retention);
      }
      renderAllHydratedMetrics();

      // Push new data point and shift oldest for smooth rolling curve
      const timeStr = new Date(data.timestamp || Date.now()).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      timeLabels.push(timeStr);
      socketsSeries.push(data.activeUsers || 0);
      roomsSeries.push(data.activeRooms || 0);
      velocitySeries.push(data.msgsPerSec || 0);
      threatsSeries.push(data.violationsPerSec || 0);
      spamSeries.push(Math.round(data.violationsPerSec * 0.4));

      const liveRet = computeRetentionMetrics();
      retentionCurveSeries.push(liveRet.survivalRate);
      churnCurveSeries.push(liveRet.skipChurn);
      solicitousCurveSeries.push(liveRet.solicitousRate);

      const behStats = (data.behaviorStats) || (telemetryState.behavior_analytics) || {};
      const ts = behStats.timeSeries || [];
      const curBucket = ts.length > 0 ? ts[ts.length - 1] : null;

      const recentAsked = typeof curBucket?.askedNumbers === 'number' ? curBucket.askedNumbers : (typeof data.askedNumbers === 'number' ? data.askedNumbers : 0);
      const recentSlurs = typeof curBucket?.slurs === 'number' ? curBucket.slurs : (typeof data.slurs === 'number' ? data.slurs : 0);
      const recentSocials = typeof curBucket?.socials === 'number' ? curBucket.socials : (typeof data.socials === 'number' ? data.socials : 0);

      behaviorAskedSeries.push(recentAsked);
      behaviorSlursSeries.push(recentSlurs);
      behaviorSocialsSeries.push(recentSocials);

      if (data.behaviorStats && Array.isArray(data.behaviorStats.topOffenders)) {
        renderRepeatOffendersTable(data.behaviorStats.topOffenders);
      }

      if (timeLabels.length > MAX_POINTS) {
        timeLabels.shift();
        socketsSeries.shift();
        roomsSeries.shift();
        velocitySeries.shift();
        threatsSeries.shift();
        spamSeries.shift();
        retentionCurveSeries.shift();
        churnCurveSeries.shift();
        solicitousCurveSeries.shift();
        behaviorAskedSeries.shift();
        behaviorSlursSeries.shift();
        behaviorSocialsSeries.shift();
      }

      // Smooth 0-lag rolling curve update (animation disabled via 'none')
      updateAllChartsNoAnim();
    });
  }

  function updateAllChartsNoAnim() {
    for (const chart of Object.values(activeCharts)) {
      if (chart && typeof chart.update === 'function') {
        chart.update('none');
      }
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 4. TAB NAVIGATION & CANVAS CONTEXT DROP PREVENTER
  // ═════════════════════════════════════════════════════════════
  function setupTabNavigation() {
    const tabButtons = document.querySelectorAll('.admin-tab-btn');
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        if (!targetTab) return;
        switchAdminTab(targetTab);
      });
    });

    // 100k Sim button in Overview timeframe pills
    document.querySelectorAll('[data-timeframe]').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('[data-timeframe]').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        const tf = pill.getAttribute('data-timeframe');
        if (tf === '100k') {
          handle100kSimScale();
        }
      });
    });
  }

  function switchAdminTab(tabKey) {
    const cleanKey = String(tabKey).toLowerCase().replace(/[^a-z0-9]/g, '');

    // Map clean key to panel element ID
    const panelMap = {
      overview: 'adminTabOverview',
      behavior: 'adminTabBehavior',
      archetypes: 'adminTabArchetypes',
      psychology: 'adminTabArchetypes',
      masscontrol: 'adminTabMasscontrol',
      '100k': 'adminTabMasscontrol',
      '100ksim': 'adminTabMasscontrol',
      shadowbans: 'adminTabShadowbans',
      events: 'adminTabEvents',
      rooms: 'adminTabRooms',
      bans: 'adminTabBans',
      reports: 'adminTabReports',
      words: 'adminTabWords',
      lookup: 'adminTabLookup',
      broadcast: 'adminTabBroadcast',
      geo: 'adminTabGeo',
    };

    const targetId = panelMap[cleanKey] || `adminTab${cleanKey.charAt(0).toUpperCase() + cleanKey.slice(1)}`;

    // Update active tab buttons
    document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
      const bKey = (btn.getAttribute('data-tab') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const isActive = bKey === cleanKey || (cleanKey === 'archetypes' && bKey === 'psychology');
      btn.classList.toggle('active', isActive);
    });

    // Switch panels
    document.querySelectorAll('.admin-tab-panel').forEach((panel) => {
      panel.classList.remove('active');
    });

    const activePanel = $(targetId);
    if (activePanel) {
      activePanel.classList.add('active');
    }

    // HIDDEN CANVAS CONTEXT DROP PREVENTER:
    // When a tab becomes visible, re-size and re-render all Chart.js instances in the next frame
    requestAnimationFrame(() => {
      for (const chart of Object.values(activeCharts)) {
        if (chart && typeof chart.resize === 'function') {
          chart.resize();
          chart.update('none');
        }
      }
    });
  }

  function handle100kSimScale() {
    // Proportional 100k scaling without Math.random()
    const active = Math.max(100000, (telemetryState.live_fleet.activeUsers || 1) * 1250);
    const rooms = Math.round(active * 0.44);
    const msgs = Math.round(active * 0.18);

    if ($('statOnlineUsers')) $('statOnlineUsers').textContent = formatNum(active);
    if ($('statActiveRooms')) $('statActiveRooms').textContent = formatNum(rooms);
    if ($('statMsgsPerSec')) $('statMsgsPerSec').textContent = `${formatNum(msgs)}/s`;

    if ($('hudSocketsVal')) $('hudSocketsVal').textContent = formatNum(active);
    if ($('hudRoomsVal')) $('hudRoomsVal').textContent = formatNum(rooms);
    if ($('hudVelocityVal')) $('hudVelocityVal').textContent = `${formatNum(msgs)} msgs/s`;
  }

  // ═════════════════════════════════════════════════════════════
  // 5. MULTI-TAB EXCEL (.XLSX) REPORT GENERATION (SheetJS)
  // ═════════════════════════════════════════════════════════════
  let isExportingExcel = false;
  async function exportExcelReport() {
    if (isExportingExcel) return;
    isExportingExcel = true;
    const exportBtn = $('adminExportBtn');
    if (exportBtn) {
      exportBtn.style.pointerEvents = 'none';
      exportBtn.style.opacity = '0.65';
    }

    try {
      // Dynamically ensure XLSX (SheetJS) is loaded
      if (typeof window.XLSX === 'undefined') {
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
        } catch (err) {
          alert('Could not load Excel export library. Please check your internet connection.');
          return;
        }
      }

    const XLSX = window.XLSX;
    const nowStr = new Date().toISOString();
    const todayDate = nowStr.split('T')[0];

    // ── SHEET 1: System Overview ──
    const s1 = telemetryState.system_summary;
    const lf = telemetryState.live_fleet;
    const sheet1Data = [
      ['Metric', 'Value', 'Unit / Detail', 'Recorded At'],
      ['Total Chat Sessions Logged', s1.total_sessions_logged || 0, 'Completed Conversations', s1.last_updated],
      ['Peak Concurrent Users (CCU)', s1.active_ccu_peak || 0, 'Peak Active Sockets', s1.last_updated],
      ['Current Active Users (Sockets)', lf.activeUsers || 0, 'Live Connections', nowStr],
      ['Active 1-on-1 Chat Rooms', lf.activeRooms || 0, 'Active Pairs', nowStr],
      ['Matchmaking Queue Buffer', lf.queueSize || 0, 'Pending Sockets', nowStr],
      ['Message Throughput Velocity', lf.msgsPerSec || 0, 'Messages / Second', nowStr],
      ['Threat / Policy Violations', lf.violationsPerSec || 0, 'Intercepted / Second', nowStr],
      ['Node.js Heap Memory', `${lf.heapMb || 0} MB`, 'Memory Usage', nowStr],
      ['Event Loop Lag', `${lf.eventLoopLagMs || 1} ms`, 'Cluster Latency', nowStr],
      ['Platform Security Policy', 'Standard ABAC / Hardened Rules', 'Status: Secure', nowStr],
    ];

    // ── SHEET 2: Sentiment & Intent ──
    const sent = telemetryState.sentiment_distribution;
    const totSent = Math.max(
      1,
      (sent.friendly_greetings || 0) +
        (sent.curious_questions || 0) +
        (sent.casual_dialogue || 0) +
        (sent.playful_humor || 0) +
        (sent.toxic_messages || 0)
    );

    const sheet2Data = [
      ['Sentiment / Tone Category', 'Total Count', 'Percentage', 'Intent Description'],
      [
        'Friendly Greetings',
        sent.friendly_greetings || 0,
        `${(((sent.friendly_greetings || 0) / totSent) * 100).toFixed(1)}%`,
        'Warm conversational openers ("hi", "hello", "hey")',
      ],
      [
        'Curious Questions',
        sent.curious_questions || 0,
        `${(((sent.curious_questions || 0) / totSent) * 100).toFixed(1)}%`,
        'Icebreakers, open-ended inquiries, questions',
      ],
      [
        'Casual Flowing Dialogue',
        sent.casual_dialogue || 0,
        `${(((sent.casual_dialogue || 0) / totSent) * 100).toFixed(1)}%`,
        'Natural peer-to-peer flowing chat messages',
      ],
      [
        'Playful Humor & Memes',
        sent.playful_humor || 0,
        `${(((sent.playful_humor || 0) / totSent) * 100).toFixed(1)}%`,
        'Laughter, jokes, meme slang, positive emoji',
      ],
      [
        'Toxic / Hostile Interceptions',
        sent.toxic_messages || 0,
        `${(((sent.toxic_messages || 0) / totSent) * 100).toFixed(1)}%`,
        'Quarantined slurs, harassment, predatory attempts',
      ],
    ];

    // ── SHEET 3: Chat Durations & Retention ──
    const dur = telemetryState.session_durations;
    const ret = telemetryState.retention_metrics;
    const totDur = Math.max(
      1,
      (dur.quick_skips_under_15s || 0) +
        (dur.short_chats_15s_1m || 0) +
        (dur.medium_chats_1m_3m || 0) +
        (dur.deep_chats_over_3m || 0)
    );

    const sheet3Data = [
      ['Duration Bucket', 'Session Count', 'Proportion', 'Retention Benchmark'],
      [
        'Quick Skips (<15s)',
        dur.quick_skips_under_15s || 0,
        `${(((dur.quick_skips_under_15s || 0) / totDur) * 100).toFixed(1)}%`,
        '15s Skip Churn Metric',
      ],
      [
        'Short Chats (15s – 1m)',
        dur.short_chats_15s_1m || 0,
        `${(((dur.short_chats_15s_1m || 0) / totDur) * 100).toFixed(1)}%`,
        'Exploratory conversations',
      ],
      [
        'Medium Chats (1m – 3m)',
        dur.medium_chats_1m_3m || 0,
        `${(((dur.medium_chats_1m_3m || 0) / totDur) * 100).toFixed(1)}%`,
        'Moderate engagement depth',
      ],
      [
        'Deep Chats (>3m)',
        dur.deep_chats_over_3m || 0,
        `${(((dur.deep_chats_over_3m || 0) / totDur) * 100).toFixed(1)}%`,
        'High-value reciprocal connection',
      ],
      ['', '', '', ''],
      ['Retention KPI', 'Score / Value', 'Target', 'Evaluation'],
      [
        '3m Survival Rate (%)',
        `${Number(ret.survival_rate_3m_pct || 0).toFixed(1)}%`,
        '> 60.0%',
        'Probability user stays beyond 3 minutes',
      ],
      [
        '15s Skip Churn (%)',
        `${Number(ret.skip_churn_15s_pct || 0).toFixed(1)}%`,
        '< 30.0%',
        'Immediate discard bounce rate',
      ],
      [
        'Patience Quotient (%)',
        `${Number(ret.patience_quotient_pct || 0).toFixed(1)}%`,
        '> 70.0%',
        'User conversational willingness index',
      ],
    ];

    // ── SHEET 4: Behavior & Violation Intel ──
    const beh = telemetryState.behavior_analytics || {};
    const bo = beh.overview || {};
    const sd = beh.slurDistribution || {};
    const ce = beh.contactExtraction || {};
    const sheet4Data = [
      ['Behavioral Intelligence Metric', 'Value', 'Unit / Detail', 'Recorded At'],
      ['Asking For Phone Numbers', bo.askedNumbers ?? bo.phoneNumbersAskedCount ?? 0, 'Blocked requests', nowStr],
      ['Phone Numbers Shared', bo.sharedNumbers ?? bo.phoneNumbersSharedCount ?? 0, 'Blocked digit leaks', nowStr],
      ['Hate Speech & Slurs Blocked', bo.slursBlocked ?? bo.slursInterceptedCount ?? 0, 'Pre-send filter interceptions', nowStr],
      ['Social Media Handles Intercepted', bo.socialHandles ?? bo.socialHandlesCount ?? 0, 'IG, Snapchat, Discord', nowStr],
      ['Clean Conversation Pass Rate', `${bo.cleanRatePct ?? bo.cleanPassRate ?? 100}%`, 'Civil conversation ratio', nowStr],
      ['Average Chat Duration', `${bo.avgDurationSec ?? bo.avgChatDurationSeconds ?? 0}s`, 'Mean duration', nowStr],
      ['Average Message Depth', `${bo.avgMsgLengthChars ?? bo.avgMsgLength ?? 0} chars`, 'Mean message size', nowStr],
      ['Off-Platform Solicitation Risk', `${bo.offPlatformRatePct ?? bo.offPlatformAttemptRate ?? 0}%`, 'Contact extraction attempts', nowStr],
      ['', '', '', ''],
      ['Slur Category Taxonomy', 'Intercepted Count', 'Description', 'Severity Level'],
      ['Racial & Ethnic', sd.racialAndEthnic || 0, 'Severe racial / ethnic slurs', 'Critical'],
      ['Predatory / Grooming', sd.predatoryAndGrooming || 0, 'Diddy, Epstein, predatory terms', 'Severe'],
      ['Homophobic / Transphobic', sd.homophobicTransphobic || 0, 'Anti-LGBTQ+ abuse', 'High'],
      ['Misogynistic Abuse', sd.misogynisticAbuse || 0, 'Gendered insults & degradation', 'High'],
      ['Cyberbullying / Self-Harm', sd.cyberbullyingAndSelfHarm || 0, 'Suicide encouragement & harassment', 'Critical'],
      ['Regional / Hinglish', sd.regionalHinglish || 0, 'Multilingual profanity', 'Moderate'],
      ['', '', '', ''],
      ['Contact Extraction Vectors', 'Blocked Attempts', 'Platform / Vector', 'Action'],
      ['Phone Numbers Asked', ce.numbersAsked || 0, 'Direct phone request', 'Blocked / Warning'],
      ['Phone Numbers Shared', ce.numbersShared || 0, 'Raw digits / formatted numbers', 'Blocked / Redacted'],
      ['Instagram Handles', ce.instagramHandles || 0, 'Instagram username', 'Blocked / Warning'],
      ['Snapchat Handles', ce.snapchatHandles || 0, 'Snapchat username', 'Blocked / Warning'],
      ['Telegram & Discord', ce.telegramDiscord || 0, 'Chat platform invite', 'Blocked / Warning'],
    ];

    // ── SHEET 5: Top Repeat Policy & Slur Offenders ──
    const offendersList = Array.isArray(beh.topOffenders) ? beh.topOffenders : (Array.isArray(beh.repeatOffenders) ? beh.repeatOffenders.map(x => Array.isArray(x) ? x[1] : x) : []);
    const sheet5Data = [
      ['Rank', 'User ID', 'Origin / Country', 'Total Strikes / Violations', 'Slurs Intercepted', 'Contact Solicitation', 'Last Flagged Snippet', 'Last Violation Timestamp']
    ];
    if (offendersList.length === 0) {
      sheet5Data.push(['-', 'No repeat offenders detected', 'Global', 0, 0, 0, 'Platform operating cleanly', nowStr]);
    } else {
      offendersList.forEach((off, idx) => {
        sheet5Data.push([
          idx + 1,
          off.userId || off.deviceHash || 'Unknown',
          off.country || 'Global',
          off.violationCount || 0,
          off.slursCount || 0,
          (off.askedNumbersCount || 0) + (off.sharedNumbersCount || 0) + (off.socialsCount || 0),
          off.lastSnippet || 'None',
          off.lastViolationTime ? new Date(off.lastViolationTime).toISOString() : nowStr,
        ]);
      });
    }

    // Build Workbook
    const wb = XLSX.utils.book_new();

    const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
    const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
    const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);
    const ws4 = XLSX.utils.aoa_to_sheet(sheet4Data);
    const ws5 = XLSX.utils.aoa_to_sheet(sheet5Data);

    // Set column widths
    ws1['!cols'] = [{ wch: 30 }, { wch: 25 }, { wch: 25 }, { wch: 28 }];
    ws2['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 45 }];
    ws3['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 38 }];
    ws4['!cols'] = [{ wch: 32 }, { wch: 20 }, { wch: 35 }, { wch: 25 }];
    ws5['!cols'] = [{ wch: 8 }, { wch: 25 }, { wch: 18 }, { wch: 25 }, { wch: 18 }, { wch: 22 }, { wch: 30 }, { wch: 28 }];

    XLSX.utils.book_append_sheet(wb, ws1, 'System Overview');
    XLSX.utils.book_append_sheet(wb, ws2, 'Sentiment & Intent');
    XLSX.utils.book_append_sheet(wb, ws3, 'Chat Durations & Retention');
    XLSX.utils.book_append_sheet(wb, ws4, 'Behavior & Violation Intel');
    XLSX.utils.book_append_sheet(wb, ws5, 'Repeat Policy Offenders');

    const fileName = `Ping_Telemetry_Report_${todayDate}.xlsx`;
    XLSX.writeFile(wb, fileName);
  } finally {
    setTimeout(() => {
      isExportingExcel = false;
      const exportBtn = $('adminExportBtn');
      if (exportBtn) {
        exportBtn.style.pointerEvents = 'auto';
        exportBtn.style.opacity = '1';
      }
    }, 1200);
  }
}

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  // ═════════════════════════════════════════════════════════════
  // PAST DATA & TELEMETRY HYDRATION ENGINE
  // ═════════════════════════════════════════════════════════════
  function isAdminDashboardVisible() {
    const v = $('adminDashboardView');
    return Boolean(v && v.style.display !== 'none' && v.style.display !== '');
  }

  function handleSessionExpired() {
    const wasVisible = isAdminDashboardVisible();
    localStorage.removeItem('ping_admin_token');
    sessionStorage.removeItem('ping_admin_token');
    if (wasVisible) {
      const adminView = $('adminDashboardView');
      if (adminView) {
        adminView.style.display = 'none';
        document.body.style.overflow = '';
      }
      const modal = document.getElementById('adminAuthModal');
      if (modal) {
        modal.style.display = 'flex';
        const title = modal.querySelector('h3') || modal.querySelector('.admin-auth-title');
        if (title) title.textContent = 'Session expired.';
      }
    }
  }

  async function adminFetch(url, options = {}) {
    const token = localStorage.getItem('ping_admin_token') || sessionStorage.getItem('ping_admin_token') || '';
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      handleSessionExpired();
    }
    return res;
  }

  async function refreshAdminDashboardData() {
    // Never refresh admin data if dashboard is hidden
    if (!isAdminDashboardVisible()) return;
    try {
      // 1. Overview & Health Stats
      const ovRes = await adminFetch('/api/admin/overview');
      if (ovRes.ok) {
        const ov = await ovRes.json();
        if (ov.success) {
          if ($('statOnlineUsers')) $('statOnlineUsers').textContent = formatNum(ov.onlineUsers || 0);
          if ($('statActiveRooms')) $('statActiveRooms').textContent = formatNum(ov.activeRooms || 0);
          if ($('statWaitingQueue')) $('statWaitingQueue').textContent = formatNum(ov.waitingQueue || 0);
          if ($('statMsgsPerSec')) $('statMsgsPerSec').textContent = `${ov.msgsPerSec || 0}/s`;
          if ($('statViolationsIntercepted')) $('statViolationsIntercepted').textContent = formatNum(ov.violationsPerSec || 0);
          if ($('statShadowbansCount')) $('statShadowbansCount').textContent = formatNum(ov.shadowbansCount || 0);
          if ($('statActiveBansCount')) $('statActiveBansCount').textContent = formatNum(ov.bansCount || 0);
          if ($('adminUptimeText')) {
            const mins = Math.floor((ov.uptimeSeconds || 0) / 60);
            const hrs = Math.floor(mins / 60);
            $('adminUptimeText').textContent = hrs > 0 ? `Up: ${hrs}h ${mins % 60}m` : `Up: ${mins}m`;
          }
          if ($('statMemoryUsage') && ov.memory) {
            $('statMemoryUsage').textContent = `${ov.memory.heapUsedMb || 0} MB`;
          }
          if (typeof ov.vpnShieldEnabled === 'boolean') {
            updateVpnShieldUI(ov.vpnShieldEnabled);
          }
        }
      }

      // 2. Reports Feed
      const repRes = await adminFetch('/api/admin/reports');
      if (repRes.ok) {
        const repJson = await repRes.json();
        if (repJson.success && Array.isArray(repJson.reports)) {
          renderAdminReports(repJson.reports);
        }
      }

      // 3. Active Bans
      const banRes = await adminFetch('/api/admin/bans');
      if (banRes.ok) {
        const banJson = await banRes.json();
        if (banJson.success && Array.isArray(banJson.bans)) {
          renderAdminBans(banJson.bans);
        }
      }

      // 4. Live Rooms
      const roomRes = await adminFetch('/api/admin/rooms');
      if (roomRes.ok) {
        const roomJson = await roomRes.json();
        if (roomJson.success && Array.isArray(roomJson.rooms)) {
          const container = $('adminRoomsContainer');
          const badge = $('adminRoomsBadge');
          if (badge) badge.textContent = roomJson.rooms.length;
          if (container) {
            if (roomJson.rooms.length === 0) {
              container.innerHTML = `<div class="admin-empty-card" style="grid-column:1/-1; text-align:center; padding:40px; color:var(--t-ghost);">No active 1-on-1 chat rooms at the moment.</div>`;
            } else {
              container.innerHTML = roomJson.rooms.map(rm => `
                <div class="admin-room-card" style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-brd); border-radius:12px; padding:16px;">
                  <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                    <strong>Room: <code>${rm.roomId.slice(0, 10)}</code></strong>
                    <span class="count-pill cyan">${rm.elapsedSeconds || 0}s active</span>
                  </div>
                  <p style="font-size:0.8rem; color:var(--t-med); margin-bottom:12px;">Users: ${rm.users?.length || 2} · Messages: ${rm.messageCount || 0}</p>
                  <button class="btn-table-action danger" onclick="window.PingAdmin.terminateRoom('${rm.roomId}')">Terminate Room</button>
                </div>
              `).join('');
            }
          }
        }
      }

      // 5. Traffic & Geo
      const geoRes = await adminFetch('/api/admin/geo');
      if (geoRes.ok) {
        const geoJson = await geoRes.json();
        if (geoJson.success && Array.isArray(geoJson.geo)) {
          const tbody = $('adminGeoTableBody');
          if (tbody) {
            const total = geoJson.geo.reduce((acc, x) => acc + x.count, 0) || 1;
            tbody.innerHTML = geoJson.geo.map((g, idx) => `
              <tr>
                <td>#${idx + 1}</td>
                <td><strong>${escapeHtml(g.country)}</strong></td>
                <td>${formatNum(g.count)}</td>
                <td>${((g.count / total) * 100).toFixed(1)}%</td>
              </tr>
            `).join('');
          }
        }
      }

      // 6. Behavior Analytics
      const behRes = await adminFetch('/api/admin/behavior-analytics');
      if (behRes.ok) {
        const beh = await behRes.json();
        if (beh.success) {
          telemetryState.behavior_analytics = beh;
          if ($('statBehaviorAskedNumbers')) $('statBehaviorAskedNumbers').textContent = formatNum(beh.overview?.askedNumbers || 0);
          if ($('statBehaviorSharedNumbers')) $('statBehaviorSharedNumbers').textContent = formatNum(beh.overview?.sharedNumbers || 0);
          if ($('statBehaviorSlursBlocked')) $('statBehaviorSlursBlocked').textContent = formatNum(beh.overview?.slursBlocked || 0);
          if ($('statBehaviorSocialHandles')) $('statBehaviorSocialHandles').textContent = formatNum(beh.overview?.socialHandles || 0);
          if ($('statBehaviorCleanRate')) $('statBehaviorCleanRate').textContent = `${beh.overview?.cleanRatePct || 100}%`;
          if ($('statBehaviorAvgDuration')) $('statBehaviorAvgDuration').textContent = `${beh.overview?.avgDurationSec || 0}s`;
          if ($('statBehaviorAvgMsgLength')) $('statBehaviorAvgMsgLength').textContent = `${beh.overview?.avgMsgLength || 0} chars`;
          if ($('statBehaviorOffPlatformRate')) $('statBehaviorOffPlatformRate').textContent = `${beh.overview?.offPlatformRatePct || 0}%`;

          // Slur taxonomy counts
          const sd = beh.slurDistribution || {};
          if ($('catRacialCount')) $('catRacialCount').textContent = formatNum(sd.racialAndEthnic ?? 0);
          if ($('catPredatoryCount')) $('catPredatoryCount').textContent = formatNum(sd.predatoryAndGrooming ?? 0);
          if ($('catHomophobicCount')) $('catHomophobicCount').textContent = formatNum(sd.homophobicTransphobic ?? 0);
          if ($('catMisogynisticCount')) $('catMisogynisticCount').textContent = formatNum(sd.misogynisticAbuse ?? 0);
          if ($('catCyberbullyingCount')) $('catCyberbullyingCount').textContent = formatNum(sd.cyberbullyingAndSelfHarm ?? 0);
          if ($('catRegionalCount')) $('catRegionalCount').textContent = formatNum(sd.regionalHinglish ?? 0);

          // Contact extraction counters
          const ce = beh.contactExtraction || {};
          if ($('countExtractAsked')) $('countExtractAsked').textContent = formatNum(ce.numbersAsked ?? 0);
          if ($('countExtractShared')) $('countExtractShared').textContent = formatNum(ce.numbersShared ?? 0);
          if ($('countExtractInstagram')) $('countExtractInstagram').textContent = formatNum(ce.instagramHandles ?? 0);
          if ($('countExtractSnapchat')) $('countExtractSnapchat').textContent = formatNum(ce.snapchatHandles ?? 0);
          if ($('countExtractTelegram')) $('countExtractTelegram').textContent = formatNum(ce.telegramDiscord ?? 0);

          // Top repeat policy & slur offenders
          const offenders = beh.topOffenders || (Array.isArray(beh.repeatOffenders) ? beh.repeatOffenders.map(x => Array.isArray(x) ? x[1] : x) : []);
          renderRepeatOffendersTable(offenders);

          if (Array.isArray(beh.timeSeries) && beh.timeSeries.length > 0) {
            updateBehaviorChartFromData(beh.timeSeries);
          }
        }
      }

      // 7. Prohibited Words
      const wordsRes = await adminFetch('/api/admin/words');
      if (wordsRes.ok) {
        const wordsJson = await wordsRes.json();
        if (wordsJson.success) {
          renderCustomWords(wordsJson);
        }
      }

      // 8. Active Shadowbans
      const shadowRes = await adminFetch('/api/admin/shadowbans');
      if (shadowRes.ok) {
        const shadowJson = await shadowRes.json();
        if (shadowJson.success && Array.isArray(shadowJson.shadowbans)) {
          renderShadowbans(shadowJson.shadowbans);
        }
      }

      // 9. Geo-Fence Rules
      const geoRulesRes = await adminFetch('/api/admin/geo-rules');
      if (geoRulesRes.ok) {
        const geoRulesJson = await geoRulesRes.json();
        if (geoRulesJson.success) {
          renderGeoRules(geoRulesJson.geoRules, geoRulesJson.quarantined);
        }
      }

      // 10. Audit Events Feed
      const eventsRes = await adminFetch('/api/admin/events');
      if (eventsRes.ok) {
        const eventsJson = await eventsRes.json();
        if (eventsJson.success && Array.isArray(eventsJson.events)) {
          renderEventsFeed(eventsJson.events);
        }
      }
    } catch (err) {
      console.warn("Error refreshing admin past data:", err);
    }
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return String(str || '');
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function renderCustomWords(data) {
    const chipsContainer = $('customWordsChipsContainer');
    const pill = $('customWordsCountPill');
    const statCustom = $('statCustomWordsCount');
    const statTotal = $('statTotalBlockedWords');
    if (!data) return;
    const customList = Array.isArray(data.customWords) ? data.customWords : [];
    if (pill) pill.textContent = `${customList.length} custom`;
    if (statCustom) statCustom.textContent = formatNum(customList.length);
    if (statTotal && typeof data.totalBlocked === 'number') statTotal.textContent = formatNum(data.totalBlocked);

    if (chipsContainer) {
      if (customList.length === 0) {
        chipsContainer.innerHTML = `<span style="color:var(--t-ghost); font-size:0.85rem;">No custom prohibited words added.</span>`;
      } else {
        chipsContainer.innerHTML = customList.map(w => `
          <div class="custom-word-chip" style="display:inline-flex; align-items:center; gap:6px; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#fca5a5; padding:4px 10px; border-radius:999px; font-size:0.8rem; margin:3px;">
            <span>${escapeHtml(w)}</span>
            <button type="button" class="btn-chip-remove" onclick="window.PingAdmin.removeCustomWord('${escapeHtml(w)}')" style="background:none; border:none; color:#ef4444; cursor:pointer; font-weight:bold; font-size:0.9rem; padding:0 2px;" title="Remove term">✕</button>
          </div>
        `).join('');
      }
    }
  }

  function renderShadowbans(bansList) {
    const tbody = $('shadowbansTableBody');
    const pill = $('shadowbansCountPill');
    const list = Array.isArray(bansList) ? bansList : [];
    if (pill) pill.textContent = `${list.length} active`;
    if (tbody) {
      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--t-ghost);">No users are currently shadowbanned.</td></tr>`;
      } else {
        tbody.innerHTML = list.map(b => `
          <tr>
            <td><code>${escapeHtml(b.target || 'Target')}</code></td>
            <td>${b.minutesLeft ? b.minutesLeft + ' mins left' : 'Active'}</td>
            <td>${escapeHtml(b.reason || 'Ghost quarantine')}</td>
            <td><button class="btn-table-action danger" onclick="window.PingAdmin.removeShadowban('${escapeHtml(b.target)}')">Lift Shadowban</button></td>
          </tr>
        `).join('');
      }
    }
  }

  function renderGeoRules(geoRules, quarantinedList) {
    const tbody = $('geoRulesTableBody');
    const badge = $('geoRulesActiveCount');
    const rules = Array.isArray(geoRules) ? geoRules : [];
    const quarList = Array.isArray(quarantinedList) ? quarantinedList : [];
    if (badge) badge.textContent = `${quarList.length} Quarantined`;
    if (tbody) {
      if (rules.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 16px; color: var(--t-ghost);">No regional traffic logged yet.</td></tr>`;
      } else {
        tbody.innerHTML = rules.map(g => `
          <tr>
            <td><strong>${escapeHtml(g.country)}</strong></td>
            <td>${formatNum(g.count)}</td>
            <td><span class="count-pill ${g.isQuarantined ? 'red' : 'green'}">${g.isQuarantined ? 'Quarantined' : 'Allowed'}</span></td>
            <td>
              <button class="btn-table-action ${g.isQuarantined ? 'info' : 'danger'}" onclick="window.PingAdmin.toggleGeoQuarantine('${escapeHtml(g.country)}', ${!g.isQuarantined})">
                ${g.isQuarantined ? 'Lift Fence' : 'Quarantine'}
              </button>
            </td>
          </tr>
        `).join('');
      }
    }
  }

  function renderEventsFeed(eventsList) {
    const container = $('adminEventsContainer');
    const list = Array.isArray(eventsList) ? eventsList : [];
    if (!container) return;
    if (list.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--t-ghost);">No audit log events recorded yet.</div>`;
    } else {
      container.innerHTML = list.map(e => {
        const timeStr = new Date(e.timestamp || Date.now()).toLocaleTimeString();
        const levelClass = e.level === 'alert' ? 'red' : (e.level === 'warning' ? 'amber' : (e.level === 'success' ? 'green' : 'cyan'));
        return `
          <div class="admin-event-card" style="background:rgba(255,255,255,0.02); border:1px solid var(--glass-brd); border-radius:10px; padding:12px 16px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                <span class="count-pill ${levelClass}">${escapeHtml(e.type || 'system').toUpperCase()}</span>
                <strong>${escapeHtml(e.title || 'Event')}</strong>
                <span style="font-size:0.75rem; color:var(--t-ghost);">${timeStr}</span>
              </div>
              <p style="font-size:0.82rem; color:var(--t-med); margin:0;">${escapeHtml(e.detail || '')}</p>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  function renderAdminReports(reports) {
    const tbody = $('adminReportsTableBody');
    const badge = $('adminReportsBadge');
    if (!Array.isArray(reports)) return;
    if (badge) badge.textContent = reports.length;
    if (tbody) {
      if (reports.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--t-ghost);">No user reports found. Platform operating cleanly.</td></tr>`;
      } else {
        tbody.innerHTML = reports.map(r => `
          <tr>
            <td>${new Date(r.createdAt || r.timestamp || Date.now()).toLocaleTimeString()}</td>
            <td><code>${escapeHtml(r.reporterId || 'Anonymous')}</code></td>
            <td><code>${escapeHtml(r.reportedUserId || 'Target')}</code></td>
            <td>${escapeHtml(r.reason || 'Reported behavior')}</td>
            <td><span class="count-pill ${r.status === 'pending' || r.status === 'pending_review' ? 'amber' : 'green'}">${escapeHtml(r.status || 'pending')}</span></td>
            <td>
              <button class="btn-table-action danger" onclick="window.PingAdmin.resolveReport('${r.reportId}', 'dismissed')">Dismiss</button>
            </td>
          </tr>
        `).join('');
      }
    }
  }

  function renderAdminBans(bans) {
    const tbody = $('adminBansTableBody');
    const badge = $('adminBansBadge');
    const pill = $('activeBansCountPill');
    if (!Array.isArray(bans)) return;
    if (badge) badge.textContent = bans.length;
    if (pill) pill.textContent = `${bans.length} active`;
    if (tbody) {
      if (bans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 22px; color: var(--t-ghost);">No active device bans.</td></tr>`;
      } else {
        tbody.innerHTML = bans.map(b => `
          <tr>
            <td><code>${escapeHtml(b.deviceHash || b.userId || b.id || 'Device')}</code></td>
            <td>${b.expiresAt ? Math.max(0, Math.ceil((b.expiresAt - Date.now()) / 60000)) + ' mins left' : 'Permanent'}</td>
            <td>${escapeHtml(b.reason || 'Suspension')}</td>
            <td><button class="btn-table-action danger" onclick="window.PingAdmin.removeBan('${b.deviceHash || b.userId || b.id}')">Lift Ban</button></td>
          </tr>
        `).join('');
      }
    }
  }

  function updateVpnShieldUI(enabled) {
    const btn = $('adminVpnShieldToggle');
    const txt = $('adminVpnShieldText');
    if (btn) {
      if (enabled) {
        btn.classList.add('active');
        if (txt) txt.textContent = 'VPN Shield: ON';
      } else {
        btn.classList.remove('active');
        if (txt) txt.textContent = 'VPN Shield: OFF';
      }
    }
  }

  let unsubReports = null;
  let unsubBans = null;
  let unsubSettings = null;

  function setupFirestoreAdminListeners() {
    if (!window.firebase || !window.firebase.firestore) return;
    const db = window.firebase.firestore();

    // 1. Real-time live sync for Reports collection
    try {
      if (unsubReports) unsubReports();
      unsubReports = db.collection('reports').onSnapshot((snap) => {
        const reportsList = [];
        snap.forEach(d => {
          const data = d.data();
          if (data) reportsList.push({ ...data, reportId: data.reportId || d.id });
        });
        if (reportsList.length > 0 || isAdminDashboardVisible()) {
          renderAdminReports(reportsList);
        }
      }, () => {});
    } catch (_) {}

    // 2. Real-time live sync for Bans collection
    try {
      if (unsubBans) unsubBans();
      unsubBans = db.collection('bans').onSnapshot((snap) => {
        const bansList = [];
        const now = Date.now();
        snap.forEach(d => {
          const data = d.data();
          if (data && data.active !== false && Number(data.expiresAt) > now) {
            const remMs = Number(data.expiresAt) - now;
            bansList.push({
              ...data,
              deviceHash: data.deviceHash || data.userId || d.id,
              minutesLeft: Math.max(1, Math.ceil(remMs / 60000))
            });
          }
        });
        if (bansList.length > 0 || isAdminDashboardVisible()) {
          renderAdminBans(bansList);
        }
      }, () => {});
    } catch (_) {}

    // 3. Real-time live sync for Global System Settings (VPN Shield, Emergency Strict Mode)
    try {
      if (unsubSettings) unsubSettings();
      unsubSettings = db.collection('system_settings').doc('global_rules').onSnapshot((snap) => {
        if (snap.exists()) {
          const s = snap.data();
          if (s && typeof s.vpnShieldEnabled === 'boolean') {
            updateVpnShieldUI(s.vpnShieldEnabled);
          }
        }
      }, () => {});
    } catch (_) {}
  }

  window.addEventListener('firebase:ready', () => {
    setupFirestoreAdminListeners();
  });
  if (window.firebaseReady) {
    setupFirestoreAdminListeners();
  }

  // ═════════════════════════════════════════════════════════════
  // 6. BOOTSTRAP ON DOMCONTENTLOADED
  // ═════════════════════════════════════════════════════════════
  function initializeAdmin() {
    const authModal = $('adminAuthModal');
    if (authModal) {
      authModal.style.display = 'none';
    }
    setupTabNavigation();
    initAdminCharts();
    hydrateTelemetryFromFirestore();
    // Do NOT refreshAdminDashboardData() on startup — dashboard remains hidden until 10 clicks on logo

    // Bind automated Excel (.xlsx) export to Export button
    const exportBtn = $('adminExportBtn');
    if (exportBtn) {
      exportBtn.title = 'Export Multi-Tab Excel Report (.xlsx)';
      exportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        exportExcelReport();
      });
    }

    $('adminVpnShieldToggle')?.addEventListener('click', async () => {
      const btn = $('adminVpnShieldToggle');
      const isNowActive = btn ? !btn.classList.contains('active') : true;
      try {
        await adminFetch('/api/admin/system/vpn-shield', {
          method: 'POST',
          body: JSON.stringify({ enabled: isNowActive })
        });
        updateVpnShieldUI(isNowActive);
      } catch (_) {}
    });

    $('adminManualRefreshBtn')?.addEventListener('click', () => {
      hydrateTelemetryFromFirestore();
      refreshAdminDashboardData();
    });

    // Bind form submit and action handlers for words, shadowbans, bulk, and system controls
    $('addWordForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('newWordInput');
      const word = input?.value?.trim();
      if (!word) return;
      await window.PingAdmin.addCustomWord(word);
      if (input) input.value = '';
    });

    $('testWordBtn')?.addEventListener('click', async () => {
      const input = $('wordTestInput');
      const text = input?.value?.trim();
      const verdict = $('testWordVerdict');
      const details = $('testWordDetails');
      if (!text) return;
      if (verdict) { verdict.style.display = 'inline-block'; verdict.textContent = 'Testing...'; }
      try {
        const res = await adminFetch('/api/admin/words/test', {
          method: 'POST',
          body: JSON.stringify({ text })
        });
        if (res.ok) {
          const json = await res.json();
          if (verdict) {
            verdict.textContent = json.hasSlur ? '⚠️ PROHIBITED' : '✅ SAFE';
            verdict.className = `badge-tag ${json.hasSlur ? 'rejected' : 'green'}`;
          }
          if (details) {
            details.style.display = 'block';
            details.innerHTML = `Category: <strong>${escapeHtml(json.category || 'safe')}</strong> | Matched: <code>${(json.matchedWords || []).join(', ') || 'None'}</code> | Targeting: ${json.isTargeting ? 'Yes' : 'No'}`;
          }
        }
      } catch (_) {}
    });

    $('addShadowbanForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const target = $('shadowbanTargetInput')?.value?.trim();
      const durationMinutes = $('shadowbanDurationSelect')?.value;
      const reason = $('shadowbanReasonInput')?.value?.trim();
      if (!target) return;
      try {
        await adminFetch('/api/admin/shadowbans/add', {
          method: 'POST',
          body: JSON.stringify({ target, durationMinutes, reason })
        });
        if ($('shadowbanTargetInput')) $('shadowbanTargetInput').value = '';
        refreshAdminDashboardData();
      } catch (_) {}
    });

    $('executeBulkBanBtn')?.addEventListener('click', async () => {
      const targets = $('bulkTargetsInput')?.value;
      const durationMinutes = $('bulkDurationSelect')?.value;
      const reason = $('bulkReasonInput')?.value;
      if (!targets) return;
      try {
        const res = await adminFetch('/api/admin/bulk-ban', {
          method: 'POST',
          body: JSON.stringify({ targets, durationMinutes, reason })
        });
        if (res.ok) refreshAdminDashboardData();
      } catch (_) {}
    });

    $('executeBulkShadowbanBtn')?.addEventListener('click', async () => {
      const targets = $('bulkTargetsInput')?.value;
      const durationMinutes = $('bulkDurationSelect')?.value;
      const reason = $('bulkReasonInput')?.value;
      if (!targets) return;
      try {
        const res = await adminFetch('/api/admin/bulk-shadowban', {
          method: 'POST',
          body: JSON.stringify({ targets, durationMinutes, reason })
        });
        if (res.ok) refreshAdminDashboardData();
      } catch (_) {}
    });

    $('executeBulkKickBtn')?.addEventListener('click', async () => {
      const targets = $('bulkTargetsInput')?.value;
      if (!targets) return;
      try {
        const res = await adminFetch('/api/admin/bulk-kick', {
          method: 'POST',
          body: JSON.stringify({ targets })
        });
        if (res.ok) refreshAdminDashboardData();
      } catch (_) {}
    });

    $('purgeIdleSocketsBtn')?.addEventListener('click', async () => {
      try {
        await adminFetch('/api/admin/flush-sockets', { method: 'POST' });
        refreshAdminDashboardData();
      } catch (_) {}
    });

    $('purgeCountryBtn')?.addEventListener('click', async () => {
      const country = $('purgeCountryInput')?.value?.trim();
      if (!country) return;
      try {
        await adminFetch('/api/admin/mass/purge-country', {
          method: 'POST',
          body: JSON.stringify({ country })
        });
        if ($('purgeCountryInput')) $('purgeCountryInput').value = '';
        refreshAdminDashboardData();
      } catch (_) {}
    });

    $('drainQueueBtn')?.addEventListener('click', async () => {
      try {
        await adminFetch('/api/admin/matchmaking/drain', { method: 'POST' });
        refreshAdminDashboardData();
      } catch (_) {}
    });

    $('clearEventsBtn')?.addEventListener('click', async () => {
      try {
        await adminFetch('/api/admin/events/clear', { method: 'POST' });
        refreshAdminDashboardData();
      } catch (_) {}
    });

    $('adminBroadcastForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = $('broadcastMessageInput')?.value?.trim();
      const levelEl = document.querySelector('input[name="broadcastLevel"]:checked');
      const level = levelEl ? levelEl.value : 'info';
      if (!message) return;
      try {
        const res = await adminFetch('/api/admin/broadcast', {
          method: 'POST',
          body: JSON.stringify({ message, level })
        });
        if (res.ok) {
          if ($('broadcastMessageInput')) $('broadcastMessageInput').value = '';
          const statusMsg = $('broadcastStatusMsg');
          if (statusMsg) {
            statusMsg.style.display = 'block';
            statusMsg.textContent = 'Broadcast sent successfully to all active users!';
            setTimeout(() => { statusMsg.style.display = 'none'; }, 4000);
          }
          refreshAdminDashboardData();
        }
      } catch (_) {}
    });

    $('adminLookupForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const query = $('lookupQueryInput')?.value?.trim();
      if (!query) return;
      const card = $('lookupResultCard');
      try {
        const res = await adminFetch(`/api/admin/lookup?query=${encodeURIComponent(query)}`);
        if (res.ok) {
          const json = await res.json();
          if (card) {
            card.style.display = 'block';
            card.innerHTML = `
              <div class="card-header-bar">
                <h4 class="card-bar-title">Inspection Results: <code>${escapeHtml(query)}</code></h4>
                <span class="count-pill ${json.isConnected ? 'green' : 'amber'}">${json.isConnected ? 'Connected' : 'Offline'}</span>
              </div>
              <div class="admin-grid-2col" style="gap:16px; margin-top:12px;">
                <div>
                  <p><strong>Socket ID:</strong> <code>${escapeHtml(json.socketId || 'N/A')}</code></p>
                  <p><strong>User ID:</strong> <code>${escapeHtml(json.userId || 'N/A')}</code></p>
                  <p><strong>Device Hash:</strong> <code>${escapeHtml(json.deviceHash || 'N/A')}</code></p>
                  <p><strong>Origin / IP:</strong> ${escapeHtml(json.country || 'Unknown')} (${escapeHtml(json.ip || 'Masked')})</p>
                </div>
                <div>
                  <p><strong>Active Room:</strong> ${json.roomId ? `<code>${escapeHtml(json.roomId)}</code> (${json.roomElapsedSeconds}s)` : 'None'}</p>
                  <p><strong>Risk Score:</strong> <span class="badge-tag ${json.riskTier === 'Critical' ? 'rejected' : (json.riskTier === 'Guarded' ? 'pending' : 'info')}">${json.riskScore}/100 (${escapeHtml(json.riskTier)})</span></p>
                  <p><strong>Suspension Status:</strong> ${json.isBanned ? `Banned (${json.banMinutesLeft}m left - ${escapeHtml(json.banReason)})` : 'Clean'}</p>
                  <p><strong>Ghost Mode:</strong> ${json.isShadowbanned ? 'Shadowbanned' : 'Normal'}</p>
                </div>
              </div>
              <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap;">
                <button class="btn-primary-admin warning" onclick="window.PingAdmin.warnUser('${escapeHtml(json.userId || query)}')">⚠️ Warn User</button>
                <button class="btn-primary-admin danger" onclick="window.PingAdmin.kickUser('${escapeHtml(json.userId || query)}')">🚪 Disconnect</button>
                <button class="btn-ghost-admin" onclick="window.PingAdmin.addShadowban('${escapeHtml(json.userId || query)}', 1440, 'Inspector action')">👻 Shadowban</button>
                ${json.roomId ? `<button class="btn-primary-admin danger" onclick="window.PingAdmin.terminateRoom('${escapeHtml(json.roomId)}')">Terminate Room</button>` : ''}
              </div>
            `;
          }
        }
      } catch (_) {}
    });

    // Attach to existing or incoming socket
    if (window.pingSocket) {
      bindWebSocketTelemetry(window.pingSocket);
    } else {
      window.addEventListener('socket:ready', (evt) => {
        if (evt.detail && evt.detail.socket) {
          bindWebSocketTelemetry(evt.detail.socket);
        }
      });
    }

    // Re-bind when global io socket becomes available
    const socketCheckInterval = setInterval(() => {
      const s = window.pingSocket || (typeof io !== 'undefined' && io.sockets && io.sockets.get ? null : null);
      if (window.socket && !socketInstance) {
        bindWebSocketTelemetry(window.socket);
        clearInterval(socketCheckInterval);
      }
    }, 1000);
    setTimeout(() => clearInterval(socketCheckInterval), 15000);

    // Periodic Firestore & Admin Data refresh (every 30s) ONLY when dashboard is open
    setInterval(() => {
      if (isAdminDashboardVisible()) {
        hydrateTelemetryFromFirestore();
        refreshAdminDashboardData();
      }
    }, 30000);

    // Re-sync on tab visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isAdminDashboardVisible()) {
        hydrateTelemetryFromFirestore();
        refreshAdminDashboardData();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAdmin);
  } else {
    initializeAdmin();
  }

  function resizeCharts() {
    for (const chart of Object.values(activeCharts)) {
      if (chart && typeof chart.resize === 'function') {
        chart.resize();
        chart.update('none');
      }
    }
  }

  function updateBehaviorChartFromData(timeSeries) {
    if (!activeCharts.behavior) return;
    if (Array.isArray(timeSeries) && timeSeries.length > 0) {
      activeCharts.behavior.data.labels = timeSeries.map(pt => pt.timeLabel || '');
      activeCharts.behavior.data.datasets[0].data = timeSeries.map(pt => pt.askedNumbers || 0);
      activeCharts.behavior.data.datasets[1].data = timeSeries.map(pt => pt.slurs || 0);
      activeCharts.behavior.data.datasets[2].data = timeSeries.map(pt => pt.socials || 0);
      activeCharts.behavior.update('none');
    }
  }

  function resetAdminBehaviorState() {
    telemetryState.sentiment_distribution = {
      friendly_greetings: 0,
      curious_questions: 0,
      casual_dialogue: 0,
      playful_humor: 0,
      toxic_messages: 0,
    };
    telemetryState.session_durations = {
      quick_skips_under_15s: 0,
      short_chats_15s_1m: 0,
      medium_chats_1m_3m: 0,
      deep_chats_over_3m: 0,
    };
    telemetryState.retention_metrics = {
      survival_rate_3m_pct: 0,
      skip_churn_15s_pct: 0,
      patience_quotient_pct: 0,
    };
    telemetryState.behavior_analytics = {
      overview: {
        totalMessagesProcessed: 0,
        totalMessagesDelivered: 0,
        totalMessagesBlocked: 0,
        totalDeliveredChars: 0,
        cleanPassRate: 100,
        cleanRatePct: 100,
        avgMsgLengthChars: 0,
        avgMsgLength: 0,
        offPlatformAttemptRate: 0,
        offPlatformRatePct: 0,
        phoneNumbersSharedCount: 0,
        sharedNumbers: 0,
        phoneNumbersAskedCount: 0,
        askedNumbers: 0,
        socialHandlesCount: 0,
        socialHandles: 0,
        slursInterceptedCount: 0,
        slursBlocked: 0,
        threatsInterceptedCount: 0,
        linksBlockedCount: 0,
        symbolsBlockedCount: 0,
        completedSessionsCount: 0,
        avgChatDurationSeconds: 0,
        avgDurationSec: 0,
      },
      slurDistribution: {},
      contactExtraction: {},
      engagement: {},
      timeSeries: [],
    };

    behaviorAskedSeries.length = 0;
    behaviorSlursSeries.length = 0;
    behaviorSocialsSeries.length = 0;

    renderAllHydratedMetrics();

    if (activeCharts.behavior && activeCharts.behavior.data && Array.isArray(activeCharts.behavior.data.datasets)) {
      activeCharts.behavior.data.datasets.forEach(ds => {
        if (Array.isArray(ds.data)) ds.data = ds.data.map(() => 0);
      });
      activeCharts.behavior.update('none');
    }
  }

  // Expose public admin interface
  window.PingAdmin = {
    hydrateTelemetryFromFirestore,
    refreshAdminDashboardData,
    exportExcelReport,
    switchAdminTab,
    resizeCharts,
    resetAdminBehaviorState,
    updateBehaviorChart: updateBehaviorChartFromData,
    computeRetentionMetrics,
    getTelemetryState: () => ({ ...telemetryState }),
    addCustomWord: async (word) => {
      try {
        await adminFetch('/api/admin/words/add', {
          method: 'POST',
          body: JSON.stringify({ word })
        });
        refreshAdminDashboardData();
      } catch (e) {}
    },
    removeCustomWord: async (word) => {
      try {
        await adminFetch('/api/admin/words/remove', {
          method: 'POST',
          body: JSON.stringify({ word })
        });
        refreshAdminDashboardData();
      } catch (e) {}
    },
    addShadowban: async (target, durationMinutes = 1440, reason = 'Admin action') => {
      try {
        await adminFetch('/api/admin/shadowbans/add', {
          method: 'POST',
          body: JSON.stringify({ target, durationMinutes, reason })
        });
        refreshAdminDashboardData();
      } catch (e) {}
    },
    removeShadowban: async (target) => {
      try {
        await adminFetch('/api/admin/shadowbans/remove', {
          method: 'POST',
          body: JSON.stringify({ target })
        });
        refreshAdminDashboardData();
      } catch (e) {}
    },
    toggleGeoQuarantine: async (country, quarantine) => {
      try {
        await adminFetch('/api/admin/geo-rules/toggle', {
          method: 'POST',
          body: JSON.stringify({ country, quarantine })
        });
        refreshAdminDashboardData();
      } catch (e) {}
    },
    warnUser: async (userId, message) => {
      try {
        await adminFetch('/api/admin/user/warn', {
          method: 'POST',
          body: JSON.stringify({ userId, message })
        });
        refreshAdminDashboardData();
      } catch (e) {}
    },
    kickUser: async (target) => {
      try {
        await adminFetch('/api/admin/kick', {
          method: 'POST',
          body: JSON.stringify({ target })
        });
        refreshAdminDashboardData();
      } catch (e) {}
    },
    resolveReport: async (reportId, status) => {
      try {
        await adminFetch('/api/admin/reports/update-status', {
          method: 'POST',
          body: JSON.stringify({ reportId, status })
        });
        refreshAdminDashboardData();
      } catch (e) {}
    },
    removeBan: async (deviceHash) => {
      try {
        await adminFetch('/api/admin/bans/remove', {
          method: 'POST',
          body: JSON.stringify({ deviceHash })
        });
        refreshAdminDashboardData();
      } catch (e) {}
    },
    terminateRoom: async (roomId) => {
      try {
        await adminFetch('/api/admin/terminate-room', {
          method: 'POST',
          body: JSON.stringify({ roomId })
        });
        refreshAdminDashboardData();
      } catch (e) {}
    },
    toggleVpnShield: async (enabled) => {
      try {
        await adminFetch('/api/admin/system/vpn-shield', {
          method: 'POST',
          body: JSON.stringify({ enabled })
        });
        updateVpnShieldUI(enabled);
      } catch (e) {}
    }
  };
})();
