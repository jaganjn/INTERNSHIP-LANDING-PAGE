
document.body.style.visibility = "hidden";

const ACTIVE_MS = 90_000;
const ABANDON_MS = 150_000;
const RETAIN_MS = 24 * 60 * 60 * 1000;
const ALERT_STORAGE_KEY = "apexAdminAlertSettingsV3";
const LEGACY_ALERT_STORAGE_KEY = "apexAdminAlertSettingsV2";
const BROWSER_ALERT_STORAGE_KEY = "apexAdminBrowserAlertsV1";
const SEEN_APPLICATIONS_KEY = "apexAdminSeenApplicationsV1";
const PUSH_TOKEN_STORAGE_KEY = "apexAdminPushTokenV1";
const COUNSELOR_STORAGE_KEY = "internsforgeCounselorsV1";
const CALL_STATUSES = [
  "Not Contacted",
  "New",
  "Connected",
  "Callback",
  "Details Shared",
  "Follow-up",
  "Interested",
  "Not Interested",
  "Not Picking",
  "Paid / Pre-Reg",
  "Enrolled",
  "RNR",
  "Invalid Number"
];

const CALL_STATUS_ALIASES = {
  "Called": "Connected",
  "Call Back": "Callback",
  "CallBack": "Callback",
  "Selected": "Paid / Pre-Reg",
  "Joined": "Enrolled",
  "Not Reachable": "Not Picking"
};

function normalizeCallStatus(status) {
  const raw = String(status || "").trim();
  if (!raw) return "Not Contacted";
  return CALL_STATUS_ALIASES[raw] || raw;
}

function renderCallStatusOptions(selected = "") {
  const normalized = normalizeCallStatus(selected);
  return CALL_STATUSES.map(status => `<option value="${esc(status)}" ${status === normalized ? "selected" : ""}>${esc(status)}</option>`).join("");
}


const el = id => document.getElementById(id);
const E = {
  visitorList: el("visitorList"),
  onlineCount: el("onlineCount"),
  fillingCount: el("fillingCount"),
  submittedCount: el("submittedCount"),
  abandonedCount: el("abandonedCount"),
  conversionRate: el("conversionRate"),
  recentApplications: el("recentApplications"),
  topColleges: el("topColleges"),
  topDomains: el("topDomains"),
  applicationsChart: el("applicationsChart"),
  totalReferralCodes: el("totalReferralCodes"),
  successfulReferrals: el("successfulReferrals"),
  referralConversionRate: el("referralConversionRate"),
  topAmbassador: el("topAmbassador"),
  topAmbassadorCount: el("topAmbassadorCount"),
  referralLeaderboardBody: el("referralLeaderboardBody"),
  referralFriendsBody: el("referralFriendsBody"),
  referralSearch: el("referralSearch"),
  applicationVisitorCount: el("applicationVisitorCount"),
  applicationVisitorCountMetric: el("applicationVisitorCountMetric"),
  landingPageVisitorCountMetric: el("landingPageVisitorCountMetric")
};

let applications = [];
let visitors = {};
let referralProfiles = {};
let referralJoins = {};
let friendRows = [];
let started = false;
let initialApplicationSnapshotLoaded = false;
let soundUnlocked = false;
let audioContext = null;
let refreshInProgress = false;
let crmFilteredApplications = [];
let activeApplicationId = null;
let counselorNames = [];
let selectedApplicationIds = new Set();

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
}[char]));

const IST_TIME_ZONE = "Asia/Kolkata";

const asMs = value => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.seconds === "number") return value.seconds * 1000;
  }

  const raw = String(value || "").trim();
  if (!raw) return 0;

  // Legacy landing-page records used en-IN strings such as DD/MM/YYYY, HH:MM:SS.
  // Parse this format first so JavaScript cannot reinterpret 05/09/YYYY as MM/DD/YYYY.
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\s*([AP]M))?)?)?$/i);
  if (match) {
    let [, dd, mm, yyyy, hh = "0", min = "0", sec = "0", ampm] = match;
    let hour = Number(hh);
    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === "PM" && hour < 12) hour += 12;
      if (upper === "AM" && hour === 12) hour = 0;
    }
    // Interpret legacy local timestamps as IST.
    const utc = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), hour, Number(min), Number(sec));
    return utc - (5 * 60 + 30) * 60 * 1000;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getISTDateKey = value => {
  const timestamp = asMs(value);
  if (!timestamp) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp));
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
};

const getTodayISTKey = () => {
  const now = new Date();
  return getISTDateKey(now.getTime());
};

const fmt = value => {
  const timestamp = asMs(value);
  return timestamp
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: IST_TIME_ZONE,
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
      }).format(new Date(timestamp))
    : "—";
};

const isToday = value => {
  const timestamp = asMs(value);
  return timestamp ? getISTDateKey(timestamp) === getTodayISTKey() : false;
};

function getAlertSettings() {
  const defaults = { enabled: true, volume: 90 };
  try {
    // Keep the notification sound preference in persistent localStorage.
    // If no preference exists yet, sound is ON by default.
    let raw = localStorage.getItem(ALERT_STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_ALERT_STORAGE_KEY);
      if (raw) localStorage.setItem(ALERT_STORAGE_KEY, raw);
    }
    if (!raw) return defaults;

    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== false,
      volume: Math.min(100, Math.max(0, Number(parsed.volume ?? defaults.volume) || defaults.volume))
    };
  } catch {
    return defaults;
  }
}

function saveAlertSettings(settings) {
  const normalized = {
    enabled: settings?.enabled === true,
    volume: Math.min(100, Math.max(0, Number(settings?.volume ?? 90) || 90))
  };
  try {
    localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // If storage is unavailable, keep the current in-memory UI state.
  }
  return normalized;
}

function getSeenApplicationIds() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SEEN_APPLICATIONS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveSeenApplicationIds(ids) {
  sessionStorage.setItem(SEEN_APPLICATIONS_KEY, JSON.stringify([...ids].slice(-1000)));
}

function showToast(title, message = "", type = "info", duration = 4200) {
  const region = el("adminToastRegion");
  if (!region) return;

  const toast = document.createElement("article");
  toast.className = `admin-toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === "success" ? "✓" : type === "error" ? "!" : "i"}</span>
    <div><strong>${esc(title)}</strong>${message ? `<small>${esc(message)}</small>` : ""}</div>
    <button type="button" aria-label="Dismiss">×</button>
  `;
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));

  const remove = () => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 250);
  };
  toast.querySelector("button").addEventListener("click", remove);
  window.setTimeout(remove, duration);
}

function updateStamp(label = "Updated") {
  const target = el("lastUpdatedText");
  if (!target) return;
  target.textContent = `${label} ${new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(new Date())}`;
}

function sessionState(visitor = {}, now = Date.now()) {
  const status = String(visitor.status || "").toLowerCase();
  if (status === "submitted" || visitor.presence === "completed") return "submitted";

  const activity = asMs(visitor.lastActive) || Number(visitor.clientLastActive) || asMs(visitor.startedAt);
  const age = activity ? Math.max(0, now - activity) : Number.POSITIVE_INFINITY;
  const progress = Math.max(0, Number(visitor.formProgress || 0));
  const disconnected = ["inactive", "disconnected"].includes(String(visitor.presence || "").toLowerCase());
  const explicitlyFilling = ["filling_form", "filling", "reviewing"].includes(status);
  const hasStartedFilling = visitor.hasStartedFilling === true || progress > 0;

  if (age <= ACTIVE_MS && !disconnected) {
    return (hasStartedFilling && explicitlyFilling) || progress > 0 ? "filling" : "active";
  }
  if (hasStartedFilling || explicitlyFilling) return "abandoned";
  return "left";
}

function visitorCard(visitor, inactive = false) {
  const stateLabel = visitor.state === "filling" ? "Filling" :
    visitor.state === "abandoned" ? "Abandoned While Filling" :
    visitor.state === "left" ? "Viewer Left" : "Active Viewer";
  const displayName = visitor.fieldData?.name || visitor.name || "Anonymous Visitor";
  const displayCollege = visitor.fieldData?.college || visitor.college || visitor.page || "Application Portal";
  const lastField = visitor.currentField || (visitor.state === "left" ? "Viewing Page" : "Application form");

  return `
    <article class="visitor-card ${inactive ? "inactive-session" : ""}">
      <div class="visitor-top">
        <div>
          <strong>${esc(displayName)}</strong>
          <small>${esc(displayCollege)}</small>
        </div>
        <span class="status ${visitor.state}">${stateLabel}</span>
      </div>
      <div class="progress-bar"><span style="width:${Math.min(100, Number(visitor.formProgress || 0))}%"></span></div>
      <div class="visitor-meta">
        <span>Progress: ${Number(visitor.formProgress || 0)}%</span>
        <span>Last field: ${esc(lastField)} ${visitor.currentStep ? `• Step ${esc(visitor.currentStep)}` : ""}</span>
        <span>Last active: ${fmt(visitor.lastActive || visitor.leftAt || visitor.disconnectedAt)}</span>
      </div>
      ${inactive && visitor.exitReason ? `<p class="session-exit-reason">${esc(visitor.exitReason)}</p>` : ""}
      <div class="live-field-grid">
        <div><small>Full Name</small><strong>${esc(visitor.fieldData?.name || visitor.name || "—")}</strong></div>
        <div><small>WhatsApp</small><strong>${esc(visitor.fieldData?.phone || visitor.phone || "—")}</strong></div>
        <div><small>Email</small><strong>${esc(visitor.fieldData?.email || visitor.email || "—")}</strong></div>
        <div><small>College</small><strong>${esc(visitor.fieldData?.college || visitor.college || "—")}</strong></div>
        <div><small>Department</small><strong>${esc(visitor.fieldData?.department || visitor.department || "—")}</strong></div>
        <div><small>Year</small><strong>${esc(visitor.fieldData?.year || visitor.year || "—")}</strong></div>
        <div><small>Domain</small><strong>${esc(visitor.fieldData?.domain || visitor.domain || "—")}</strong></div>
        <div><small>Consent</small><strong>${(visitor.fieldData?.consent ?? false) ? "Accepted" : "Not accepted"}</strong></div>
      </div>
    </article>`;
}

