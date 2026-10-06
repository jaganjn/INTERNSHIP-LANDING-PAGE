/************************************************************
 * InternsForge — Dedicated Counselor Router V1
 *
 * PURPOSE
 * -------
 * Routes one existing application from Master Sheet1 into exactly
 * one counselor spreadsheet without modifying Master Sheet1.
 *
 * THIS IS A NEW, STANDALONE APPS SCRIPT WEB APP.
 * Do not merge this file into the old routing code.
 ************************************************************/

const ROUTER_CONFIG = {
  MASTER_SPREADSHEET_ID: "1zqXBMY_Y97cgk1wdT3ZdzqW1ZH7cmyAipIsDQCB3Nfs",
  MASTER_SHEET_NAME: "Sheet1",
  COUNSELOR_REGISTRY_SHEET: "Counselors",
  COUNSELOR_HEADERS: ["Counselor Name", "Spreadsheet ID", "Active", "Created At"],
  COUNSELOR_LEAD_HEADERS: [
    "Timestamp",
    "Application ID",
    "Name",
    "Phone",
    "Email",
    "College",
    "Department",
    "Year",
    "Domain",
    "State",
    "Communication Language",
    "Start Availability",
    "Application Reason",
    "Call Status",
    "Next Follow-up",
    "Assigned To",
    "Remarks"
  ],
  MASTER_HEADERS: [
    "Timestamp",
    "Name",
    "Phone",
    "Email",
    "College",
    "Department",
    "Year",
    "Domain",
    "State",
    "Communication Language",
    "Start Availability",
    "Application Reason",
    "Call Status",
    "Remarks",
    "Application ID",
    "Next Follow-up",
    "Assigned To"
  ],
  VERSION: "COUNSELOR-ROUTER-V1"
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = String(p.action || "").trim();
  try {
    if (action === "health") {
      return jsonp_(p.callback, {
        status: "success",
        service: "InternsForge Counselor Router",
        version: ROUTER_CONFIG.VERSION,
        time: new Date().toISOString()
      });
    }
    if (action === "routeLead") {
      return jsonp_(p.callback, routeLead_(p));
    }
    return jsonp_(p.callback, { status: "error", message: "Unknown action. Use health or routeLead." });
  } catch (error) {
    return jsonp_(p.callback, {
      status: "error",
      version: ROUTER_CONFIG.VERSION,
      message: error && error.message ? error.message : String(error)
    });
  }
}

