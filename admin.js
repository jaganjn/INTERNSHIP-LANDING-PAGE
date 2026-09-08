
document.body.style.visibility = "hidden";

const ACTIVE_MS = 90_000;
const ABANDON_MS = 150_000;
const RETAIN_MS = 24 * 60 * 60 * 1000;
const ALERT_STORAGE_KEY = "apexAdminAlertSettingsV3";
const LEGACY_ALERT_STORAGE_KEY = "apexAdminAlertSettingsV2";
const BROWSER_ALERT_STORAGE_KEY = "apexAdminBrowserAlertsV1";
const SEEN_APPLICATIONS_KEY = "apexAdminSeenApplicationsV1";
const PUSH_TOKEN_STORAGE_KEY = "apexAdminPushTokenV1";

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
  sevenDayTotal: el("sevenDayTotal"),
  todayVsYesterday: el("todayVsYesterday"),
  totalReferralCodes: el("totalReferralCodes"),
  successfulReferrals: el("successfulReferrals"),
  referralConversionRate: el("referralConversionRate"),
  topAmbassador: el("topAmbassador"),
  topAmbassadorCount: el("topAmbassadorCount"),
  referralLeaderboardBody: el("referralLeaderboardBody"),
  referralFriendsBody: el("referralFriendsBody"),
  referralSearch: el("referralSearch")
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
  const defaults = { enabled: false, volume: 90 };
  try {
    // Keep the notification sound preference in persistent localStorage.
    // Migrate the previous key once so an already-enabled admin stays enabled.
    let raw = localStorage.getItem(ALERT_STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_ALERT_STORAGE_KEY);
      if (raw) localStorage.setItem(ALERT_STORAGE_KEY, raw);
    }
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      enabled: parsed.enabled === true,
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
        <div><small>State / UT</small><strong>${esc(visitor.fieldData?.state || visitor.state || "—")}</strong></div>
        <div><small>Language</small><strong>${esc(visitor.fieldData?.communicationLanguage || visitor.communicationLanguage || "—")}</strong></div>
        <div><small>Start</small><strong>${esc(visitor.fieldData?.startAvailability || visitor.startAvailability || "—")}</strong></div>
        <div><small>Reason</small><strong>${esc(visitor.fieldData?.applicationReason || visitor.applicationReason || "—")}</strong></div>
        <div><small>Domain</small><strong>${esc(visitor.fieldData?.domain || visitor.domain || "—")}</strong></div>
        <div><small>Consent</small><strong>${(visitor.fieldData?.consent ?? false) ? "Accepted" : "Not accepted"}</strong></div>
        <div><small>Device</small><strong>${esc(visitor.environment?.deviceType || "—")}</strong></div>
        <div><small>Browser</small><strong>${esc(visitor.environment?.browser || "—")}</strong></div>
        <div><small>OS</small><strong>${esc(visitor.environment?.os || "—")}</strong></div>
        <div><small>Referrer</small><strong>${esc(visitor.environment?.referrer || visitor.referredBy || "Direct")}</strong></div>
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
  if (E.abandonedCount) E.abandonedCount.textContent = abandoned.length;
  E.submittedCount.textContent = todayApplications.length;

  const sessionDenominator = Math.max(todaySessions.length, todayApplications.length);
  if (E.conversionRate) E.conversionRate.textContent = sessionDenominator
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
    const timestamp = asMs(app.submittedAtMs || app.submittedAt);
    if (timestamp) {
      const key = getISTDateKey(timestamp);
      daily[key] = (daily[key] || 0) + 1;
    }
  });

  E.recentApplications.innerHTML = applications.slice(0, 8).map(app => `
    <article class="application-item ${newIds.has(app.id) ? "new-application" : ""}">
      <div class="application-top">
        <div>
          <strong>${esc(app.name || "Unknown")}</strong>
          <small>${esc(app.college || "—")} • ${esc(app.state || "—")} • ${esc(app.domain || "—")}</small>
        </div>
        <span class="status ${(app.adminStatus||'new') === 'selected' ? 'submitted' : (app.adminStatus||'new')}">${esc(({new:'New',reviewed:'Reviewed',shortlisted:'Shortlisted',selected:'Selected',rejected:'Rejected'}[(app.adminStatus||'new')] || 'New'))}</span>
      </div>
      <small>${fmt(app.submittedAtMs || app.submittedAt)}</small>
    </article>
  `).join("") || '<p class="empty">No applications yet.</p>';

  renderRank(E.topColleges, college);
  renderRank(E.topDomains, domain);

  const today = getTodayISTKey();
  const days = [...Array(7)].map((_, index) => {
    const [year, month, day] = today.split("-").map(Number);
    // Build the day from an IST noon anchor to avoid DST/local-midnight shifts.
    const date = new Date(Date.UTC(year, month - 1, day, 6, 30, 0) - (6 - index) * 24 * 60 * 60 * 1000);
    return {
      date,
      key: getISTDateKey(date.getTime())
    };
  });
  const max = Math.max(1, ...days.map(item => daily[item.key] || 0));
  const sevenDayTotal = days.reduce((sum, item) => sum + (daily[item.key] || 0), 0);
  const todayCount = daily[today] || 0;
  const [ty, tm, td] = today.split("-").map(Number);
  const previousDate = new Date(Date.UTC(ty, tm - 1, td, 6, 30, 0) - 24 * 60 * 60 * 1000);
  const previousKey = getISTDateKey(previousDate.getTime());
  const previousCount = daily[previousKey] || 0;
  const vsPrevious = previousCount === 0 ? (todayCount ? 100 : 0) : Math.round(((todayCount - previousCount) / previousCount) * 100);
  E.sevenDayTotal?.replaceChildren(document.createTextNode(String(sevenDayTotal)));
  const trendTarget = E.todayVsYesterday;
  if (trendTarget) {
    trendTarget.textContent = `${vsPrevious >= 0 ? "+" : ""}${vsPrevious}%`;
    trendTarget.style.color = vsPrevious >= 0 ? "#70e9ba" : "#ff8d9c";
  }

  E.applicationsChart.innerHTML = days.map(({ date, key }) => {
    const count = daily[key] || 0;
    const height = count ? Math.max(7, (count / max) * 100) : 3;
    return `
      <div class="chart-day" title="${count} application${count === 1 ? "" : "s"}">
        <div class="chart-track" style="--bar-h:${height}%">
          <b class="chart-value">${count}</b>
          <span class="chart-bar" style="height:${height}%"></span>
        </div>
        <small>${date.toLocaleDateString("en-IN", { weekday: "short" })}<br>${date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</small>
      </div>
    `;
  }).join("");

  renderVisitors();
  renderReferrals();
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