function renderVisitors() {
  const now = Date.now();
  const rows = Object.entries(visitors)
    .map(([id, visitor]) => ({ id, ...visitor, state: sessionState(visitor, now) }))
    .sort((a, b) => asMs(b.lastActive || b.leftAt) - asMs(a.lastActive || a.leftAt));

  const active = rows.filter(visitor => visitor.state === "active" || visitor.state === "filling");
  const filling = rows.filter(visitor => visitor.state === "filling");
  const abandoned = rows.filter(visitor => visitor.state === "abandoned");
  const recentInactive = rows.filter(visitor => ["abandoned", "left"].includes(visitor.state)).slice(0, 20);

  const todayKey = getTodayISTKey();
  const todayApplications = applications.filter(app =>
    getISTDateKey(app.submittedAtMs || app.submittedAt) === todayKey
  );
  const todaySessions = rows.filter(visitor =>
    getISTDateKey(visitor.startedAt) === todayKey
  );

  E.onlineCount.textContent = active.length;
  E.fillingCount.textContent = filling.length;
  E.abandonedCount.textContent = abandoned.length;
  E.submittedCount.textContent = todayApplications.length;

  const sessionDenominator = Math.max(todaySessions.length, todayApplications.length);
  E.conversionRate.textContent = sessionDenominator
    ? `${Math.min(100, Math.round((todayApplications.length / sessionDenominator) * 100))}%`
    : "0%";

  const activeMarkup = active.length
    ? active.map(visitor => visitorCard(visitor)).join("")
    : '<p class="empty">No active visitors right now.</p>';

  const inactiveMarkup = recentInactive.length
    ? `<div class="inactive-session-heading"><strong>Recent exits and incomplete applications</strong><small>Saved for follow-up for up to 24 hours</small></div>${recentInactive.map(visitor => visitorCard(visitor, true)).join("")}`
    : "";

  E.visitorList.innerHTML = activeMarkup + inactiveMarkup;
  updateStamp();
}

async function cleanupStale({ removeAbandoned = false } = {}) {
  const now = Date.now();
  const updates = {};

  Object.entries(visitors).forEach(([id, visitor]) => {
    if (visitor.status === "submitted") return;
    const age = now - asMs(visitor.lastActive || visitor.clientLastActive);
    const progress = Number(visitor.formProgress || 0);
    const hasStartedFilling = visitor.hasStartedFilling === true || progress > 0;

    if (removeAbandoned && age > ABANDON_MS) {
      updates[id] = null;
      return;
    }
    if (age > RETAIN_MS) {
      updates[id] = null;
    } else if (age > ABANDON_MS && hasStartedFilling) {
      updates[`${id}/status`] = "abandoned";
      updates[`${id}/presence`] = "inactive";
      updates[`${id}/abandonedAt`] = firebase.database.ServerValue.TIMESTAMP;
    } else if (age > ABANDON_MS && progress === 0) {
      updates[`${id}/status`] = "left";
      updates[`${id}/presence`] = "inactive";
      if (!visitor.leftAt) updates[`${id}/leftAt`] = firebase.database.ServerValue.TIMESTAMP;
    }
  });

  if (Object.keys(updates).length) {
    await db.ref("liveVisitors").update(updates);
  }

  return Object.values(updates).filter(value => value === null).length;
}

function renderRank(target, map) {
  const rows = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = rows[0]?.[1] || 1;

  target.innerHTML = rows.length
    ? rows.map(([name, count]) => `
      <div class="rank-item">
        <div class="rank-row"><strong>${esc(name)}</strong><small>${count}</small></div>
        <div class="rank-track"><i style="width:${(count / max) * 100}%"></i></div>
      </div>
    `).join("")
    : '<p class="empty">No data yet.</p>';
}

function renderApplications(newIds = new Set()) {
  const college = {};
  const domain = {};
  const daily = {};

  applications.forEach(app => {
    if (app.college) college[app.college] = (college[app.college] || 0) + 1;
    if (app.domain) domain[app.domain] = (domain[app.domain] || 0) + 1;
    const timestamp = asMs(app.submittedAtMs || app.submittedAt || app.timestamp);
    if (timestamp) {
      const key = getISTDateKey(timestamp);
      daily[key] = (daily[key] || 0) + 1;
    }
  });

  E.recentApplications.innerHTML = applications.slice(0, 8).map(app => `
    <article class="application-item ${newIds.has(app.id) ? "new-application" : ""}">
      <div class="application-top">
        <div><strong>${esc(app.name || "Unknown")}</strong><small>${esc(app.college || "—")} • ${esc(app.domain || "—")}</small></div>
        <span class="status submitted">${esc(app.callStatus || "Not Contacted")}</span>
      </div>
      <small>${fmt(app.submittedAtMs || app.submittedAt || app.timestamp)}</small>
    </article>
  `).join("") || '<p class="empty">No applications yet.</p>';

  renderRank(E.topColleges, college);
  renderRank(E.topDomains, domain);

  const today = getTodayISTKey();
  const days = [...Array(7)].map((_, index) => {
    const [year, month, day] = today.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 6, 30, 0) - (6 - index) * 24 * 60 * 60 * 1000);
    return { date, key: getISTDateKey(date.getTime()) };
  });
  const max = Math.max(1, ...days.map(item => daily[item.key] || 0));

  E.applicationsChart.innerHTML = days.map(({ date, key }) => {
    const count = daily[key] || 0;
    return `<div class="chart-day" title="${count} applications"><span class="chart-bar" style="height:${Math.max(4, (count / max) * 100)}%"></span><small>${date.toLocaleDateString("en-IN", { weekday: "short" })}<br>${count}</small></div>`;
  }).join("");

  renderVisitors();
  renderReferrals();
  renderApplicationCRM();
}

function getCallStatus(app) {
  return normalizeCallStatus(app?.callStatus);
}

function getFollowUpMs(app) {
  return asMs(app?.nextFollowUpAt || app?.nextFollowUp || app?.followUpAt);
}

function isFollowUpDue(app) {
  const ms = getFollowUpMs(app);
  return ms > 0 && ms <= Date.now();
}

function formatFollowUp(app) {
  const ms = getFollowUpMs(app);
  if (!ms) return "—";
  const date = new Date(ms);
  const day = new Intl.DateTimeFormat("en-IN", {timeZone: IST_TIME_ZONE, day:"2-digit", month:"short"}).format(date);
  const time = new Intl.DateTimeFormat("en-IN", {timeZone: IST_TIME_ZONE, hour:"2-digit", minute:"2-digit"}).format(date);
  return `${day} • ${time}`;
}

function followUpClass(app) {
  if (isFollowUpDue(app)) return "due";
  const ms = getFollowUpMs(app);
  if (!ms) return "none";
  return "upcoming";
}