function routeLead_(p) {
  const applicationId = clean_(p.applicationId);
  const counselorName = normalizeCounselor_(p.counselorName);
  const previousCounselor = normalizeCounselor_(p.previousCounselor);
  const requestId = clean_(p.requestId) || Utilities.getUuid();

  if (!applicationId) return { status: "error", requestId: requestId, message: "Application ID is required." };
  if (!counselorName) {
    // Unassignment is supported: remove this application from every counselor sheet.
    const removed = removeFromAllCounselors_(applicationId);
    return {
      status: removed.errors.length ? "error" : "success",
      requestId: requestId,
      applicationId: applicationId,
      assignedTo: "",
      masterUpdated: false,
      removed: removed.removed,
      message: removed.errors.length ? removed.errors.join(" | ") : "Lead removed from counselor sheets."
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const counselor = getCounselor_(counselorName);
    if (!counselor) {
      return {
        status: "error",
        requestId: requestId,
        applicationId: applicationId,
        message: 'Counselor "' + counselorName + '" is not registered in the Counselors sheet.'
      };
    }
    if (!counselor.spreadsheetId) {
      return {
        status: "error",
        requestId: requestId,
        applicationId: applicationId,
        message: 'Counselor "' + counselorName + '" has no Spreadsheet ID in the Counselors sheet.'
      };
    }

    const masterRecord = readMasterApplication_(applicationId);
    if (!masterRecord) {
      return {
        status: "error",
        requestId: requestId,
        applicationId: applicationId,
        message: "Application ID was not found in Master Sheet1. The counselor sheet was not changed."
      };
    }

    const ss = SpreadsheetApp.openById(counselor.spreadsheetId);
    const sheet = findOrCreateCounselorSheet_(ss, counselorName);
    normalizeCounselorSheet_(sheet, counselorName);

    // Write the selected counselor FIRST. We only remove stale copies after
    // this write is verified, so reassignment cannot lose the lead.
    const rowValues = buildCounselorRow_(masterRecord, counselorName);
    const rowNumber = upsertCounselorLead_(sheet, rowValues);
    SpreadsheetApp.flush();

    const verifiedRow = findApplicationRow_(sheet, applicationId);
    if (verifiedRow <= 0) {
      throw new Error("Counselor sheet write completed but Application ID could not be verified in the target sheet.");
    }

    const removed = removeFromOtherCounselors_(applicationId, counselorName);

    return {
      status: "success",
      version: ROUTER_CONFIG.VERSION,
      requestId: requestId,
      applicationId: applicationId,
      assignedTo: counselorName,
      counselorSpreadsheetId: counselor.spreadsheetId,
      counselorSheet: sheet.getName(),
      row: verifiedRow,
      previousCounselor: previousCounselor,
      removedStaleCopies: removed.removed,
      masterUpdated: false,
      message: "Lead routed successfully. Master Sheet1 was not modified."
    };
  } finally {
    lock.releaseLock();
  }
}

function readMasterApplication_(applicationId) {
  const ss = SpreadsheetApp.openById(ROUTER_CONFIG.MASTER_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ROUTER_CONFIG.MASTER_SHEET_NAME);
  if (!sheet) throw new Error("Master Sheet1 was not found.");

  const headers = ROUTER_CONFIG.MASTER_HEADERS.slice();
  const idCol = headers.findIndex(h => normalizeHeader_(h) === "applicationid") + 1;
  if (!idCol) throw new Error("Master Sheet1 is missing the Application ID column.");
  if (sheet.getLastRow() < 2) return null;

  const ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getDisplayValues();
  let rowNumber = 0;
  for (let i = 0; i < ids.length; i++) {
    if (clean_(ids[i][0]) === applicationId) { rowNumber = i + 2; break; }
  }
  if (!rowNumber) return null;

  const row = readRow_(sheet, rowNumber, headers.length);
  const app = {};
  headers.forEach((h, i) => app[h] = row[i]);
  app["Application ID"] = applicationId;
  return app;
}

function findOrCreateCounselorSheet_(ss, counselorName) {
  const expected = counselorName + "'s Leads";
  const candidates = [expected, "LeadsTable", "LeadApplications"];
  for (const name of candidates) {
    const existing = ss.getSheetByName(name);
    if (existing) return existing;
  }
  return ss.insertSheet(expected);
}

function normalizeCounselorSheet_(sheet, counselorName) {
  const desired = ROUTER_CONFIG.COUNSELOR_LEAD_HEADERS.slice();
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    ensureSheetWidth_(sheet, desired.length);
    sheet.getRange(1, 1, 1, desired.length).setValues([desired]);
    sheet.setFrozenRows(1);
    return;
  }

  const width = Math.max(sheet.getLastColumn(), desired.length);
  const values = sheet.getRange(1, 1, sheet.getLastRow(), width).getValues();
  const physicalHeaders = values[0].map(v => clean_(v));
  const exact = physicalHeaders.length === desired.length && desired.every((h, i) => normalizeHeader_(h) === normalizeHeader_(physicalHeaders[i]));
  if (exact && sheet.getLastColumn() === desired.length) {
    sheet.setFrozenRows(1);
    return;
  }

  // Migrate older/shifted counselor layouts by header name. Make a repair backup
  // first so an older sheet is never silently destroyed.
  const ss = sheet.getParent();
  const backupName = uniqueSheetName_(ss, (sheet.getName() + " Router Backup " + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Kolkata", "yyyyMMdd_HHmmss")).slice(0, 99));
  const backup = ss.insertSheet(backupName);
  const backupWidth = values.reduce((m, r) => Math.max(m, r.length), 1);
  backup.getRange(1, 1, values.length, backupWidth).setValues(values.map(r => { const x = r.slice(); while (x.length < backupWidth) x.push(""); return x; }));

  const map = {};
  physicalHeaders.forEach((h, i) => { const n = normalizeHeader_(h); if (n) map[n] = i; });
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const src = values[r];
    const dest = desired.map(h => {
      const index = map[normalizeHeader_(h)];
      return index === undefined ? "" : src[index];
    });
    if (dest.some(v => clean_(v))) out.push(dest);
  }

  ensureSheetWidth_(sheet, desired.length);
  sheet.clearContents();
  if (sheet.getMaxColumns() > desired.length) {
    sheet.deleteColumns(desired.length + 1, sheet.getMaxColumns() - desired.length);
  }
  sheet.getRange(1, 1, 1, desired.length).setValues([desired]);
  if (out.length) sheet.getRange(2, 1, out.length, desired.length).setValues(out);
  sheet.setFrozenRows(1);
}

function buildCounselorRow_(app, counselorName) {
  const dateValue = coerceDate_(app["Timestamp"]);
  const nextFollow = coerceDate_(app["Next Follow-up"]);
  const byName = {
    "Timestamp": dateValue || clean_(app["Timestamp"]),
    "Application ID": clean_(app["Application ID"]),
    "Name": clean_(app["Name"]),
    "Phone": clean_(app["Phone"]),
    "Email": clean_(app["Email"]),
    "College": clean_(app["College"]),
    "Department": clean_(app["Department"]),
    "Year": clean_(app["Year"]),
    "Domain": clean_(app["Domain"]),
    "State": clean_(app["State"]),
    "Communication Language": clean_(app["Communication Language"]),
    "Start Availability": clean_(app["Start Availability"]),
    "Application Reason": clean_(app["Application Reason"]),
    "Call Status": clean_(app["Call Status"]),
    "Next Follow-up": nextFollow || clean_(app["Next Follow-up"]),
    "Assigned To": counselorName,
    "Remarks": clean_(app["Remarks"])
  };
  return ROUTER_CONFIG.COUNSELOR_LEAD_HEADERS.map(h => byName[h] ?? "");
}

function upsertCounselorLead_(sheet, rowValues) {
  const id = clean_(rowValues[1]);
  const row = findApplicationRow_(sheet, id);
  if (row > 0) {
    sheet.getRange(row, 1, 1, rowValues.length).setValues([rowValues]);
    return row;
  }
  sheet.appendRow(rowValues);
  return sheet.getLastRow();
}

function findApplicationRow_(sheet, applicationId) {
  const headers = readHeaders_(sheet);
  const idIndex = headers.findIndex(h => normalizeHeader_(h) === "applicationid");
  if (idIndex < 0 || sheet.getLastRow() < 2) return 0;
  const values = sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let i = 0; i < values.length; i++) {
    if (clean_(values[i][0]) === clean_(applicationId)) return i + 2;
  }
  return 0;
}