function unlockAudio() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") audioContext.resume();
    soundUnlocked = true;
  } catch {
    soundUnlocked = false;
  }
}

function playNotificationSound() {
  const settings = getAlertSettings();
  if (!settings.enabled) return;

  unlockAudio();
  if (!audioContext || !soundUnlocked) return;

  const now = audioContext.currentTime;
  const volume = Math.max(0.01, settings.volume / 100);
  const master = audioContext.createGain();

  // Strong two-stage alert designed to remain audible on mobile speakers.
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
    const start = now + note.start;
    const end = start + note.duration;

    oscillator.type = note.type;
    oscillator.frequency.setValueAtTime(note.frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.level, start + 0.012);
    gain.gain.setValueAtTime(note.level, Math.max(start + 0.013, end - 0.06));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  });
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

  document.title = `(${newItems.length}) New Application${newItems.length > 1 ? "s" : ""} — InternsForge`;
  window.setTimeout(() => {
    document.title = "InternsForge — Admin Dashboard";
  }, 8000);

  return new Set(newItems.map(app => app.id));
}

async function refreshLiveVisitors() {
  try {
    const snapshot = await db.ref("liveVisitors").once("value");
    visitors = snapshot.val() || {};
    renderVisitors();
    updateStamp("Live visitors refreshed");
    return true;
  } catch (error) {
    console.error("Live visitor refresh failed:", error);
    showToast("Live visitor refresh failed", "Check Firebase connection and database rules.", "error", 6000);
    return false;
  }
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

  const headers = ["Name", "Phone", "Email", "College", "Department", "Year", "State / UT", "Communication Language", "Start Availability", "Application Reason", "Domain", "Referral Code", "Submitted At"];
  const rows = applications.map(app => [
    app.name, app.phone, app.email, app.college, app.department, app.year,
    app.state || "", app.communicationLanguage || "", app.startAvailability || "", app.applicationReason || "",
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

  el("soundEnabled")?.addEventListener("change", () => {
    unlockAudio();
    persist();
    if (el("soundEnabled").checked) {
      playNotificationSound();
      showToast("Sound alerts enabled", "A tone will play for each new application.", "success");
    }
  });

  el("notificationVolume")?.addEventListener("input", () => {
    persist();
  });

  el("testSoundButton")?.addEventListener("click", () => {
    unlockAudio();
    const settings = getAlertSettings();
    if (!settings.enabled) {
      saveAlertSettings({ ...settings, enabled: true });
      updateSoundUi();
    }
    playNotificationSound();
    showToast("Test notification", "This is the new-application alert sound.", "info");
  });

  el("soundQuickToggle")?.addEventListener("click", () => {
    unlockAudio();
    const settings = getAlertSettings();
    saveAlertSettings({ ...settings, enabled: !settings.enabled });
    updateSoundUi();
    if (!settings.enabled) playNotificationSound();
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

  document.addEventListener("pointerdown", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });
}

function listeners() {
  if (started) return;
  started = true;

  // Use one authoritative value listener for liveVisitors. This keeps the
  // dashboard in sync even when several visitor records change at once,
  // and avoids stale local child-state during manual refreshes.
  const visitorRoot = db.ref("liveVisitors");
  visitorRoot.on("value", snapshot => {
    visitors = snapshot.val() || {};
    renderVisitors();
    updateStamp("Live visitors updated");
  }, error => {
    console.error("Live visitor listener failed:", error);
    showToast("Live visitors unavailable", "Firebase could not read live visitor data.", "error", 6000);
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
  // Safety refresh: the realtime listener remains primary, while this
  // lightweight read repairs any missed event after a reconnect/tab sleep.
  window.setInterval(() => refreshLiveVisitors(), 10_000);
  window.setInterval(() => cleanupStale().catch(console.warn), 30_000);

  E.referralSearch?.addEventListener("input", () => {
    const query = E.referralSearch.value.toLowerCase();
    renderFriends(friendRows.filter(item =>
      [item.applicantName, item.code, item.applicantCollege, item.applicantDomain]
        .some(value => String(value || "").toLowerCase().includes(query))
    ));
  });
}

async function verifyDashboardDataAccess(){
  const checks = [
    ['liveVisitors','Live tracking'],
    ['submittedApplications','Applications'],
    ['referralJoins','Referrals']
  ];
  const results = await Promise.all(checks.map(async ([path,label]) => {
    try { await db.ref(path).limitToFirst(1).once('value'); return [label,true,'OK']; }
    catch(error){ console.warn(`${label} access check failed`, error); return [label,false,(error?.code||'Denied').replace(/^PERMISSION_DENIED:?\s*/,'Permission denied')]; }
  }));
  const denied = results.filter(([,ok])=>!ok);
  const dbText = el('databaseHealthText');
  if(dbText) dbText.textContent = denied.length ? `${denied.length} data source${denied.length>1?'s':''} denied` : 'Realtime Database: all core reads OK';
  const visitorOk = results.find(([label])=>label==='Live tracking')?.[1];
  const vh=el('visitorHealthText'), vd=el('visitorHealthDot');
  if(vh) vh.textContent = visitorOk ? 'Realtime read OK' : 'Read denied';
  vd?.classList.toggle('healthy',!!visitorOk); vd?.classList.toggle('unhealthy',!visitorOk);
  const fh=el('firebaseHealthText'); if(fh && denied.length) fh.textContent = 'Connected · partial access';
}

function setupHeaderNavigation() {
  const wrap = el("navMenuWrap");
  const button = el("navMenuButton");
  const panel = el("navMenuPanel");
  const close = el("navMenuClose");
  const viewer = el("sectionViewerModal");
  const viewerBody = el("sectionViewerBody");
  const viewerTitle = el("sectionViewerTitle");
  const viewerSubtitle = el("sectionViewerSubtitle");
  const viewerClose = el("sectionViewerClose");
  if(!button || !panel) return;

  let openSectionId = "";
  let openSectionNode = null;
  let openSectionPlaceholder = null;
  let savedScrollY = 0;

  const setMenuOpen = (open) => {
    button.setAttribute("aria-expanded", String(open));
    panel.hidden = !open;
  };

  const titleMap = {
    dashboard: ["OVERVIEW", "Operations dashboard", "A focused view of today’s internship operations."],
    liveVisitors: ["MONITORING", "Live visitors", "Realtime visitor presence and form activity."],
    activity: ["MONITORING", "Activity feed", "Recent operational events detected by the admin console."],
    applications: ["APPLICATIONS", "Recent applications", "Recent submissions with a direct path to the full application manager."],
    analytics: ["APPLICATIONS", "Application analytics", "Seven-day submission pulse based on Firebase submission timestamps."],
    funnel: ["APPLICATIONS", "Funnel & performance", "Observed visitor journey and domain performance indicators."],
    referralOverview: ["REFERRALS", "Referral performance", "Referral metrics, leaderboard and friends-joined activity."],
    referralLeaderboard: ["REFERRALS", "Referral leaderboard", "Top-performing referral ambassadors and successful joins."],
    referralFriends: ["REFERRALS", "Friends joined", "Applicants who joined through referral activity."],
    settings: ["OPERATIONS", "Settings & health", "Notifications, system health and administrative controls."]
  };

  const closeViewer = () => {
    if(openSectionNode && openSectionPlaceholder?.parentNode){
      openSectionPlaceholder.parentNode.replaceChild(openSectionNode, openSectionPlaceholder);
    }
    if(openSectionNode) openSectionNode.classList.remove("in-viewer");
    openSectionNode = null;
    openSectionPlaceholder = null;
    openSectionId = "";
    if(viewerBody) viewerBody.innerHTML = "";
    viewer?.classList.remove("open");
    viewer?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("section-viewer-open");
    window.requestAnimationFrame(() => window.scrollTo(0, savedScrollY));
  };

  const openViewer = (targetId) => {
    const target = el(targetId);
    if(!target || !viewer || !viewerBody) return;

    closeViewer();
    const meta = titleMap[targetId] || ["ADMIN VIEW", targetId, "Focused workspace"];
    if(viewerTitle) viewerTitle.textContent = meta[1];
    if(viewerSubtitle) viewerSubtitle.textContent = meta[2];
    const eyebrow = el("sectionViewerEyebrow");
    if(eyebrow) eyebrow.textContent = meta[0];

    savedScrollY = window.scrollY || window.pageYOffset || 0;
    openSectionId = targetId;
    openSectionNode = target;
    target.classList.add("in-viewer");
    openSectionPlaceholder = document.createComment(`InternsForge placeholder: ${targetId}`);
    target.parentNode.insertBefore(openSectionPlaceholder, target);
    viewerBody.appendChild(target);

    setMenuOpen(false);
    viewer.classList.add("open");
    viewer.setAttribute("aria-hidden", "false");
    document.body.classList.add("section-viewer-open");
    window.requestAnimationFrame(() => window.scrollTo(0, savedScrollY));
  };

  button.addEventListener("click", (event) => { event.stopPropagation(); setMenuOpen(panel.hidden); });
  close?.addEventListener("click", () => setMenuOpen(false));

  panel.querySelectorAll("a[data-popup-target]").forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openViewer(link.dataset.popupTarget);
    });
  });

  el("navResetPassword")?.addEventListener("click", () => { setMenuOpen(false); resetAdminPassword(); });
  el("navLogout")?.addEventListener("click", () => { setMenuOpen(false); logout(); });
  document.addEventListener("click", (event) => { if(wrap && !wrap.contains(event.target)) setMenuOpen(false); });
  document.addEventListener("keydown", (event) => {
    if(event.key === "Escape") {
      if(viewer?.classList.contains("open")) closeViewer();
      else setMenuOpen(false);
    }
  });
  viewerClose?.addEventListener("click", closeViewer);
  viewer?.querySelectorAll("[data-close-section-viewer]").forEach(node => node.addEventListener("click", closeViewer));
}

function setupUI() {
  setupHeaderNavigation();
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

  el("refreshDashboardButton")?.addEventListener("click", refreshLiveVisitorsOnly);
  el("exportApplicationsButton")?.addEventListener("click", exportApplicationsCsv);
  setupNotificationSettings();
  window.setTimeout(verifyDashboardDataAccess, 450);

  db.ref(".info/connected").on("value", snapshot => {
    const live = snapshot.val() === true;
    el("portalLiveStatus").classList.toggle("is-offline", !live);
    el("portalLiveText").textContent = live ? "Firebase Live" : "Reconnecting";
    el("firebaseHealthDot")?.classList.toggle("healthy", live);
    el("firebaseHealthDot")?.classList.toggle("unhealthy", !live);
    if (el("firebaseHealthText")) el("firebaseHealthText").textContent = live ? "Connected" : "Offline";
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
      await db.ref("publicStats/applicationCount").set(0).catch(() => {});
      renderApplications();
      window.__internsforgeUpdateAdvancedMetrics?.();
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
      db.ref("referralShares").remove(),
      db.ref("publicStats/applicationCount").set(0)
    ]);

    applications = [];
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

/* =========================================================
   V5.40 — Admin Intelligence Layer
   Built on existing Firebase paths; no new paid services required.
   ========================================================= */
(function installAdminIntelligence(){
  const ACTIVITY_KEY = 'internsforgeAdminActivityV1';
  const ADMIN_STATUS_KEY = 'adminStatus';
  const ADMIN_NOTES_KEY = 'adminNotes';
  const ADMIN_UPDATED_AT_KEY = 'adminUpdatedAt';
  let activityItems = [];
  let lastVisitorSnapshot = {};
  let selectedApplicationId = '';
  let managerPage = 1;
  const PAGE_SIZE = 12;
  let managerFiltered = [];

  const getEl = id => document.getElementById(id);
  const safeArray = value => Array.isArray(value) ? value : [];

  function readActivity(){
    try { return safeArray(JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]')); } catch { return []; }
  }
  function saveActivity(){
    try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activityItems.slice(0, 80))); } catch {}
  }
  function activityIcon(type){
    return type === 'application' ? '✓' : type === 'filling' ? '✎' : type === 'visitor' ? '◉' : type === 'status' ? '↺' : '•';
  }
  function addActivity(type, title, detail, timestamp = Date.now()){
    const item = { id: `${timestamp}_${Math.random().toString(36).slice(2,8)}`, type, title, detail, timestamp };
    const duplicate = activityItems.find(existing => existing.title === item.title && existing.detail === item.detail && Math.abs(existing.timestamp - timestamp) < 1200);
    if (duplicate) return;
    activityItems.unshift(item);
    activityItems = activityItems.slice(0, 80);
    saveActivity();
    renderActivityFeed();
  }
  function seedActivity(){
    activityItems = readActivity();
    if (!activityItems.length){
      const recentApps = applications.slice(0, 6);
      recentApps.forEach(app => addActivity('application', 'Application submitted', `${app.name || 'Student'} • ${app.domain || 'Domain not selected'}`, asMs(app.submittedAtMs || app.submittedAt) || Date.now()));
      Object.entries(visitors).filter(([,v]) => sessionState(v) === 'filling').slice(0, 6).forEach(([,v]) => {
        addActivity('filling', 'Student is filling the application', `${v.fieldData?.name || v.name || 'Anonymous'} • ${v.currentField || 'Application form'}`, asMs(v.lastActive) || Date.now());
      });
    }
    renderActivityFeed();
  }
  function renderActivityFeed(){
    const target = getEl('activityFeed');
    if (!target) return;
    const rows = activityItems.sort((a,b)=>b.timestamp-a.timestamp).slice(0, 60);
    target.innerHTML = rows.length ? rows.map(item => `
      <div class="activity-item">
        <span class="activity-icon ${item.type==='application'?'green':''}">${activityIcon(item.type)}</span>
        <div><strong>${esc(item.title)}</strong><small>${esc(item.detail || '')}</small></div>
        <time>${fmt(item.timestamp)}</time>
      </div>
    `).join('') : '<p class="empty">Activity will appear here as the portal is used.</p>';
  }

  function countMap(items){
    const out = {};
    items.forEach(value => { const key = String(value || '').trim(); if (key) out[key] = (out[key] || 0) + 1; });
    return out;
  }
  function renderPills(targetId, map, limit=5){
    const target = getEl(targetId); if (!target) return;
    const rows = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,limit);
    target.innerHTML = rows.length ? rows.map(([name,count])=>`<span class="compact-pill"><span>${esc(name)}</span><b>${count}</b></span>`).join('') : '<span class="compact-pill">No data</span>';
  }
  function breakdownMarkup(map, targetId){
    const target = getEl(targetId); if(!target) return;
    const rows = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const max = rows[0]?.[1] || 1;
    target.innerHTML = rows.length ? `<div class="breakdown-list">${rows.map(([name,count])=>`
      <div class="breakdown-item"><label title="${esc(name)}">${esc(name)}</label><div class="track"><i style="width:${(count/max)*100}%"></i></div><b>${count}</b></div>
    `).join('')}</div>` : '<p class="empty">No data yet.</p>';
  }

  function appStatus(app){ return String(app?.[ADMIN_STATUS_KEY] || 'new').toLowerCase(); }
  function appStatusLabel(status){
    return {new:'New',reviewed:'Reviewed',shortlisted:'Shortlisted',selected:'Selected',rejected:'Rejected'}[status] || 'New';
  }
  function statusBadge(status){ return `<span class="status-badge status-${esc(status)}">${esc(appStatusLabel(status))}</span>`; }

  function updateAdvancedMetrics(){
    getEl('allTimeApplications')?.replaceChildren(document.createTextNode(String(applications.length)));
    const successful = Object.values(referralJoins).reduce((sum,joins)=>sum+Object.keys(joins||{}).length,0);
    getEl('totalReferralJoinsMetric')?.replaceChildren(document.createTextNode(String(successful)));

    const statusCounts = applications.reduce((acc, app) => {
      const status = appStatus(app);
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    getEl('shortlistedMetric')?.replaceChildren(document.createTextNode(String(statusCounts.shortlisted || 0)));
    getEl('selectedMetric')?.replaceChildren(document.createTextNode(String(statusCounts.selected || 0)));
    renderStatusSnapshot(statusCounts);

    const domainMap = countMap(applications.map(app=>app.domain));
    const topDomain = Object.entries(domainMap).sort((a,b)=>b[1]-a[1])[0];
    const topMetric = getEl('topDomainMetric');
    const topMetricSub = getEl('topDomainMetricSub');
    if (topMetric) topMetric.textContent = topDomain?.[0] || '—';
    if (topMetricSub) topMetricSub.textContent = topDomain ? `${topDomain[1]} application${topDomain[1] === 1 ? '' : 's'}` : 'No applications yet';

    const states = countMap(applications.map(app=>app.state));
    const languages = countMap(applications.map(app=>app.communicationLanguage || app.language));
    const years = countMap(applications.map(app=>app.year));
    renderPills('topStates', states); renderPills('topLanguages', languages); renderPills('topYears', years);
    breakdownMarkup(countMap(applications.map(app=>app.startAvailability)), 'startBreakdown');
    breakdownMarkup(languages, 'languageBreakdown');
    breakdownMarkup(states, 'stateBreakdown');
    renderFunnel(); renderDomainPerformance();
  }

  function renderStatusSnapshot(statusCounts = {}){
    const target = getEl('statusSnapshot'); if(!target) return;
    const items = [
      ['new','New','#5b7cff'],
      ['reviewed','Reviewed','#38c9ff'],
      ['shortlisted','Shortlisted','#9a6bff'],
      ['selected','Selected','#2ad59a'],
      ['rejected','Rejected','#fb6479']
    ];
    const total = applications.length || 1;
    target.innerHTML = items.map(([key,label,color]) => {
      const count = statusCounts[key] || 0;
      return `<div class="status-row"><label>${label}</label><i style="--w:${Math.round((count/total)*100)}%;--c:${color}"></i><span>${count}</span></div>`;
    }).join('');
  }

  function getVisitorRows(){
    return Object.entries(visitors).map(([id,v])=>({id,...v,state:sessionState(v)}));
  }
  function renderFunnel(){
    const target = getEl('applicationFunnel'); if(!target) return;
    const todayKey = getTodayISTKey();
    const todayVisitors = getVisitorRows().filter(v=>getISTDateKey(v.startedAt)===todayKey);
    const sessions = todayVisitors.length;
    const started = todayVisitors.filter(v=>Number(v.formProgress||0)>0 || v.hasStartedFilling === true).length;
    const reviewing = todayVisitors.filter(v=>Number(v.formProgress||0)>=80).length;
    const submitted = applications.filter(a=>getISTDateKey(a.submittedAtMs||a.submittedAt)===todayKey).length;
    const max = Math.max(1,sessions,started,reviewing,submitted);
    const steps = [
      ['Visitor records observed', sessions],
      ['Form started', started],
      ['80%+ form progress', reviewing],
      ['Applications submitted', submitted]
    ];
    target.innerHTML = steps.map(([label,count],index)=>{
      const rate = index===0 ? 100 : sessions ? Math.min(100,Math.round((count/sessions)*100)) : 0;
      return `<div><div class="funnel-row"><label>${esc(label)}</label><div class="funnel-track"><i style="width:${Math.max(count?5:0,(count/max)*100)}%"></i></div><span class="funnel-count">${count}</span></div><div class="funnel-rate">${rate}% of observed visitor records</div></div>`;
    }).join('');
  }
  function renderDomainPerformance(){
    const target = getEl('domainPerformance'); if(!target) return;
    const visitorMap = countMap(getVisitorRows().map(v=>v.fieldData?.domain || v.domain).filter(Boolean));
    const applicationMap = countMap(applications.map(app=>app.domain).filter(Boolean));
    const domains = [...new Set([...Object.keys(visitorMap), ...Object.keys(applicationMap)])]
      .map(domain=>({domain, visitors:visitorMap[domain]||0, applications:applicationMap[domain]||0}))
      .sort((a,b)=>b.applications-a.applications || b.visitors-a.visitors)
      .slice(0,8);
    const max = Math.max(1,...domains.map(r=>Math.max(r.applications,r.visitors)));
    target.innerHTML = domains.length ? domains.map(r=>`<div class="performance-row"><div><strong>${esc(r.domain)}</strong><small>${r.visitors} observed visitor record${r.visitors===1?'':'s'} (retained)</small></div><div class="performance-metric"><b>${r.applications}</b><small>applications</small></div><div class="performance-metric"><b>${r.applications ? Math.round((r.applications/(applications.length||1))*100) : 0}%</b><small>of all apps</small></div><div class="performance-bar"><i style="width:${Math.max(r.applications?5:0,(Math.max(r.visitors,r.applications)/max)*100)}%"></i></div></div>`).join('') : '<p class="empty">Domain activity will appear as students interact with the portal.</p>';
  }

  function getManagerRows(){
    const query = String(getEl('applicationSearch')?.value || '').trim().toLowerCase();
    const domain = getEl('applicationDomainFilter')?.value || '';
    const state = getEl('applicationStateFilter')?.value || '';
    const year = getEl('applicationYearFilter')?.value || '';
    const language = getEl('applicationLanguageFilter')?.value || '';
    const status = getEl('applicationStatusFilter')?.value || '';
    managerFiltered = applications.filter(app=>{
      const haystack = [app.id,app.name,app.email,app.phone,app.college,app.department,app.domain,app.state,app.communicationLanguage,app.language,app.year].map(v=>String(v||'').toLowerCase()).join(' ');
      return (!query || haystack.includes(query)) && (!domain || String(app.domain||'')===domain) && (!state || String(app.state||'')===state) && (!year || String(app.year||'')===year) && (!language || String(app.communicationLanguage||app.language||'')===language) && (!status || appStatus(app)===status);
    });
    managerFiltered.sort((a,b)=>asMs(b.submittedAtMs||b.submittedAt)-asMs(a.submittedAtMs||a.submittedAt));
    return managerFiltered;
  }
  function refreshFilterOptions(){
    const domainSelect = getEl('applicationDomainFilter'); const stateSelect = getEl('applicationStateFilter'); const yearSelect = getEl('applicationYearFilter'); const languageSelect = getEl('applicationLanguageFilter');
    const domains = [...new Set(applications.map(a=>String(a.domain||'').trim()).filter(Boolean))].sort();
    const states = [...new Set(applications.map(a=>String(a.state||'').trim()).filter(Boolean))].sort();
    const years = [...new Set(applications.map(a=>String(a.year||'').trim()).filter(Boolean))].sort();
    const languages = [...new Set(applications.map(a=>String(a.communicationLanguage||a.language||'').trim()).filter(Boolean))].sort();
    if(domainSelect){const current=domainSelect.value;domainSelect.innerHTML='<option value="">All domains</option>'+domains.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');domainSelect.value=current;}
    if(stateSelect){const current=stateSelect.value;stateSelect.innerHTML='<option value="">All states</option>'+states.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');stateSelect.value=current;}
    if(yearSelect){const current=yearSelect.value;yearSelect.innerHTML='<option value="">All years</option>'+years.map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('');yearSelect.value=current;}
    if(languageSelect){const current=languageSelect.value;languageSelect.innerHTML='<option value="">All languages</option>'+languages.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join('');languageSelect.value=current;}
  }
  function renderApplicationManager(){
    const rows = getManagerRows();
    const totalPages = Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
    managerPage = Math.min(Math.max(1,managerPage),totalPages);
    const start = (managerPage-1)*PAGE_SIZE;
    const pageRows = rows.slice(start,start+PAGE_SIZE);
    const target = getEl('applicationManagerBody');
    if(target) target.innerHTML = pageRows.length ? pageRows.map(app=>`
      <tr>
        <td><div class="manager-person"><span class="person-avatar">${esc((app.name||'?').trim().charAt(0).toUpperCase())}</span><div class="person-main"><strong>${esc(app.name||'Unknown')}</strong><small>${esc(app.email||'—')}</small></div></div></td>
        <td>${esc(app.college||'—')}<small>${esc(app.department||'—')} • ${esc(app.year||'—')}</small></td>
        <td>${esc(app.domain||'—')}<small>${esc(app.state||'—')}</small></td>
        <td><select class="status-select" data-inline-status="${esc(app.id)}"><option value="new" ${appStatus(app)==='new'?'selected':''}>New</option><option value="reviewed" ${appStatus(app)==='reviewed'?'selected':''}>Reviewed</option><option value="shortlisted" ${appStatus(app)==='shortlisted'?'selected':''}>Shortlisted</option><option value="selected" ${appStatus(app)==='selected'?'selected':''}>Selected</option><option value="rejected" ${appStatus(app)==='rejected'?'selected':''}>Rejected</option></select></td>
        <td>${fmt(app.submittedAtMs||app.submittedAt)}</td>
        <td><button type="button" class="row-action" data-open-application="${esc(app.id)}">View</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty">No applications match the current filters.</td></tr>';
    getEl('managerCountLabel').textContent = `${rows.length} record${rows.length===1?'':'s'}`;
    getEl('managerPageInfo').textContent = `Page ${managerPage} of ${totalPages}`;
    getEl('managerPrev').disabled = managerPage<=1; getEl('managerNext').disabled = managerPage>=totalPages;
  }

  function openManager(){
    refreshFilterOptions(); managerPage=1; renderApplicationManager();
    const modal=getEl('applicationManagerModal'); modal?.classList.add('open'); modal?.setAttribute('aria-hidden','false');
  }
  function closeManager(){const modal=getEl('applicationManagerModal'); modal?.classList.remove('open'); modal?.setAttribute('aria-hidden','true');}
  function findApp(id){return applications.find(app=>app.id===id);}
  function openDetail(id){
    const app=findApp(id); if(!app) return;
    selectedApplicationId=id;
    getEl('detailTitle').textContent=app.name||'Applicant';
    getEl('detailSubTitle').textContent=`${app.email||'No email'} • ${app.domain||'No domain'} • ${fmt(app.submittedAtMs||app.submittedAt)}`;
    const fields=[['Application ID',app.id],['Phone / WhatsApp',app.phone],['Email',app.email],['College',app.college],['Department',app.department],['Year',app.year],['State / UT',app.state],['Communication Language',app.communicationLanguage||app.language],['Start Availability',app.startAvailability],['Interested Domain',app.domain],['Reason for Applying',app.applicationReason],['Referral Code',app.referralCode],['Referred By',app.referredBy],['Submitted',fmt(app.submittedAtMs||app.submittedAt)],['Status',appStatusLabel(appStatus(app))],['Admin Note',app[ADMIN_NOTES_KEY]||'No note yet']];
    getEl('applicationDetailBody').innerHTML=fields.map(([label,value])=>`<div class="detail-card ${String(value||'').length>120?'wide':''}"><small>${esc(label)}</small><strong>${esc(value||'—')}</strong></div>`).join('');
    getEl('detailStatus').value=appStatus(app);
    getEl('detailNotes').value=app[ADMIN_NOTES_KEY]||'';
    const modal=getEl('applicationDetailModal'); modal?.classList.add('open'); modal?.setAttribute('aria-hidden','false');
  }
  function closeDetail(){const modal=getEl('applicationDetailModal'); modal?.classList.remove('open'); modal?.setAttribute('aria-hidden','true');selectedApplicationId='';}
  async function saveAppDetails(){
    const app=findApp(selectedApplicationId); if(!app) return;
    const user=auth?.currentUser; if(!user){showToast('Authentication required','Please sign in again.','error');return;}
    const status=getEl('detailStatus').value; const notes=getEl('detailNotes').value.trim();
    try{
      await db.ref(`submittedApplications/${selectedApplicationId}`).update({[ADMIN_STATUS_KEY]:status,[ADMIN_NOTES_KEY]:notes,[ADMIN_UPDATED_AT_KEY]:firebase.database.ServerValue.TIMESTAMP});
      showToast('Application updated',`${app.name||'Applicant'} marked ${appStatusLabel(status)}.`,'success',4500);
      addActivity('status','Application status updated',`${app.name||'Applicant'} → ${appStatusLabel(status)}`);
      closeDetail();
    }catch(error){console.error('Application status update failed:',error);showToast('Update failed',error?.message||'Firebase denied the update.','error',7000);}
  }
  async function inlineStatus(id,status){
    try{
      await db.ref(`submittedApplications/${id}`).update({[ADMIN_STATUS_KEY]:status,[ADMIN_UPDATED_AT_KEY]:firebase.database.ServerValue.TIMESTAMP});
      const app=findApp(id); addActivity('status','Application status updated',`${app?.name||'Applicant'} → ${appStatusLabel(status)}`);
      showToast('Status saved',`${app?.name||'Applicant'} → ${appStatusLabel(status)}.`,'success',3200);
    }catch(error){console.error(error);showToast('Status update failed','Firebase denied the update.','error',6500);}
  }
  function exportManager(){
    const rows=getManagerRows();
    const headers=['Application ID','Name','Phone','Email','College','Department','Year','State','Communication Language','Start Availability','Application Reason','Domain','Referral Code','Referred By','Status','Admin Notes','Submitted At'];
    const data=rows.map(app=>[app.id,app.name,app.phone,app.email,app.college,app.department,app.year,app.state,app.communicationLanguage||app.language,app.startAvailability,app.applicationReason,app.domain,app.referralCode,app.referredBy,appStatusLabel(appStatus(app)),app[ADMIN_NOTES_KEY],app.submittedAtMs||app.submittedAt]);
    const csv=[headers,...data].map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`internsforge-filtered-applications-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);showToast('Filtered CSV exported',`${rows.length} applications exported.`,'success');
  }

  function enhanceLiveVisitorCards(){
    const target=getEl('visitorList'); if(!target) return;
    target.querySelectorAll('.visitor-card').forEach(card=>{
      // Cards are rendered by the base dashboard; the summary strip is handled below.
    });
    const rows=getVisitorRows();
    const active=rows.filter(v=>['active','filling'].includes(v.state)).length;
    const filling=rows.filter(v=>v.state==='filling').length;
    const abandoned=rows.filter(v=>v.state==='abandoned').length;
    const submitted=rows.filter(v=>v.state==='submitted').length;
    const strip=getEl('liveVisitorSummary');
    if(strip) strip.innerHTML=`<span><b>${active}</b> active</span><span><b>${filling}</b> filling</span><span><b>${abandoned}</b> abandoned</span><span><b>${submitted}</b> completed</span>`;
  }

  function renderAdvancedAll(){
    updateAdvancedMetrics();
    enhanceLiveVisitorCards();
    seedActivity();
  }

  function watchVisitorChanges(){
    db.ref('liveVisitors').on('value', snap=>{
      const next=snap.val()||{};
      Object.entries(next).forEach(([id,v])=>{
        const prev=lastVisitorSnapshot[id];
        if(!prev) addActivity('visitor','New visitor joined',`${v.fieldData?.name||v.name||'Anonymous'} • ${v.page||'Application Portal'}`);
        const prevProgress=Number(prev?.formProgress||0), nextProgress=Number(v?.formProgress||0);
        if(!prev && nextProgress>0) addActivity('filling','Application started',`${v.fieldData?.name||v.name||'Anonymous'} • ${v.currentField||'Form'}`);
        else if(prev && prevProgress===0 && nextProgress>0) addActivity('filling','Application started',`${v.fieldData?.name||v.name||'Anonymous'} • ${v.currentField||'Form'}`);
        if(prev && prev.status!=='submitted' && v.status==='submitted') addActivity('application','Application submitted',`${v.fieldData?.name||v.name||'Student'} • ${v.fieldData?.domain||v.domain||'Domain not selected'}`);
      });
      lastVisitorSnapshot=next;
      window.setTimeout(enhanceLiveVisitorCards,40);
    });
    db.ref('submittedApplications').on('value',snap=>{
      const next=Object.entries(snap.val()||{}).map(([id,app])=>({id,...app}));
      const oldById=Object.fromEntries(applications.map(a=>[a.id,a]));
      next.forEach(app=>{
        if(!oldById[app.id]) addActivity('application','New application received',`${app.name||'Student'} • ${app.college||'College not provided'}`,asMs(app.submittedAtMs||app.submittedAt)||Date.now());
        else if(appStatus(oldById[app])!==appStatus(app)) addActivity('status','Application status changed',`${app.name||'Student'} → ${appStatusLabel(appStatus(app))}`);
      });
      window.setTimeout(()=>{updateAdvancedMetrics();refreshFilterOptions();if(getEl('applicationManagerModal')?.classList.contains('open'))renderApplicationManager();},50);
    });
  }

  function bindAdvancedUI(){
    getEl('openApplicationManager')?.addEventListener('click',openManager);
    document.querySelectorAll('[data-close-manager]').forEach(node=>node.addEventListener('click',closeManager));
    document.querySelectorAll('[data-close-detail]').forEach(node=>node.addEventListener('click',closeDetail));
    getEl('saveApplicationDetails')?.addEventListener('click',saveAppDetails);
    getEl('managerPrev')?.addEventListener('click',()=>{managerPage--;renderApplicationManager();});
    getEl('managerNext')?.addEventListener('click',()=>{managerPage++;renderApplicationManager();});
    getEl('clearApplicationFilters')?.addEventListener('click',()=>{getEl('applicationSearch').value='';getEl('applicationDomainFilter').value='';getEl('applicationStateFilter').value='';getEl('applicationYearFilter').value='';getEl('applicationLanguageFilter').value='';getEl('applicationStatusFilter').value='';managerPage=1;renderApplicationManager();});
    ['applicationSearch','applicationDomainFilter','applicationStateFilter','applicationYearFilter','applicationLanguageFilter','applicationStatusFilter'].forEach(id=>getEl(id)?.addEventListener('input',()=>{managerPage=1;renderApplicationManager();}));
    getEl('clearActivityLog')?.addEventListener('click',()=>{activityItems=[];saveActivity();renderActivityFeed();showToast('Activity log cleared','Only this browser’s local admin activity history was cleared.','info',4500);});
    getEl('copyApplicationSummary')?.addEventListener('click',async()=>{
      const app=findApp(selectedApplicationId);if(!app)return;
      const text=[`InternsForge Application — ${app.name||''}`,`Email: ${app.email||'—'}`,`Phone: ${app.phone||'—'}`,`College: ${app.college||'—'}`,`Department: ${app.department||'—'}`,`Year: ${app.year||'—'}`,`State: ${app.state||'—'}`,`Domain: ${app.domain||'—'}`,`Language: ${app.communicationLanguage||app.language||'—'}`,`Start: ${app.startAvailability||'—'}`,`Status: ${appStatusLabel(appStatus(app))}`,`Reference: ${app.id||'—'}`].join('\n');
      try{await navigator.clipboard.writeText(text);showToast('Summary copied','Applicant summary copied to clipboard.','success',3500);}catch{showToast('Copy unavailable','Your browser blocked clipboard access.','error',4500);}
    });
    getEl('exportApplicationsButton')?.addEventListener('contextmenu',e=>{e.preventDefault();exportManager();});
    window.__internsforgeInlineStatus = inlineStatus;
    document.addEventListener('click',e=>{
      const rowButton=e.target.closest('[data-open-application]'); if(rowButton){openDetail(rowButton.dataset.openApplication);return;}
    });
    // Use the existing Export button for the current dataset, while Manage All exposes the filtered export via Ctrl+E.
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='e'&&getEl('applicationManagerModal')?.classList.contains('open')){e.preventDefault();exportManager();}});
    getEl('activeAdminEmail').textContent=`Admin: ${auth?.currentUser?.email||'—'}`;
  }

  function start(){
    if(window.__internsforgeAdminV540Started) return;
    window.__internsforgeAdminV540Started=true;
    window.__internsforgeUpdateAdvancedMetrics = updateAdvancedMetrics;
    bindAdvancedUI();
    seedActivity();
    window.setTimeout(renderAdvancedAll,300);
    watchVisitorChanges();
    window.setInterval(()=>{renderFunnel();renderDomainPerformance();enhanceLiveVisitorCards();},4000);
  }

  if(auth){ auth.onAuthStateChanged(user=>{ if(user) window.setTimeout(start,0); }); }
})();

