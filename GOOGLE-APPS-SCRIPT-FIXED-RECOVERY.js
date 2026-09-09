/************************************************************
 * INTERNSFORGE 2026
 * GOOGLE SHEETS APPLICATION RECEIVER + TODAY RECOVERY
 * WEBSITE -> APPS SCRIPT -> GOOGLE SHEETS
 * ADMIN DASHBOARD -> APPS SCRIPT -> GOOGLE SHEETS
 ************************************************************/

const CONFIG = {
  SHEET_NAME: "Sheet1",
  TIMEZONE: "Asia/Kolkata",
  HEADERS: [
    "Timestamp", "Application ID", "Name", "Phone", "Email", "College",
    "Department", "Year", "Domain", "State", "Communication Language",
    "Start Availability", "Application Reason", "Interest", "Referral Code",
    "Referred By", "Referral URL", "Submitted At", "Submitted At Ms"
  ]
};

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({status:"error", message:"No application data received."});
    }
    const data = JSON.parse(e.postData.contents);
    if (data && data.action === "syncApplications") {
      return syncApplications(Array.isArray(data.applications) ? data.applications : []);
    }
    return appendApplication(data || {});
  } catch (error) {
    console.error("APPLICATION ERROR:", error);
    return jsonResponse({status:"error", message:error.message || String(error)});
  }
}

function appendApplication(data) {
  const sheet = getSheet();
  const application = normalizeApplication(data);
  // These are the fields the current landing page actually requires.
  // State/language/availability/reason are optional and must not block a save.
  const required = ["Name","Phone","Email","College","Department","Year","Domain"];
  const missing = required.filter(function(key) { return !application[key]; });
  if (missing.length) {
    return jsonResponse({status:"error", message:"Missing required fields: " + missing.join(", ")});
  }

  ensureHeaders(sheet);
  const headers = getHeaders(sheet);
  const id = application["Application ID"];
  if (id && applicationIdExists(sheet, headers, id)) {
    return jsonResponse({status:"success", duplicate:true, message:"Application already exists in Google Sheets."});
  }

  sheet.appendRow(buildRow(headers, application));
  SpreadsheetApp.flush();
  return jsonResponse({status:"success", message:"Application saved successfully.", applicationId:id || ""});
}

function syncApplications(applications) {
  const sheet = getSheet();
  ensureHeaders(sheet);
  const headers = getHeaders(sheet);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const existingIds = getExistingApplicationIds(sheet, headers);
    const existingFingerprints = getExistingFingerprints(sheet, headers);
    let added = 0, skipped = 0, invalid = 0;

    applications.forEach(function(data) {
      const app = normalizeApplication(data || {});
      if (!app["Name"] || !app["Email"] || !app["College"] || !app["Department"] || !app["Year"] || !app["Domain"]) {
        invalid++;
        return;
      }
      const id = app["Application ID"];
      const fingerprint = makeFingerprint(app);
      if ((id && existingIds[id]) || existingFingerprints[fingerprint]) {
        skipped++;
        return;
      }
      sheet.appendRow(buildRow(headers, app));
      if (id) existingIds[id] = true;
      existingFingerprints[fingerprint] = true;
      added++;
    });

    SpreadsheetApp.flush();
    return jsonResponse({status:"success", message:"Firebase applications synced to Google Sheets.", added:added, skipped:skipped, invalid:invalid});
  } finally {
    lock.releaseLock();
  }
}

function normalizeApplication(data) {
  const now = new Date();
  const submittedAt = value(data.submittedAt);
  return {
    "Timestamp": submittedAt || Utilities.formatDate(now, CONFIG.TIMEZONE, "dd-MM-yyyy HH:mm:ss"),
    "Application ID": value(data.applicationId || data.id),
    "Name": value(data.name),
    "Phone": value(data.phone),
    "Email": value(data.email).toLowerCase(),
    "College": value(data.college),
    "Department": value(data.department),
    "Year": value(data.year),
    "Domain": value(data.domain),
    "State": value(data.state),
    "Communication Language": value(data.communicationLanguage || data.language),
    "Start Availability": value(data.startAvailability),
    "Application Reason": value(data.applicationReason),
    "Interest": value(data.interest),
    "Referral Code": value(data.referralCode),
    "Referred By": value(data.referredBy),
    "Referral URL": value(data.referralUrl),
    "Submitted At": submittedAt,
    "Submitted At Ms": value(data.submittedAtMs)
  };
}

