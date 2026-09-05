
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
          <small>${esc(app.college || "—")} • ${esc(app.domain || "—")}</small>
        </div>
        <span class="status submitted">Submitted</span>
      </div>
      <small>${fmt(app.submittedAtMs || app.submittedAt)}</small>
    </article>
  `).join("") || '<p class="empty">No applications yet.</p>';

  renderRank(E.topColleges, college);
  renderRank(E.topDomains, domain);

  const days = [...Array(7)].map((_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return {
      date,
      key: getISTDateKey(date.getTime())
    };
  });
  const max = Math.max(1, ...days.map(item => daily[item.key] || 0));

  E.applicationsChart.innerHTML = days.map(({ date, key }) => {
    const count = daily[key] || 0;
    return `
      <div class="chart-day" title="${count} applications">
        <span class="chart-bar" style="height:${Math.max(4, (count / max) * 100)}%"></span>
        <small>${date.toLocaleDateString("en-IN", { weekday: "short" })}<br>${count}</small>
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

  document.title = `(${newItems.length}) New Application${newItems.length > 1 ? "s" : ""} — Apex Admin`;
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

  db.ref("submittedApplications").on("value", snapshot => {
    const nextApplications = Object.entries(snapshot.val() || {})
      .map(([id, app]) => ({ id, ...app }))
      .sort((a, b) => asMs(b.submittedAtMs || b.submittedAt) - asMs(a.submittedAtMs || a.submittedAt));

    const newIds = handleNewApplications(nextApplications);
    applications = nextApplications;
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
  setupNotificationSettings();

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
    `Send a password reset link to ${user.email}?\n\nYou will be signed out after requesting the reset link.`
  );

  if (!confirmed) return;

  try {
    await auth.sendPasswordResetEmail(user.email);

    showToast(
      "Password reset email sent",
      `Check ${user.email} for the reset link.`,
      "success",
      7000
    );

    // Give the toast a moment to render, then sign out so the next login
    // requires the new password.
    window.setTimeout(async () => {
      try {
        await auth.signOut();
        location.replace("login.html");
      } catch (signOutError) {
        console.error("Sign-out after password reset failed:", signOutError);
      }
    }, 1200);

  } catch (error) {
    console.error("Firebase password reset failed:", error);

    const friendlyMessages = {
      "auth/invalid-email": "The administrator email address is invalid.",
      "auth/user-not-found": "No administrator account exists for this email.",
      "auth/too-many-requests": "Too many reset attempts. Please try again later.",
      "auth/network-request-failed": "Network error. Check your connection and try again."
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
      db.ref("referralShares").remove()
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