// V5.40: independent Live Visitors refresh. The button does not depend on
// Applications/Referrals reads, so one unrelated permission failure cannot
// block realtime visitor monitoring.
async function refreshLiveVisitorsOnly(){
  if (refreshInProgress) return;
  refreshInProgress = true;
  const button = el('refreshDashboardButton');
  const label = el('visitorSyncLabel');
  const stamp = el('lastDataSync');
  button?.classList.add('is-refreshing');
  button?.setAttribute('disabled','disabled');
  if(label) label.textContent='Refreshing…';
  try {
    await cleanupStale({removeAbandoned:false});
    const snapshot = await db.ref('liveVisitors').once('value');
    visitors = snapshot.val() || {};
    renderVisitors();
    updateStamp('Live visitors refreshed');
    if(label) label.textContent='Synced just now';
    if(stamp) stamp.textContent=`Last data sync: ${new Intl.DateTimeFormat('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date())}`;
    showToast('Live visitors refreshed','Visitor presence was loaded directly from Firebase.','success',2800);
    return true;
  } catch(error){
    console.error('Live visitor-only refresh failed:',error);
    if(label) label.textContent='Sync failed';
    showToast('Live visitor refresh failed',error?.message || 'Firebase denied the read. Check authentication and database rules.','error',7000);
    return false;
  } finally {
    refreshInProgress=false;
    button?.classList.remove('is-refreshing');
    button?.removeAttribute('disabled');
  }
}

(function fixAdminV540StatusEvents(){
  if(window.__internsforgeV540StatusEvents) return;
  window.__internsforgeV540StatusEvents=true;
  document.addEventListener('change', e=>{
    const statusSelect=e.target.closest('[data-inline-status]');
    if(statusSelect) window.__internsforgeInlineStatus?.(statusSelect.dataset.inlineStatus,statusSelect.value);
  });
})();