function removeFromOtherCounselors_(applicationId, keepCounselor) {
  const result = { removed: 0, errors: [] };
  for (const c of getCounselors_()) {
    if (normalizeCounselor_(c.name).toLowerCase() === keepCounselor.toLowerCase()) continue;
    try {
      if (!c.spreadsheetId) continue;
      const ss = SpreadsheetApp.openById(c.spreadsheetId);
      const sheet = findExistingCounselorSheet_(ss, c.name);
      if (!sheet) continue;
      let row = findApplicationRow_(sheet, applicationId);
      while (row > 0) {
        sheet.deleteRow(row);
        result.removed++;
        row = findApplicationRow_(sheet, applicationId);
      }
    } catch (e) {
      result.errors.push(c.name + ": " + e.message);
    }
  }
  if (result.errors.length) throw new Error("Lead routed, but stale counselor copies could not all be removed: " + result.errors.join(" | "));
  return result;
}

function removeFromAllCounselors_(applicationId) {
  const result = { removed: 0, errors: [] };
  for (const c of getCounselors_()) {
    try {
      if (!c.spreadsheetId) continue;
      const ss = SpreadsheetApp.openById(c.spreadsheetId);
      const sheet = findExistingCounselorSheet_(ss, c.name);
      if (!sheet) continue;
      let row = findApplicationRow_(sheet, applicationId);
      while (row > 0) {
        sheet.deleteRow(row);
        result.removed++;
        row = findApplicationRow_(sheet, applicationId);
      }
    } catch (e) {
      result.errors.push(c.name + ": " + e.message);
    }
  }
  return result;
}