function buildRow(headers, app) {
  const map = {
    timestamp:"Timestamp", applicationid:"Application ID", name:"Name", fullname:"Name",
    phone:"Phone", whatsapp:"Phone", whatsappnumber:"Phone", phonenumber:"Phone",
    email:"Email", emailaddress:"Email", college:"College", collegename:"College",
    department:"Department", branch:"Department", departmentbranch:"Department",
    year:"Year", currentyear:"Year", domain:"Domain", interesteddomain:"Domain", preferreddomain:"Domain",
    state:"State", stateut:"State", stateunionterritory:"State",
    communicationlanguage:"Communication Language", language:"Communication Language", languages:"Communication Language",
    startavailability:"Start Availability", availability:"Start Availability", whenareyouavailabletostart:"Start Availability",
    applicationreason:"Application Reason", reason:"Application Reason", whyareyouapplying:"Application Reason",
    interest:"Interest", referralcode:"Referral Code", referredby:"Referred By", referralurl:"Referral URL",
    submittedat:"Submitted At", submittedatms:"Submitted At Ms"
  };
  return headers.map(function(header) {
    const key = map[normalizeHeader(header)];
    return key ? app[key] : "";
  });
}

function applicationIdExists(sheet, headers, id) {
  const idx = headers.findIndex(function(h) { return normalizeHeader(h) === "applicationid"; });
  if (!id || idx < 0 || sheet.getLastRow() < 2) return false;
  return sheet.getRange(2, idx + 1, sheet.getLastRow() - 1, 1).getValues().some(function(row) {
    return String(row[0] || "").trim() === id;
  });
}

function getExistingApplicationIds(sheet, headers) {
  const out = {};
  const idx = headers.findIndex(function(h) { return normalizeHeader(h) === "applicationid"; });
  if (idx < 0 || sheet.getLastRow() < 2) return out;
  sheet.getRange(2, idx + 1, sheet.getLastRow() - 1, 1).getValues().forEach(function(row) {
    const id = String(row[0] || "").trim();
    if (id) out[id] = true;
  });
  return out;
}

function getExistingFingerprints(sheet, headers) {
  const out = {};
  if (sheet.getLastRow() < 2) return out;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const idx = {}; headers.forEach(function(h,i) { idx[normalizeHeader(h)] = i; });
  rows.forEach(function(row) {
    const email = idx.email != null ? String(row[idx.email] || "").trim().toLowerCase() : "";
    const phone = idx.phone != null ? String(row[idx.phone] || "").trim() : "";
    const name = idx.name != null ? String(row[idx.name] || "").trim().toLowerCase() : "";
    const ms = idx.submittedatms != null ? String(row[idx.submittedatms] || "").trim() : "";
    const submitted = idx.submittedat != null ? String(row[idx.submittedat] || "").trim() : (idx.timestamp != null ? String(row[idx.timestamp] || "").trim() : "");
    if (email && (phone || name)) out[email + "|" + phone + "|" + name + "|" + (ms || submitted)] = true;
  });
  return out;
}

function makeFingerprint(app) {
  return String(app["Email"] || "").toLowerCase() + "|" + String(app["Phone"] || "") + "|" + String(app["Name"] || "").toLowerCase() + "|" + String(app["Submitted At Ms"] || app["Submitted At"] || "");
}

function doGet() {
  return jsonResponse({status:"online", message:"InternsForge Google Sheets receiver is working.", time:Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd-MM-yyyy HH:mm:ss")});
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
  ensureHeaders(sheet);
  return sheet;
}

function ensureHeaders(sheet) {
  let lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) {
    sheet.getRange(1,1,1,CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
    formatHeader(sheet);
    return;
  }
  let headers = sheet.getRange(1,1,1,Math.max(lastColumn,1)).getValues()[0].map(function(h) { return String(h).trim(); });
  if (!headers.some(function(h) { return h !== ""; })) {
    sheet.getRange(1,1,1,CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
    formatHeader(sheet);
    return;
  }
  CONFIG.HEADERS.forEach(function(requiredHeader) {
    const exists = headers.some(function(existing) { return normalizeHeader(existing) === normalizeHeader(requiredHeader); });
    if (!exists) {
      const col = sheet.getLastColumn() + 1;
      sheet.getRange(1,col).setValue(requiredHeader);
      headers.push(requiredHeader);
    }
  });
  formatHeader(sheet);
}

function getHeaders(sheet) {
  return sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(function(h) { return String(h).trim(); });
}
function normalizeHeader(header) { return String(header || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function value(input) { return input === null || input === undefined ? "" : String(input).trim(); }
function formatHeader(sheet) { if (sheet.getLastColumn() > 0) { sheet.getRange(1,1,1,sheet.getLastColumn()).setFontWeight("bold"); sheet.setFrozenRows(1); } }
function jsonResponse(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