function populateCrmFilters() {
  const domainSelect = el("crmDomainFilter");
  const yearSelect = el("crmYearFilter");
  const counselorSelect = el("crmCounselorFilter");
  const statusSelect = el("crmStatusFilter");
  if (!domainSelect || !yearSelect) return;
  loadCounselorNames();
  if (statusSelect) {
    const rawCurrentStatus = String(statusSelect.value || "").trim();
    const currentStatus = rawCurrentStatus ? normalizeCallStatus(rawCurrentStatus) : "";
    statusSelect.innerHTML = '<option value="">All call statuses</option>' + CALL_STATUSES.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    statusSelect.value = CALL_STATUSES.includes(currentStatus) ? currentStatus : "";
  }
  const domains = [...new Set(applications.map(a => String(a.domain || "").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const years = [...new Set(applications.map(a => String(a.year || "").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const currentDomain = domainSelect.value, currentYear = yearSelect.value, currentCounselor = counselorSelect?.value || "";
  domainSelect.innerHTML = '<option value="">All domains</option>' + domains.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  yearSelect.innerHTML = '<option value="">All years</option>' + years.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if (counselorSelect) counselorSelect.innerHTML = '<option value="">All counselors</option>' + counselorNames.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  domainSelect.value = domains.includes(currentDomain) ? currentDomain : "";
  yearSelect.value = years.includes(currentYear) ? currentYear : "";
  if (counselorSelect) counselorSelect.value = counselorNames.includes(currentCounselor) ? currentCounselor : "";
}

function filterCrmApplications() {
  const q = String(el("crmSearch")?.value || "").trim().toLowerCase();
  const status = normalizeCallStatus(el("crmStatusFilter")?.value || "");
  const statusFilterActive = Boolean(el("crmStatusFilter")?.value);
  const domain = el("crmDomainFilter")?.value || "";
  const year = el("crmYearFilter")?.value || "";
  const counselor = el("crmCounselorFilter")?.value || "";
  const follow = el("crmFollowupFilter")?.value || "";
  const now = Date.now();
  const startToday = new Date(); startToday.setHours(0,0,0,0);
  const endToday = new Date(startToday.getTime()+86400000);

  crmFilteredApplications = applications.filter(app => {
    const hay = [app.id, app.applicationId, app.name, app.phone, app.email, app.college, app.department, app.domain].map(v=>String(v||"").toLowerCase()).join(" ");
    if (q && !hay.includes(q)) return false;
    if (statusFilterActive && getCallStatus(app) !== status) return false;
    if (domain && String(app.domain||"") !== domain) return false;
    if (year && String(app.year||"") !== year) return false;
    if (counselor && String(app.assignedTo||"") !== counselor) return false;
    const fu = getFollowUpMs(app);
    if (follow === "due" && !(fu && fu <= now)) return false;
    if (follow === "today" && !(fu >= startToday.getTime() && fu < endToday.getTime())) return false;
    if (follow === "upcoming" && !(fu > endToday.getTime())) return false;
    if (follow === "none" && fu) return false;
    return true;
  });
  renderCrmTable(crmFilteredApplications);
}

function loadCounselorNames() {
  let stored = [];
  try { stored = JSON.parse(localStorage.getItem(COUNSELOR_STORAGE_KEY) || "[]"); } catch (_) {}
  const assigned = applications.map(app => String(app?.assignedTo || "").trim()).filter(Boolean);
  counselorNames = [...new Set([...stored, ...assigned].map(v => String(v || "").trim()).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b));
  try { localStorage.setItem(COUNSELOR_STORAGE_KEY, JSON.stringify(counselorNames)); } catch (_) {}
}

function rememberCounselor(name) {
  const clean = String(name || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (!counselorNames.some(n => n.toLowerCase() === clean.toLowerCase())) counselorNames.push(clean);
  counselorNames.sort((a,b) => a.localeCompare(b));
  try { localStorage.setItem(COUNSELOR_STORAGE_KEY, JSON.stringify(counselorNames)); } catch (_) {}
  return clean;
}

function counselorOptions(selected = "", includeUnassigned = true) {
  const current = String(selected || "").trim();
  const names = [...counselorNames];
  if (current && !names.some(n => n.toLowerCase() === current.toLowerCase())) names.push(current);
  names.sort((a,b) => a.localeCompare(b));
  return `${includeUnassigned ? '<option value="">Unassigned</option>' : ''}${names.map(name => `<option value="${esc(name)}" ${name.toLowerCase() === current.toLowerCase() ? 'selected' : ''}>${esc(name)}</option>`).join("")}<option value="__new__">＋ Add new counselor…</option>`;
}

function promptForCounselor() {
  const name = window.prompt("Enter the academic counselor name. A dedicated Google Sheets tab will be created automatically when a lead is assigned.");
  if (name === null) return "";
  const clean = rememberCounselor(name);
  if (!clean) {
    showToast("Counselor name required", "Please enter a valid counselor name.", "error", 3500);
    return "";
  }
  showToast("Counselor added", `${clean} is now available for lead assignment.`, "success", 3500);
  renderApplicationCRM();
  return clean;
}

function handleCounselorSelect(select, onValue) {
  const value = select.value;
  if (value === "__new__") {
    const clean = promptForCounselor();
    select.value = clean || "";
    if (clean && onValue) onValue(clean);
    return clean;
  }
  if (onValue) onValue(value);
  return value;
}

async function assignApplicationToCounselor(appId, counselor, source = "row") {
  const app = applications.find(item => item.id === appId);
  if (!app) return false;
  const clean = String(counselor || "").trim();
  if (clean) rememberCounselor(clean);
  const old = String(app.assignedTo || "").trim();
  if (old === clean) return true;

  const statusEl = el("crmSyncStatus");
  if (statusEl) { statusEl.textContent = `● Assigning ${app.name || "lead"} to ${clean || "Unassigned"}…`; statusEl.className = "crm-syncing"; }
  try {
    await db.ref(`submittedApplications/${appId}`).update({ assignedTo: clean });
    app.assignedTo = clean;
    if (statusEl) { statusEl.textContent = `● Lead assigned • ${clean || "Unassigned"}`; statusEl.className = "crm-synced"; }
    renderApplicationCRM();
    showToast("Lead assigned", `${app.name || "Student"} → ${clean || "Unassigned"}. The counselor sheet will update automatically.`, "success", 4500);
    return true;
  } catch (error) {
    console.error("Lead assignment failed:", error);
    if (statusEl) { statusEl.textContent = "● Assignment failed."; statusEl.className = "crm-sync-error"; }
    showToast("Assignment failed", error?.message || "Firebase denied the assignment.", "error", 6000);
    return false;
  }
}

function selectedCrmIds() {
  return [...selectedApplicationIds].filter(id => applications.some(app => app.id === id));
}

function updateCrmSelectionUI() {
  const ids = selectedCrmIds();
  const count = el("crmSelectedCount");
  if (count) count.textContent = `${ids.length} selected`;
  const selectAll = el("crmSelectAll");
  const visibleIds = crmFilteredApplications.slice(0, 100).map(a => a.id);
  if (selectAll) {
    const selectedVisible = visibleIds.filter(id => selectedApplicationIds.has(id)).length;
    selectAll.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
  }
}

function toggleCrmSelection(id, checked) {
  if (checked) selectedApplicationIds.add(id); else selectedApplicationIds.delete(id);
  updateCrmSelectionUI();
}

function toggleAllCrmSelection(checked) {
  crmFilteredApplications.slice(0, 100).forEach(app => {
    if (checked) selectedApplicationIds.add(app.id); else selectedApplicationIds.delete(app.id);
  });
  renderCrmTable(crmFilteredApplications);
}

async function bulkAssignSelected() {
  const ids = selectedCrmIds();
  if (!ids.length) {
    showToast("No leads selected", "Select one or more leads first.", "info", 3000);
    return;
  }
  const select = el("crmBulkCounselor");
  const counselor = handleCounselorSelect(select);
  if (counselor === "__new__") return;
  if (!confirm(`Assign ${ids.length} selected lead${ids.length === 1 ? "" : "s"} to ${counselor || "Unassigned"}?\n\nEach counselor gets a dedicated sheet tab automatically.`)) return;
  const btn = el("crmBulkAssignBtn");
  if (btn) btn.disabled = true;
  try {
    let ok = 0;
    for (const id of ids) if (await assignApplicationToCounselor(id, counselor, "bulk")) ok++;
    selectedApplicationIds.clear();
    renderApplicationCRM();
    showToast("Bulk assignment complete", `${ok} lead${ok === 1 ? "" : "s"} assigned to ${counselor || "Unassigned"}.`, "success", 5000);
  } finally { if (btn) btn.disabled = false; }
}

function addCounselorFromCRM() {
  promptForCounselor();
  populateCrmCounselorControls();
}

function populateCrmCounselorControls() {
  loadCounselorNames();
  const bulk = el("crmBulkCounselor");
  if (bulk) {
    const current = bulk.value;
    bulk.innerHTML = counselorOptions(current);
    if ([...bulk.options].some(o => o.value === current)) bulk.value = current;
  }
}

function renderApplicationCRM() {
  loadCounselorNames();
  populateCrmFilters();
  const counts = {not:0, due:0, interested:0, selected:0, joined:0};
  applications.forEach(app => {
    const status = getCallStatus(app);
    if (status === "Not Contacted") counts.not++;
    if (isFollowUpDue(app)) counts.due++;
    if (status === "Interested") counts.interested++;
    if (status === "Paid / Pre-Reg") counts.selected++;
    if (status === "Enrolled") counts.joined++;
  });
  el("crmTotal").textContent = applications.length;
  el("crmNotContacted").textContent = counts.not;
  el("crmFollowUps").textContent = counts.due;
  el("crmInterested").textContent = counts.interested;
  el("crmSelected").textContent = counts.selected;
  el("crmJoined").textContent = counts.joined;
  filterCrmApplications();
}

function statusClass(status) {
  return String(status).toLowerCase().replace(/[^a-z]+/g,"-").replace(/^-|-$/g,"");
}

function renderCrmTable(rows) {
  const body = el("crmTableBody");
  if (!body) return;
  el("crmResultCount").textContent = `${rows.length} application${rows.length === 1 ? "" : "s"}`;
  populateCrmCounselorControls();
  body.innerHTML = rows.slice(0, 100).map(app => {
    const status = getCallStatus(app);
    const followClass = followUpClass(app);
    const assigned = String(app.assignedTo || "").trim();
    return `<tr>
      <td><input class="crm-row-check" type="checkbox" data-app-id="${esc(app.id)}" ${selectedApplicationIds.has(app.id) ? "checked" : ""} aria-label="Select ${esc(app.name || "lead")}"></td>
      <td><div class="crm-student"><span class="crm-avatar">${esc((app.name||"A").trim().charAt(0).toUpperCase())}</span><div><strong>${esc(app.name||"Unknown")}</strong><small>${esc(app.email||"—")}<br>${esc(app.phone||"—")}</small></div></div></td>
      <td><strong>${esc(app.college||"—")}</strong><small>${esc(app.department||"—")} • Year ${esc(app.year||"—")}</small></td>
      <td><span class="domain-pill">${esc(app.domain||"—")}</span></td>
      <td><small>${esc(fmt(app.submittedAtMs||app.submittedAt||app.timestamp))}</small></td>
      <td><span class="crm-status ${statusClass(status)}">${esc(status)}</span></td>
      <td><span class="follow-pill ${followClass}">${isFollowUpDue(app) ? "⚠ " : ""}${esc(formatFollowUp(app))}</span></td>
      <td><select class="crm-assign-select" data-app-id="${esc(app.id)}" aria-label="Assign ${esc(app.name || "lead")}">${counselorOptions(assigned)}</select></td>
      <td><div class="crm-row-actions"><button class="crm-open-btn" type="button" data-app-id="${esc(app.id)}">Open</button><button class="crm-delete-btn" type="button" data-app-id="${esc(app.id)}" aria-label="Delete ${esc(app.name || "lead")}">Delete</button></div></td>
    </tr>`;
  }).join("") || '<tr><td colspan="9" class="empty">No applications match your filters.</td></tr>';

  body.querySelectorAll(".crm-open-btn").forEach(btn => btn.addEventListener("click", () => openApplicationModal(btn.dataset.appId)));
  body.querySelectorAll(".crm-delete-btn").forEach(btn => btn.addEventListener("click", () => deleteSingleApplication(btn.dataset.appId)));
  body.querySelectorAll(".crm-row-check").forEach(box => box.addEventListener("change", () => toggleCrmSelection(box.dataset.appId, box.checked)));
  body.querySelectorAll(".crm-assign-select").forEach(select => select.addEventListener("change", () => {
    handleCounselorSelect(select, value => assignApplicationToCounselor(select.dataset.appId, value, "row"));
  }));
  updateCrmSelectionUI();
}

async function sendApplicationDeleteToSheets(app) {
  const payload = {
    id: app?.id || app?.applicationId || "",
    applicationId: app?.applicationId || app?.id || "",
    name: app?.name || ""
  };
  if (!payload.applicationId) throw new Error("Application ID is missing.");
  return fetch(SHEETS_RECOVERY_ENDPOINT, {
    method:"POST",
    mode:"no-cors",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({action:"deleteApplication", application:payload})
  });
}

async function deleteSingleApplication(id, options = {}) {
  const app = applications.find(item => item.id === id);
  if (!app) return false;

  const name = String(app.name || "this student").trim();
  const applicationId = String(app.applicationId || app.id || "").trim();
  if (!applicationId) {
    showToast("Delete failed", "This lead has no Application ID.", "error", 5000);
    return false;
  }

  const confirmed = options.skipConfirm || confirm(
    `Delete ${name}?\n\nApplication ID: ${applicationId}\n\nThis will remove the lead from Firebase, the Master Sheet, and the assigned counselor sheet. This action cannot be undone.`
  );
  if (!confirmed) return false;

  const statusEl = el("crmSyncStatus");
  if (statusEl) {
    statusEl.textContent = `● Deleting ${name}…`;
    statusEl.className = "crm-syncing";
  }

  try {
    // Sheets first: once Firebase is removed, the dashboard can no longer
    // recover the record automatically. The no-cors request is awaited so
    // the browser has handed the deletion to Apps Script before Firebase is removed.
    await sendApplicationDeleteToSheets(app);
    await db.ref(`submittedApplications/${id}`).remove();

    selectedApplicationIds.delete(id);
    if (activeApplicationId === id) closeApplicationModal();

    if (statusEl) {
      statusEl.textContent = `● Lead deleted • ${name}`;
      statusEl.className = "crm-synced";
    }
    showToast("Lead deleted", `${name} was removed from Firebase, Master Sheet and counselor sheets.`, "success", 5500);
    return true;
  } catch (error) {
    console.error("Application delete failed:", error);
    if (statusEl) {
      statusEl.textContent = "● Delete failed.";
      statusEl.className = "crm-sync-error";
    }
    showToast("Delete failed", error?.message || "Unable to delete this lead.", "error", 7000);
    return false;
  }
}

function toDateTimeLocal(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openApplicationModal(id) {
  const app = applications.find(item => item.id === id);
  if (!app) return;
  activeApplicationId = id;
  el("applicationModalTitle").textContent = app.name || "Student Application";
  el("applicationModalSubtitle").textContent = `${app.college || "—"} • ${app.domain || "—"} • ${app.email || "—"}`;
  el("applicationStudentDetails").innerHTML = detailRows([
    ["Phone", app.phone], ["Email", app.email], ["State", app.state], ["Communication", app.communicationLanguage || app.language]
  ]);
  el("applicationAcademicDetails").innerHTML = detailRows([
    ["College", app.college], ["Department", app.department], ["Year", app.year], ["Domain", app.domain], ["Start availability", app.startAvailability], ["Application reason", app.applicationReason]
  ]);
  const modalStatus = el("modalCallStatus");
  if (modalStatus) {
    modalStatus.innerHTML = renderCallStatusOptions(getCallStatus(app));
    modalStatus.value = getCallStatus(app);
  }
  el("modalFollowUp").value = toDateTimeLocal(getFollowUpMs(app));
  loadCounselorNames();
  const assignedSelect = el("modalAssignedTo");
  if (assignedSelect) { assignedSelect.innerHTML = counselorOptions(app.assignedTo || ""); assignedSelect.value = app.assignedTo || ""; }
  el("modalRemarks").value = app.remarks || "";
  el("modalSaveStatus").textContent = "";
  el("applicationModal").classList.add("show");
  el("applicationModal").setAttribute("aria-hidden","false");
}

function detailRows(rows) {
  return rows.map(([label,val]) => `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(val || "—")}</strong></div>`).join("");
}

function closeApplicationModal() {
  activeApplicationId = null;
  el("applicationModal")?.classList.remove("show");
  el("applicationModal")?.setAttribute("aria-hidden","true");
}

function toFirebaseDateValue(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

async function saveApplicationCRM() {
  if (!activeApplicationId) return;
  const app = applications.find(item => item.id === activeApplicationId);
  if (!app) return;
  const statusEl = el("modalSaveStatus");
  const updates = {
    callStatus: el("modalCallStatus").value,
    nextFollowUpAt: toFirebaseDateValue(el("modalFollowUp").value),
    assignedTo: String(el("modalAssignedTo").value || "").trim(),
    remarks: String(el("modalRemarks").value || "").trim()
  };
  try {
    statusEl.textContent = "Saving…";
    await db.ref(`submittedApplications/${activeApplicationId}`).update(updates);
    Object.assign(app, updates);
    if (updates.assignedTo) rememberCounselor(updates.assignedTo);
    statusEl.textContent = "✓ Saved to Firebase • Sheets sync sent.";
    showToast("Application updated", `${app.name || "Student"}'s CRM details were saved.`, "success", 3500);
    renderApplications();
  } catch (error) {
    console.error("CRM update failed:", error);
    statusEl.textContent = "Could not save. Check Firebase permissions.";
    showToast("Update failed", error?.message || "Firebase denied the update.", "error", 6500);
  }
}

async function sendApplicationUpdateToSheets(app) {
  const payload = {...app, applicationId: app.applicationId || app.id};
  return fetch(SHEETS_RECOVERY_ENDPOINT, {
    method:"POST", mode:"no-cors", headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({action:"updateApplication", application:payload})
  });
}

async function syncCrmToSheets() {
  if (!applications.length) { showToast("Nothing to sync", "There are no Firebase applications to sync.", "info"); return; }
  if (!confirm(`Sync all ${applications.length} CRM records to Google Sheets?\n\nExisting Sheet rows will be updated by Application ID; missing rows will be added.`)) return;
  const btn = el("syncCrmSheetsBtn");
  btn.disabled = true;
  try {
    await sendApplicationsToSheets(applications, true);
    showToast("CRM sync sent", `${applications.length} applications were sent for update/add processing. Refresh the Sheet after 10–20 seconds.`, "success", 7000);
  } catch (error) {
    showToast("CRM sync failed", error?.message || "Unable to send CRM sync.", "error", 7000);
  } finally { btn.disabled = false; }
}

function exportCrmCsv() {
  if (!crmFilteredApplications.length) { showToast("Nothing to export", "No applications match the current filters.", "info"); return; }
  const headers = ["Timestamp","Application ID","Name","Phone","Email","College","Department","Year","Domain","State","Communication Language","Start Availability","Application Reason","Call Status","Next Follow-up","Assigned To","Remarks"];
  const rows = crmFilteredApplications.map(a => [a.submittedAtMs||a.submittedAt||a.timestamp,a.id||a.applicationId,a.name,a.phone,a.email,a.college,a.department,a.year,a.domain,a.state,a.communicationLanguage||a.language,a.startAvailability,a.applicationReason,getCallStatus(a),a.nextFollowUpAt||"",a.assignedTo||"",a.remarks||""]);
  const csv = [headers,...rows].map(row => row.map(v => `"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=`internsforge-crm-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  showToast("CRM CSV exported", `${crmFilteredApplications.length} applications exported.`, "success");
}

const reward = count =>
  count >= 10 ? "Campus Ambassador" :
  count >= 5 ? "Certificate" :
  count >= 3 ? "Priority Review" :
  "Not eligible";

function renderReferrals() {
  const codes = Object.keys(referralProfiles);
  const successful = Object.values(referralJoins)
    .reduce((sum, joins) => sum + Object.keys(joins || {}).length, 0);

  const board = codes.map(code => ({
    code,
    ...referralProfiles[code],
    count: Object.keys(referralJoins[code] || {}).length
  })).sort((a, b) => b.count - a.count);

  E.totalReferralCodes.textContent = codes.length;
  E.successfulReferrals.textContent = successful;
  E.referralConversionRate.textContent = applications.length
    ? `${Math.round((successful / applications.length) * 100)}%`
    : "0%";

  const top = board[0];
  E.topAmbassador.textContent = top?.count ? (top.ownerName || top.code) : "—";
  E.topAmbassadorCount.textContent = top?.count ? `${top.count} joined` : "No referrals yet";

  E.referralLeaderboardBody.innerHTML = board.length
    ? board.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${esc(item.ownerName || "Unknown")}</strong><small>${esc(item.ownerCollege || item.ownerPhone || "—")}</small></td>
        <td><code>${esc(item.code)}</code></td>
        <td>${item.count}</td>
        <td><span class="reward-status">${esc(reward(item.count))}</span></td>
      </tr>
    `).join("")
    : '<tr><td colspan="5" class="empty">No referral data yet.</td></tr>';

  friendRows = [];
  Object.entries(referralJoins).forEach(([code, joins]) => {
    Object.entries(joins || {}).forEach(([id, join]) => friendRows.push({ id, code, ...join }));
  });
  friendRows.sort((a, b) => asMs(b.joinedAt) - asMs(a.joinedAt));
  renderFriends(friendRows);
}

function renderFriends(rows) {
  E.referralFriendsBody.innerHTML = rows.length
    ? rows.map(item => `
      <tr>
        <td><strong>${esc(item.applicantName || "Unknown")}</strong><small>${esc(item.id)}</small></td>
        <td><code>${esc(item.code)}</code></td>
        <td>${esc(item.applicantCollege || "—")}</td>
        <td>${esc(item.applicantDomain || "—")}</td>
        <td>${fmt(item.joinedAt)}</td>
      </tr>
    `).join("")
    : '<tr><td colspan="5" class="empty">No referred applications yet.</td></tr>';
}

async function unlockAudio() {
  try {
    if (!audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return false;
      audioContext = new AudioCtor();
    }

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    soundUnlocked = audioContext.state === "running";
    return soundUnlocked;
  } catch (error) {
    console.warn("Audio unlock failed:", error);
    soundUnlocked = false;
    return false;
  }
}

async function playNotificationSound() {
  const settings = getAlertSettings();
  if (!settings.enabled || settings.volume <= 0) return false;

  const ready = await unlockAudio();
  if (!ready || !audioContext) return false;

  const now = audioContext.currentTime;
  const volume = Math.max(0.01, settings.volume / 100);
  const master = audioContext.createGain();

  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(volume * 0.78, now + 0.02);
  master.gain.setValueAtTime(volume * 0.78, now + 0.82);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 1.35);
  master.connect(audioContext.destination);

  const notes = [
    { frequency: 880, start: 0.00, duration: 0.24, type: "square", level: 0.72 },
    { frequency: 1174.66, start: 0.18, duration: 0.30, type: "square", level: 0.72 },
    { frequency: 880, start: 0.58, duration: 0.24, type: "sawtooth", level: 0.62 },
    { frequency: 1318.51, start: 0.76, duration: 0.42, type: "square", level: 0.78 }
  ];

  notes.forEach(note => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const startTime = now + note.start;
    const endTime = startTime + note.duration;

    oscillator.type = note.type;
    oscillator.frequency.setValueAtTime(note.frequency, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(note.level, startTime + 0.012);
    gain.gain.setValueAtTime(note.level, Math.max(startTime + 0.013, endTime - 0.06));
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(startTime);
    oscillator.stop(endTime + 0.02);
  });

  return true;
}

function getBrowserAlertEnabled() {
  try {
    const stored = localStorage.getItem(BROWSER_ALERT_STORAGE_KEY);
    if (stored === null) return ("Notification" in window && Notification.permission === "granted");
    return stored === "true";
  } catch {
    return false;
  }
}

function saveBrowserAlertEnabled(enabled) {
  localStorage.setItem(BROWSER_ALERT_STORAGE_KEY, String(Boolean(enabled)));
}

function updateBrowserAlertUi() {
  const button = el("browserNotificationButton");
  if (!button) return;
  const enabled = getBrowserAlertEnabled();
  const supported = "Notification" in window;
  const permission = supported ? Notification.permission : "unsupported";
  button.textContent = enabled && permission === "granted" ? "Disable Browser Alerts" : "Enable Browser Alerts";
  button.classList.toggle("secondary", !(enabled && permission === "granted"));
  button.setAttribute("aria-pressed", String(enabled && permission === "granted"));
  button.title = enabled && permission === "granted"
    ? "Browser alerts are enabled. Click to disable them."
    : "Enable browser alerts for new application notifications.";
}

function getPushTokenStorage() {
  try { return localStorage.getItem(PUSH_TOKEN_STORAGE_KEY) || ""; } catch { return ""; }
}

function savePushTokenStorage(token) {
  try { if (token) localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token); else localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY); } catch {}
}

function pushTokenKey(token) {
  return token.replace(/[.#$\[\]\/]/g, "_").slice(0, 700);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

function getPushSubscriptionKey(endpoint) {
  return btoa(unescape(encodeURIComponent(endpoint))).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 700);
}

async function registerAdminPush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('This browser does not support background web push notifications.');
  }
  const user = auth?.currentUser;
  if (!user) throw new Error('Administrator authentication is required.');

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Browser notification permission was not granted.');

  const publicKey = String(window.INTERNFORGE_PUSH_CONFIG?.vapidPublicKey || '').trim();
  if (!publicKey) throw new Error('Background push configuration is missing.');

  const registration = await navigator.serviceWorker.register('firebase-messaging-sw.js', { scope: './' });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  const subscriptionJson = subscription.toJSON();
  if (!subscriptionJson.endpoint || !subscriptionJson.keys?.p256dh || !subscriptionJson.keys?.auth) {
    throw new Error('The browser did not return a valid push subscription.');
  }

  const key = getPushSubscriptionKey(subscriptionJson.endpoint);
  await db.ref(`adminPushTokens/${user.uid}/${key}`).set({
    token: subscriptionJson.endpoint,
    endpoint: subscriptionJson.endpoint,
    subscription: subscriptionJson,
    adminUid: user.uid,
    enabled: true,
    updatedAt: firebase.database.ServerValue.TIMESTAMP,
    userAgent: navigator.userAgent.slice(0, 500)
  });
  savePushTokenStorage(subscriptionJson.endpoint);
  return subscriptionJson.endpoint;
}

async function unregisterAdminPush() {
  const user = auth?.currentUser;
  const endpoint = getPushTokenStorage();
  if (user && endpoint) {
    await db.ref(`adminPushTokens/${user.uid}/${getPushSubscriptionKey(endpoint)}`).remove();
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration('firebase-messaging-sw.js');
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch (error) {
    console.warn('Could not unsubscribe browser push:', error);
  }
  savePushTokenStorage('');
}

function getBrowserAlertEnabled() {
  try {
    const stored = localStorage.getItem(BROWSER_ALERT_STORAGE_KEY);
    if (stored === null) return false;
    return stored === 'true';
  } catch { return false; }
}

function saveBrowserAlertEnabled(enabled) {
  localStorage.setItem(BROWSER_ALERT_STORAGE_KEY, String(Boolean(enabled)));
}

function updateBrowserAlertUi() {
  const button = el("browserNotificationButton");
  if (!button) return;
  const enabled = getBrowserAlertEnabled();
  const supported = "Notification" in window;
  const permission = supported ? Notification.permission : "unsupported";
  const active = enabled && permission === "granted";
  button.textContent = active ? "Disable Browser Alerts" : "Enable Browser Alerts";
  button.classList.toggle("secondary", !active);
  button.setAttribute("aria-pressed", String(active));
  button.title = active
    ? "Browser push alerts are enabled. Click to disable them."
    : "Enable browser push alerts for new applications.";
}

function sendBrowserNotification(count, latest) {
  if (!getBrowserAlertEnabled()) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!document.hidden) return;

  new Notification(count === 1 ? "New Application Received" : `${count} New Applications`, {
    body: count === 1
      ? `${latest?.name || "A student"} • ${latest?.college || "New application"}`
      : "Open the admin dashboard to review the new submissions.",
    icon: "skillpath-mark.png",
    badge: "skillpath-mark.png",
    tag: "skillpath-new-applications"
  });
}

function handleNewApplications(nextApplications) {
  const seen = getSeenApplicationIds();
  const currentIds = new Set(nextApplications.map(app => app.id));

  if (!initialApplicationSnapshotLoaded) {
    saveSeenApplicationIds(currentIds);
    initialApplicationSnapshotLoaded = true;
    return new Set();
  }

  const newItems = nextApplications.filter(app => !seen.has(app.id));
  if (!newItems.length) return new Set();

  newItems.forEach(app => seen.add(app.id));
  saveSeenApplicationIds(seen);

  playNotificationSound();
  showToast(
    newItems.length === 1 ? "New Application Received" : `${newItems.length} New Applications Received`,
    newItems.length === 1
      ? `${newItems[0].name || "Student"} • ${newItems[0].college || "Application submitted"}`
      : "The dashboard has been updated automatically.",
    "success",
    6000
  );
  sendBrowserNotification(newItems.length, newItems[0]);

  document.title = `(${newItems.length}) New Application${newItems.length > 1 ? "s" : ""} — InternsForge Admin`;
  window.setTimeout(() => {
    document.title = "InternsForge — Admin Command Center";
  }, 8000);

  return new Set(newItems.map(app => app.id));
}

async function performFullRefresh() {
  if (refreshInProgress) return;
  refreshInProgress = true;

  const button = el("refreshDashboardButton");
  const overlay = el("refreshOverlay");
  button?.classList.add("is-refreshing");
  button?.setAttribute("disabled", "disabled");
  overlay?.classList.add("show");
  overlay?.setAttribute("aria-hidden", "false");

  try {
    const removed = await cleanupStale({ removeAbandoned: true });

    const [visitorSnapshot, applicationSnapshot, referralSnapshot, joinSnapshot] = await Promise.all([
      db.ref("liveVisitors").once("value"),
      db.ref("submittedApplications").once("value"),
      db.ref("referrals").once("value"),
      db.ref("referralJoins").once("value")
    ]);

    visitors = visitorSnapshot.val() || {};
    applications = Object.entries(applicationSnapshot.val() || {})
      .map(([id, app]) => ({ id, ...app }))
      .sort((a, b) => asMs(b.submittedAtMs || b.submittedAt) - asMs(a.submittedAtMs || a.submittedAt));
    referralProfiles = referralSnapshot.val() || {};
    referralJoins = joinSnapshot.val() || {};

    // Keep the privacy-safe public aggregate synchronized from the authenticated dashboard.
    await db.ref("publicStats/applicationCount").set(applications.length);

    renderApplications();
    renderReferrals();
    renderVisitors();
    updateStamp("Refreshed");

    showToast(
      "Dashboard refreshed",
      removed ? `${removed} abandoned or stale session${removed > 1 ? "s were" : " was"} cleared.` : "All dashboard data is up to date.",
      "success"
    );
  } catch (error) {
    console.error("Dashboard refresh failed:", error);
    showToast("Refresh failed", "Check your internet connection and Firebase access.", "error", 6000);
  } finally {
    refreshInProgress = false;
    button?.classList.remove("is-refreshing");
    button?.removeAttribute("disabled");
    overlay?.classList.remove("show");
    overlay?.setAttribute("aria-hidden", "true");
  }
}

function exportApplicationsCsv() {
  if (!applications.length) {
    showToast("Nothing to export", "No submitted applications are available.", "info");
    return;
  }

  const headers = ["Name", "Phone", "Email", "College", "Department", "Year", "Domain", "Referral Code", "Submitted At"];
  const rows = applications.map(app => [
    app.name, app.phone, app.email, app.college, app.department, app.year,
    app.domain, app.referralCode || app.referredBy || "",
    new Date(asMs(app.submittedAtMs || app.submittedAt) || Date.now()).toISOString()
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `internsforge-applications-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast("CSV exported", `${applications.length} applications downloaded.`, "success");
}

function updateSoundUi() {
  const settings = getAlertSettings();
  const checkbox = el("soundEnabled");
  const slider = el("notificationVolume");
  const output = el("volumeValue");
  const quick = el("soundQuickToggle");

  if (checkbox) checkbox.checked = settings.enabled;
  if (slider) slider.value = settings.volume;
  if (output) output.textContent = `${settings.volume}%`;
  if (quick) {
    quick.textContent = settings.enabled ? "🔊" : "🔇";
    quick.setAttribute("aria-pressed", String(settings.enabled));
    quick.title = settings.enabled ? "Disable notification sound" : "Enable notification sound";
  }
  if (el("soundHealthText")) el("soundHealthText").textContent = settings.enabled ? "Enabled" : "Disabled";
}

function setupNotificationSettings() {
  updateSoundUi();

  const persist = () => {
    const settings = {
      enabled: Boolean(el("soundEnabled")?.checked),
      volume: Number(el("notificationVolume")?.value || 90)
    };
    saveAlertSettings(settings);
    updateSoundUi();
  };

  el("soundEnabled")?.addEventListener("change", async () => {
    persist();
    if (el("soundEnabled").checked) {
      const played = await playNotificationSound();
      showToast(
        played ? "Sound alerts enabled" : "Sound enabled — click Test Sound",
        played ? "A tone will play for each new application." : "Your browser requires a user gesture before audio can play.",
        played ? "success" : "info"
      );
    }
  });

  el("notificationVolume")?.addEventListener("input", () => {
    persist();
  });

  el("testSoundButton")?.addEventListener("click", async () => {
    const settings = getAlertSettings();
    if (!settings.enabled) {
      saveAlertSettings({ ...settings, enabled: true });
      updateSoundUi();
    }
    const played = await playNotificationSound();
    showToast(
      played ? "Test sound played" : "Sound could not start",
      played ? "Notification audio is working." : "Check your browser/site sound permission and try again.",
      played ? "success" : "error",
      5000
    );
  });

  el("soundQuickToggle")?.addEventListener("click", async () => {
    const settings = getAlertSettings();
    const enabled = !settings.enabled;
    saveAlertSettings({ ...settings, enabled });
    updateSoundUi();
    if (enabled) await playNotificationSound();
  });

  el("browserNotificationButton")?.addEventListener("click", async () => {
    if (getBrowserAlertEnabled() && ("Notification" in window) && Notification.permission === "granted") {
      try {
        await unregisterAdminPush();
      } catch (error) {
        console.error("Push disable failed:", error);
      }
      saveBrowserAlertEnabled(false);
      updateBrowserAlertUi();
      showToast("Browser alerts disabled", "New application push notifications are now turned off.", "info");
      return;
    }

    try {
      await registerAdminPush();
      saveBrowserAlertEnabled(true);
      updateBrowserAlertUi();
      showToast("Browser alerts enabled", "You will receive a browser notification for new applications even when this dashboard is closed, as long as your browser/device allows background notifications.", "success", 7000);
    } catch (error) {
      console.error("Push registration failed:", error);
      saveBrowserAlertEnabled(false);
      updateBrowserAlertUi();
      showToast("Could not enable browser alerts", error?.message || "Check notification permission and Firebase web push setup.", "error", 7000);
    }
  });

  // Restore the push registration after refresh/reopening the dashboard.
  if (getBrowserAlertEnabled() && "Notification" in window && Notification.permission === "granted") {
    registerAdminPush().catch(error => console.warn("Push restore failed:", error));
  }
  updateBrowserAlertUi();

  const armSound = () => {
    unlockAudio();
    if (audioContext?.state === "running") {
      document.removeEventListener("pointerdown", armSound);
      document.removeEventListener("keydown", armSound);
    }
  };
  document.addEventListener("pointerdown", armSound);
  document.addEventListener("keydown", armSound);
}

function setupFirebaseConnectionStatus() {
  const status = el("portalLiveStatus");
  const text = el("portalLiveText");
  const dot = status?.querySelector("i");
  const healthDot = el("firebaseHealthDot");
  const healthText = el("firebaseHealthText");

  const render = connected => {
    if (status) status.classList.toggle("is-offline", !connected);
    if (dot) dot.classList.toggle("connected", connected);
    if (text) text.textContent = connected ? "Connected" : "Reconnecting…";
    if (healthDot) {
      healthDot.classList.toggle("healthy", connected);
      healthDot.classList.toggle("unhealthy", !connected);
    }
    if (healthText) healthText.textContent = connected ? "Connected" : "Reconnecting";
  };

  render(false);
  db.ref(".info/connected").on("value", snapshot => render(snapshot.val() === true));
}

function listeners() {
  if (started) return;
  started = true;

  const visitorRoot = db.ref("liveVisitors");
  const applyVisitor = snapshot => {
    const value = snapshot.val();
    if (value) visitors[snapshot.key] = value;
    else delete visitors[snapshot.key];
    renderVisitors();
  };

  visitorRoot.once("value").then(snapshot => {
    visitors = snapshot.val() || {};
    renderVisitors();
  }).catch(console.warn);
  visitorRoot.on("child_added", applyVisitor);
  visitorRoot.on("child_changed", applyVisitor);
  visitorRoot.on("child_removed", snapshot => {
    delete visitors[snapshot.key];
    renderVisitors();
  });

  db.ref("publicStats/applicationVisitorCount").on("value", snapshot => {
    const count = Number(snapshot.val());
    const displayCount = Number.isFinite(count) && count >= 0 ? Math.floor(count).toLocaleString("en-IN") : "0";
    if (E.applicationVisitorCount) E.applicationVisitorCount.textContent = displayCount;
    if (E.applicationVisitorCountMetric) E.applicationVisitorCountMetric.textContent = displayCount;
  });

  // Near-real-time CRM -> Google Sheets sync. This listens only for future Firebase record changes, so opening the dashboard does not re-send all existing applications.
  db.ref("submittedApplications").on("child_changed", snapshot => {
    const app = { id: snapshot.key, ...(snapshot.val() || {}) };
    const statusEl = el("crmSyncStatus");
    if (statusEl) { statusEl.textContent = "● Syncing CRM change to Google Sheets…"; statusEl.className = "crm-syncing"; }
    sendApplicationUpdateToSheets(app)
      .then(() => {
        if (statusEl) { statusEl.textContent = "● Firebase live • Last CRM change sent to Google Sheets just now."; statusEl.className = "crm-synced"; }
      })
      .catch(error => {
        console.warn("Realtime CRM Sheets sync failed:", error);
        if (statusEl) { statusEl.textContent = "● Firebase live • Sheets sync needs attention."; statusEl.className = "crm-sync-error"; }
      });
  });

  db.ref("submittedApplications").on("value", snapshot => {
    const nextApplications = Object.entries(snapshot.val() || {})
      .map(([id, app]) => ({ id, ...app }))
      .sort((a, b) => asMs(b.submittedAtMs || b.submittedAt) - asMs(a.submittedAtMs || a.submittedAt));

    const newIds = handleNewApplications(nextApplications);
    applications = nextApplications;
    db.ref("publicStats/applicationCount").set(applications.length).catch(error => console.warn("Public application count sync failed:", error));
    renderApplications(newIds);
  });

  db.ref("referrals").on("value", snapshot => {
    referralProfiles = snapshot.val() || {};
    renderReferrals();
  });

  db.ref("referralJoins").on("value", snapshot => {
    referralJoins = snapshot.val() || {};
    renderReferrals();
  });

  window.setInterval(() => renderVisitors(), 2_000);
  window.setInterval(() => cleanupStale().catch(console.warn), 30_000);

  E.referralSearch?.addEventListener("input", () => {
    const query = E.referralSearch.value.toLowerCase();
    renderFriends(friendRows.filter(item =>
      [item.applicantName, item.code, item.applicantCollege, item.applicantDomain]
        .some(value => String(value || "").toLowerCase().includes(query))
    ));
  });
}

function setupUI() {
  // Initialise notification controls; this was previously defined but never called.
  setupNotificationSettings();

  const sidebar = el("sidebar");
  const overlay = el("mobileOverlay");
  const toggle = () => {
    sidebar.classList.toggle("open");
    overlay.classList.toggle("show");
  };

  el("menuToggle")?.addEventListener("click", toggle);
  el("moreNav")?.addEventListener("click", toggle);
  overlay?.addEventListener("click", toggle);

  document.querySelectorAll(".side-nav a").forEach(anchor => {
    anchor.addEventListener("click", () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("show");
    });
  });

  const tick = () => {
    const date = new Date();
    el("liveClock").textContent = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    el("liveDate").textContent = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };
  tick();
  window.setInterval(tick, 1000);

  el("refreshDashboardButton")?.addEventListener("click", performFullRefresh);
  el("exportApplicationsButton")?.addEventListener("click", exportApplicationsCsv);
  el("exportCrmButton")?.addEventListener("click", exportCrmCsv);
  el("syncCrmSheetsBtn")?.addEventListener("click", syncCrmToSheets);
  el("crmSelectAll")?.addEventListener("change", event => toggleAllCrmSelection(event.target.checked));
  el("crmBulkAssignBtn")?.addEventListener("click", bulkAssignSelected);
  el("crmAddCounselorBtn")?.addEventListener("click", addCounselorFromCRM);
  el("adminLogoutButton")?.addEventListener("click", logout);
  el("modalAssignedTo")?.addEventListener("change", event => { if (event.target.value === "__new__") { const name = promptForCounselor(); event.target.innerHTML = counselorOptions(name); event.target.value = name || ""; } });
  ["crmSearch","crmStatusFilter","crmDomainFilter","crmYearFilter","crmCounselorFilter","crmFollowupFilter"].forEach(id => el(id)?.addEventListener("input", filterCrmApplications));
  el("crmClearFilters")?.addEventListener("click", () => { el("crmSearch").value=""; el("crmStatusFilter").value=""; el("crmDomainFilter").value=""; el("crmYearFilter").value=""; el("crmCounselorFilter").value=""; el("crmFollowupFilter").value=""; filterCrmApplications(); });
  el("closeApplicationModal")?.addEventListener("click", closeApplicationModal);
  el("applicationModal")?.addEventListener("click", event => { if (event.target.id === "applicationModal") closeApplicationModal(); });
  el("saveApplicationCrm")?.addEventListener("click", saveApplicationCRM);
  el("deleteApplicationCrm")?.addEventListener("click", () => {
    if (activeApplicationId) deleteSingleApplication(activeApplicationId);
  });
  el("callApplication")?.addEventListener("click", async () => {
    const app=applications.find(a=>a.id===activeApplicationId);
    if(app?.phone) {
      window.location.href=`tel:${String(app.phone).replace(/[^+\d]/g,"")}`;
    }
  });
  // Personalized communication templates for SMS, WhatsApp and Email.
  function buildInternshipMessage(app) {
    const name = app?.name || "Student";
    const domain = app?.domain || "your selected domain";

    return `Hi ${name},

This is InternsForge regarding your internship application.

Your Chosen Domain: ${domain}

We’re reaching out regarding the InternsForge Internship Program 2026, where you can gain practical experience, work on real-time projects, develop industry-relevant skills, and build your career profile.

What you can explore:
• Internship experience in your selected domain
• Real-time / practical projects
• Skill development & mentorship
• Internship certification
• Career and placement-oriented opportunities

Referral Benefits:
You can also participate in our student referral program and refer your friends/classmates.

Referral options include:
• Share your referral with friends
• Invite classmates to the internship program
• Track successful referrals
• Become eligible for applicable referral benefits/rewards

If you’re interested in proceeding with your ${domain} internship, please reply “INTERESTED” and our team will guide you through the next steps.

InternsForge 2026
Learn • Build • Experience • Grow`;
  }

  function normalizeIndianPhone(phone) {
    let digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 10) digits = "91" + digits;
    else if (digits.length === 11 && digits.startsWith("0")) digits = "91" + digits.slice(1);
    return digits;
  }

  el("whatsappApplication")?.addEventListener("click", async () => {
    const app = applications.find(a => a.id === activeApplicationId);
    if (!app?.phone) return;

    const digits = normalizeIndianPhone(app.phone);
    if (digits.length < 10) {
      alert("Please check this student's phone number before opening WhatsApp.");
      return;
    }

    const message = encodeURIComponent(buildInternshipMessage(app));
    window.open(`https://wa.me/${digits}?text=${message}`, "_blank", "noopener,noreferrer");
  });
  el("smsApplication")?.addEventListener("click", async () => {
    const app = applications.find(a => a.id === activeApplicationId);
    if (!app?.phone) return;

    const digits = normalizeIndianPhone(app.phone);
    if (digits.length < 10) {
      alert("Please check this student's phone number before sending SMS.");
      return;
    }

    const body = encodeURIComponent(buildInternshipMessage(app));
    window.location.href = `sms:+${digits}?body=${body}`;
  });
  el("emailApplication")?.addEventListener("click", async () => {
    const app = applications.find(a => a.id === activeApplicationId);
    if (!app?.email) return;

    const name = app.name || "Student";
    const domain = app.domain || "your selected domain";
    const subject = encodeURIComponent(`InternsForge Internship 2026 — ${domain}`);
    const body = encodeURIComponent(buildInternshipMessage(app));

    window.location.href = `mailto:${app.email}?subject=${subject}&body=${body}`;
  });
}

auth.onAuthStateChanged(user => {
  if (!user) {
    location.replace("login.html");
    return;
  }

  // Show the signed-in administrator in the dashboard profile.
  const profileEmail = document.getElementById("adminProfileEmail");
  const profileName = document.getElementById("adminProfileName");
  const avatar = document.getElementById("adminAvatar");

  if (profileEmail) profileEmail.textContent = user.email || "Administrator";
  if (profileName) profileName.textContent = user.displayName || "Administrator";
  if (avatar) {
    const source = user.displayName || user.email || "A";
    avatar.textContent = source.trim().charAt(0).toUpperCase() || "A";
  }

  document.body.style.visibility = "visible";
  setupFirebaseConnectionStatus();
  setupUI();
  listeners();
});

async function resetAdminPassword() {
  const user = auth.currentUser;

  if (!user || !user.email) {
    showToast(
      "Authentication required",
      "Please sign in again before resetting your password.",
      "error",
      6000
    );
    return;
  }

  const confirmed = confirm(
    `Send a password reset link to ${user.email}?\n\nThe reset email can be opened on this or another device.`
  );

  if (!confirmed) return;

  try {
    const origin = window.location.origin;
    const continueUrl =
      origin && origin !== "null" && /^https?:$/i.test(window.location.protocol)
        ? `${origin}/login.html?reset=success`
        : "https://mnc-internship.vercel.app/login.html?reset=success";

    await auth.sendPasswordResetEmail(user.email, {
      url: continueUrl,
      handleCodeInApp: false
    });

    showToast(
      "Password reset email sent",
      `Check ${user.email} for the newest reset email. You can keep this dashboard open until the password is changed.`,
      "success",
      9000
    );
  } catch (error) {
    console.error("Firebase password reset failed:", error);

    const friendlyMessages = {
      "auth/invalid-email": "The administrator email address is invalid.",
      "auth/user-not-found": "No administrator account exists for this email.",
      "auth/too-many-requests": "Too many reset attempts. Please try again later.",
      "auth/network-request-failed": "Network error. Check your connection and try again.",
      "auth/operation-not-allowed": "Email/password authentication is not enabled in Firebase Authentication."
    };

    showToast(
      "Password reset failed",
      friendlyMessages[error.code] || error.message || "Unable to send the password reset email.",
      "error",
      8000
    );
  }
}

async function logout() {
  try {
    await auth.signOut();
    location.replace("login.html");
  } catch (error) {
    console.error("Firebase sign-out failed:", error);
    showToast(
      "Sign out failed",
      error.message || "Unable to sign out right now. Please try again.",
      "error",
      7000
    );
  }
}

async function del(path, message, successText) {
  if (!confirm(message)) return false;
  const user = auth?.currentUser;
  if (!user) {
    showToast("Authentication required", "Please sign in again before changing dashboard data.", "error", 6000);
    return false;
  }

  try {
    await db.ref(path).remove();

    // Keep the currently rendered dashboard in sync immediately.
    if (path === "submittedApplications") {
      applications = [];
      renderApplications();
      renderApplications();
    }
    if (path === "referrals" || path === "referralJoins") {
      renderReferrals();
    }

    showToast("Data cleared", successText || "The selected data was deleted successfully.", "success", 4500);
    return true;
  } catch (error) {
    console.error(`Firebase delete failed for ${path}:`, error);
    const code = error?.code || "";
    const detail = /permission|PERMISSION_DENIED/i.test(`${code} ${error?.message || ""}`)
      ? "Firebase denied the delete. Publish the included firebase-rules.json to your Firebase Realtime Database."
      : "Check your Firebase connection and try again.";
    showToast("Delete failed", detail, "error", 8000);
    return false;
  }
}

function deleteLiveVisitors() {
  return del("liveVisitors", "Delete all live tracking data?", "All live visitor/session tracking data was deleted.");
}

function deleteApplications() {
  return del("submittedApplications", "Delete all submitted applications?", "All submitted applications were deleted.");
}

async function deleteReferralData() {
  if (!confirm("Delete all referral data?")) return false;
  const user = auth?.currentUser;
  if (!user) {
    showToast("Authentication required", "Please sign in again before changing dashboard data.", "error", 6000);
    return false;
  }

  try {
    await Promise.all([
      db.ref("referrals").remove(),
      db.ref("referralJoins").remove(),
      db.ref("referralShares").remove(),
      db.ref("publicStats/applicationCount").set(0)
    ]);
    renderReferrals();
    showToast("Data cleared", "All referral data was deleted.", "success", 4500);
    return true;
  } catch (error) {
    console.error("Firebase referral delete failed:", error);
    showToast("Delete failed", "Firebase denied the operation or the connection was interrupted. Check the published Firebase rules.", "error", 8000);
    return false;
  }
}

async function resetDashboard() {
  if (!confirm("Reset all dashboard data?")) return false;
  const user = auth?.currentUser;
  if (!user) {
    showToast("Authentication required", "Please sign in again before resetting dashboard data.", "error", 6000);
    return false;
  }

  try {
    await Promise.all([
      db.ref("liveVisitors").remove(),
      db.ref("submittedApplications").remove(),
      db.ref("referrals").remove(),
      db.ref("referralJoins").remove(),
      db.ref("referralShares").remove()
    ]);

    applications = [];
    renderApplications();
    renderApplications();
    renderReferrals();

    showToast("Dashboard reset", "All dashboard data was successfully cleared.", "success", 5000);
    return true;
  } catch (error) {
    console.error("Firebase dashboard reset failed:", error);
    showToast("Reset failed", "Firebase denied one or more deletes. Publish the included Firebase rules and try again.", "error", 8000);
    return false;
  }
}

/* Google Sheets: Firebase recovery */
const SHEETS_RECOVERY_ENDPOINT = "https://script.google.com/macros/s/AKfycbykckN1IqJxrzGTbJt7FSC7z0F9h_2z2JhihsBncDoYlmXhaFhSc6b8PX5FL8HbkBPY-g/exec";
function parseApplicationTimestamp(raw) {
  if (raw === null || raw === undefined || raw === "") return NaN;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const text = String(raw).trim();
  if (/^\d{13}$/.test(text)) return Number(text);
  if (/^\d{10}$/.test(text)) return Number(text) * 1000;
  const m = text.match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const utc = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]) - 5, Number(m[5]) - 30, Number(m[6] || 0));
    return utc;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? NaN : parsed;
}
function isApplicationFromTodayIST(app) {
  const today = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata"}).format(new Date());
  for (const raw of [app?.submittedAtMs, app?.submittedAt, app?.timestamp, app?.createdAt, app?.createdAtMs]) {
    const ms = parseApplicationTimestamp(raw);
    if (!Number.isNaN(ms) && new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata"}).format(new Date(ms)) === today) return true;
  }
  return false;
}
async function sendApplicationsToSheets(applications, updateExisting = false) {
  await fetch(SHEETS_RECOVERY_ENDPOINT, {
    method:"POST", mode:"no-cors",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({action:"syncApplications", updateExisting, applications})
  });
}
async function syncTodayToSheets(){
  const btn=document.getElementById("syncTodaySheetsBtn"), status=document.getElementById("syncTodaySheetsStatus");
  if(!btn||!status)return;
  if(!confirm("Sync all applications from TODAY (IST) stored in Firebase to Google Sheets?\n\nExisting applications will be skipped automatically."))return;
  btn.disabled=true; btn.style.opacity=".65"; status.textContent="⏳ Reading today's applications from Firebase...";
  try{
    const snap=await db.ref("submittedApplications").once("value"), all=snap.val()||{};
    const applications=Object.entries(all).map(([key,app])=>({...app,applicationId:(app&&(app.applicationId||app.id))||key})).filter(isApplicationFromTodayIST);
    if(!applications.length){status.textContent="ℹ️ No applications from today were found in Firebase.";return;}
    status.textContent=`⏳ Found ${applications.length} today's application(s). Sending to Google Sheets...`;
    await sendApplicationsToSheets(applications);
    status.textContent=`✅ Recovery request sent for ${applications.length} today's application(s). Refresh the Sheet after 10–20 seconds.`;
    alert(`Recovery sync sent.\n\n${applications.length} today's application(s) were sent to Google Sheets.\n\nWait 10–20 seconds, then refresh the Sheet.`);
  }catch(e){console.error(e);status.textContent="❌ Recovery failed. Check the browser console for details.";alert("Recovery failed: "+(e.message||e));}
  finally{btn.disabled=false;btn.style.opacity="1";}
}
async function recoverAllFirebaseToSheets(){
  const btn=document.getElementById("recoverAllSheetsBtn"), status=document.getElementById("syncTodaySheetsStatus");
  if(!btn||!status)return;
  if(!confirm("Recover ALL applications currently stored in Firebase into Google Sheets?\n\nThis is safe to run: existing Sheet records are skipped automatically."))return;
  btn.disabled=true; btn.style.opacity=".65"; status.textContent="⏳ Reading all Firebase applications...";
  try{
    const snap=await db.ref("submittedApplications").once("value"), all=snap.val()||{};
    const applications=Object.entries(all).map(([key,app])=>({...app,applicationId:(app&&(app.applicationId||app.id))||key}));
    if(!applications.length){status.textContent="ℹ️ Firebase currently has no submitted applications.";return;}
    status.textContent=`⏳ Found ${applications.length} application(s). Sending recovery request...`;
    await sendApplicationsToSheets(applications);
    status.textContent=`✅ Recovery request sent for ${applications.length} application(s). Refresh the Sheet after 10–20 seconds.`;
    alert(`Full recovery sync sent.\n\n${applications.length} Firebase application(s) were sent to Google Sheets.\n\nWait 10–20 seconds, then refresh the Sheet.`);
  }catch(e){console.error(e);status.textContent="❌ Full recovery failed. Check the browser console for details.";alert("Full recovery failed: "+(e.message||e));}
  finally{btn.disabled=false;btn.style.opacity="1";}
}


/* === Single top-right navigation + focused popup workspace === */
(function setupCompactAdminWorkspace(){
  const menu = document.getElementById('adminModuleMenu');
  const hint = document.getElementById('adminModuleHint');
  const modal = document.getElementById('adminModuleModal');
  const modalBody = document.getElementById('adminModuleModalBody');
  const modalTitle = document.getElementById('adminModuleModalTitle');
  const modalSubtitle = document.getElementById('adminModuleModalSubtitle');
  const closeBtn = document.getElementById('closeAdminModuleModal');
  if(!menu || !modal || !modalBody) return;

  const titles = {
    applicationCRM: ['Application CRM', 'Search, contact, assign and manage every application.'],
    activity: ['Applications Activity', 'Live application flow and the last 7 days.'],
    analytics: ['College Insights', 'See which colleges are generating applications.'],
    liveVisitors: ['Live Visitors', 'Monitor active visitors and application sessions.'],
    landingPage: ['Open Landing Page', 'Return to the public InternsForge landing page.'],
    applicationVisitors: ['Total Application Visitors', 'See how many unique browser sessions have opened the application form.'],
    applications: ['Recent Applications', 'Review the latest submitted applications.'],
    domainInsights: ['Domain Insights', 'See application distribution by internship domain.'],
    referrals: ['Referral Management', 'Referral performance, leaderboard and friends joined.'],
    sheetsRecovery: ['Google Sheets', 'Recover and synchronize application data with Sheets.'],
    settings: ['Settings & Data Controls', 'Notifications, system health and data controls.']
  };

  const nodesFor = target => {
    if(target === 'referrals') return [...document.querySelectorAll('.admin-referral-module')];
    if(target === 'applicationCRM') return [document.getElementById('applicationCRM')];
    return [document.getElementById(target)];
  };

  const moved = new Map();

  function clearHint(){
    if(hint) hint.hidden = true;
  }

  function restoreModules(){
    [...moved.entries()].forEach(([node, placeholder]) => {
      if(placeholder.parentNode){
        placeholder.parentNode.insertBefore(node, placeholder.nextSibling);
        placeholder.remove();
      }
    });
    moved.clear();
  }

  function closeModule(){
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden','true');
    document.body.classList.remove('module-modal-open');
    menu.open = false;
    window.setTimeout(() => {
      restoreModules();
      if(hint){
        hint.hidden = false;
        hint.innerHTML = '<strong>Workspace ready</strong><span>Open <b>Control Hub</b> and choose a module. It will open in a focused popup, keeping this dashboard compact.</span>';
      }
    }, 180);
  }

  function openModule(target){
    if(target === 'dashboard'){
      closeModule();
      window.scrollTo({top:0,behavior:'smooth'});
      return;
    }

    const nodes = nodesFor(target).filter(Boolean);
    if(!nodes.length) return;

    restoreModules();
    modalBody.innerHTML = '';
    nodes.forEach(node => {
      const placeholder = document.createComment(`InternsForge module placeholder: ${node.id || node.className}`);
      node.parentNode.insertBefore(placeholder,node);
      moved.set(node,placeholder);
      modalBody.appendChild(node);
    });

    const [title, subtitle] = titles[target] || ['Workspace', 'Focused admin module.'];
    if(modalTitle) modalTitle.textContent = title;
    if(modalSubtitle) modalSubtitle.textContent = subtitle;
    clearHint();
    menu.open = false;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
    document.body.classList.add('module-modal-open');
    window.setTimeout(() => closeBtn?.focus(), 50);
  }

  menu.querySelectorAll('[data-admin-module]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.adminModule;
      if(target === 'landingPage'){
        menu.open = false;
        window.location.href = 'index.html';
        return;
      }
      openModule(target);
    });
  });

  closeBtn?.addEventListener('click', closeModule);
  modal.addEventListener('click', event => {
    if(event.target === modal) closeModule();
  });
  document.addEventListener('keydown', event => {
    if(event.key === 'Escape' && modal.classList.contains('show')) closeModule();
  });

  // The old left navigation and mobile bottom navigation are intentionally removed.
  document.querySelectorAll('.side-nav,.sidebar,.bottom-nav,.menu-toggle').forEach(node => node.remove());

  // Keep the dashboard itself compact: only the metric cards remain on the home view.
  document.querySelectorAll('.dashboard-grid.admin-module,.crm-section.admin-module,#sheetsRecovery.admin-module,#settings.admin-module,.admin-referral-module').forEach(node => {
    if(!moved.has(node)) node.classList.add('compact-hidden-module');
  });

  window.openAdminModule = openModule;
  window.closeAdminModule = closeModule;
})();