function getCounselor_(name) {
  const key = normalizeCounselor_(name).toLowerCase();
  return getCounselors_().find(c => normalizeCounselor_(c.name).toLowerCase() === key) || null;
}

function getCounselors_() {
  const ss = SpreadsheetApp.openById(ROUTER_CONFIG.MASTER_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ROUTER_CONFIG.COUNSELOR_REGISTRY_SHEET);
  if (!sheet) throw new Error("The Counselors registry sheet was not found in the master spreadsheet.");
  if (sheet.getLastRow() < 2) return [];
  const headers = readHeaders_(sheet);
  const nameCol = headers.findIndex(h => normalizeHeader_(h) === "counselorname");
  const idCol = headers.findIndex(h => normalizeHeader_(h) === "spreadsheetid");
  const activeCol = headers.findIndex(h => normalizeHeader_(h) === "active");
  if (nameCol < 0 || idCol < 0) throw new Error("Counselors sheet must contain Counselor Name and Spreadsheet ID columns.");
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return rows.map(r => ({
    name: clean_(r[nameCol]),
    spreadsheetId: clean_(r[idCol]),
    active: activeCol >= 0 ? clean_(r[activeCol]) : "Yes"
  })).filter(c => c.name && !["no", "false", "0", "inactive"].includes(c.active.toLowerCase()));
}

function findExistingCounselorSheet_(ss, counselorName) {
  const expected = counselorName + "'s Leads";
  return ss.getSheetByName(expected) || ss.getSheetByName("LeadsTable") || ss.getSheetByName("LeadApplications") || null;
}

function readHeaders_(sheet) {
  const n = sheet.getLastColumn();
  if (!n) return [];
  return sheet.getRange(1, 1, 1, n).getDisplayValues()[0].map(clean_);
}

function readRow_(sheet, rowNumber, count) {
  try {
    return sheet.getRange(rowNumber, 1, 1, count).getDisplayValues()[0];
  } catch (_) {
    const row = [];
    for (let col = 1; col <= count; col++) row.push(sheet.getRange(rowNumber, col).getDisplayValue());
    return row;
  }
}

function ensureSheetWidth_(sheet, required) {
  if (sheet.getMaxColumns() < required) sheet.insertColumnsAfter(sheet.getMaxColumns(), required - sheet.getMaxColumns());
}

function uniqueSheetName_(ss, desired) {
  let name = desired.slice(0, 99), i = 1;
  while (ss.getSheetByName(name)) name = (desired.slice(0, 95) + " " + i++).slice(0, 99);
  return name;
}

function clean_(value) { return value === null || value === undefined ? "" : String(value).trim(); }
function normalizeCounselor_(value) { return clean_(value).replace(/\s+/g, " "); }
function normalizeHeader_(value) { return clean_(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }

function coerceDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const s = clean_(value);
  if (!s) return "";
  const m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (m) {
    let hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6] || 0);
    const ampm = m[7] ? m[7].toUpperCase() : "";
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    try {
      const d = Utilities.parseDate(
        String(Number(m[1])).padStart(2, "0") + "-" + String(Number(m[2])).padStart(2, "0") + "-" + m[3] + " " +
        String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") + ":" + String(second).padStart(2, "0"),
        Session.getScriptTimeZone() || "Asia/Kolkata",
        "dd-MM-yyyy HH:mm:ss"
      );
      if (!isNaN(d.getTime())) return d;
    } catch (_) {}
  }
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? "" : parsed;
}

function jsonp_(callback, payload) {
  const safe = clean_(callback);
  const body = JSON.stringify(payload);
  if (!safe || !/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(safe)) {
    return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(safe + "(" + body + ");").setMimeType(ContentService.MimeType.JAVASCRIPT);
}
