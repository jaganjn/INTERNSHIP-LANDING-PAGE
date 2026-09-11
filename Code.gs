/************************************************************
 * INTERNSFORGE 2026
 * GOOGLE SHEETS RECEIVER + RECOVERY + CRM SYNC
 ************************************************************/

const CONFIG = {
  SHEET_NAME: "Sheet1",
  TIMEZONE: "Asia/Kolkata",
  HEADERS: [
    "Timestamp", "Application ID", "Name", "Phone", "Email", "College",
    "Department", "Year", "Domain", "State", "Communication Language",
    "Start Availability", "Application Reason", "Call Status", "Next Follow-up",
    "Assigned To", "Remarks"
  ]
};


/**
 * ==========================================================
 * GOOGLE SHEETS -> FIREBASE BIDIRECTIONAL CRM SYNC
 * ==========================================================
 *
 * The Sheet remains a convenient admin editing surface.
 * An INSTALLABLE onEdit trigger calls Firebase REST using
 * a service-account credential stored in Script Properties.
 *
 * IMPORTANT:
 * - Never paste the service-account JSON into this source file.
 * - Store the full JSON in Script Properties under:
 *     FIREBASE_SERVICE_ACCOUNT_JSON
 * - Run createSheetToFirebaseTrigger() once after saving.
 *
 * Firebase REST service-account authentication follows the
 * official Firebase REST authentication flow.
 */

const FIREBASE_SYNC_CONFIG = {
  DATABASE_URL: "https://mnc-internship-live-default-rtdb.asia-southeast1.firebasedatabase.app",
  SERVICE_ACCOUNT_PROPERTY: "FIREBASE_SERVICE_ACCOUNT_JSON"
};

const MASTER_SPREADSHEET_ID = "1zqXBMY_Y97cgk1wdT3ZdzqW1ZH7cmyAipIsDQCB3Nfs";

const CALL_STATUS_VALUES = [
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

function getMasterSpreadsheet_() {
  return SpreadsheetApp.openById(MASTER_SPREADSHEET_ID);
}

function normalizeCallStatus_(status) {
  const raw = value(status);
  return raw ? (CALL_STATUS_ALIASES[raw] || raw) : "Not Contacted";
}

function applyCallStatusValidation_(sheet) {
  const headerRow = getHeaders(sheet);
  const col = headerRow.findIndex(h => normalizeHeader(h) === "callstatus") + 1;
  if (!col) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CALL_STATUS_VALUES, true)
    .setAllowInvalid(false)
    .build();
  const maxRows = Math.max(sheet.getMaxRows(), 2);
  sheet.getRange(2, col, maxRows - 1, 1).setDataValidation(rule);
}

/**
 * Counselor routing. Every counselor gets a DEDICATED GOOGLE SPREADSHEET FILE.
 * The master spreadsheet keeps only the counselor registry in `Counselors`.
 * Each counselor spreadsheet contains one lead sheet named `<Counselor Name>\'s Leads`.
 *
 * FUTURE COUNSELORS: no code change is required. Add the counselor name and
 * their separate Google Spreadsheet ID to the master `Counselors` sheet, or use
 * the Admin Dashboard's Add Counselor flow.
 */
const COUNSELOR_CONFIG = {
  LIST_SHEET_NAME: "Counselors",
  LIST_HEADERS: ["Counselor Name", "Spreadsheet ID", "Active", "Created At"],
  LEADS_SHEET_SUFFIX: "'s Leads"
};

// Counselor spreadsheets are configured dynamically in the master `Counselors` sheet.
// No counselor names or Spreadsheet IDs are hard-coded here.


function createSheetToFirebaseTrigger() {
  const ss = SpreadsheetApp.getActive();

  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "sheetOnEdit") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("sheetOnEdit")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  return "Sheet → Firebase trigger created successfully.";
}

function removeSheetToFirebaseTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "sheetOnEdit") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  return "Sheet → Firebase trigger removed.";
}

function sheetOnEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  if (e.range.getRow() < 2) return;
  try {
    if (sheetName === CONFIG.SHEET_NAME) {
      syncSheetRowToFirebase(e.range.getRow());
    }
  } catch (error) {
    console.error("Sheet → Firebase sync failed:", error);
  }
}

function counselorSpreadsheetOnEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (e.range.getRow() < 2) return;
  try {
    syncCounselorRowToFirebase(sheet, e.range.getRow());
  } catch (error) {
    console.error("Counselor spreadsheet → Firebase sync failed:", error);
  }
}

function syncCounselorRowToFirebase(counselorSheet, rowNumber) {
  const headers = getHeaders(counselorSheet);
  const row = counselorSheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const raw = {};
  headers.forEach((header, index) => raw[header] = row[index]);

  const applicationId = value(raw["Application ID"] || raw.applicationId || raw.id);
  if (!applicationId) return {status:"skipped", reason:"Missing Application ID"};

  const app = buildApplicationObject(raw, applicationId);
  const master = getSheet();
  const masterHeaders = getHeaders(master);
  const masterRow = findApplicationId(master, masterHeaders, applicationId);

  let previousAssignedTo = "";
  if (masterRow > 0) {
    const current = master.getRange(masterRow, 1, 1, masterHeaders.length).getValues()[0];
    previousAssignedTo = getAssignedToFromRow(masterHeaders, current);
    updateRowByApplicationId(master, masterHeaders, masterRow, app);
  } else {
    master.appendRow(buildRow(masterHeaders, app));
  }

  SpreadsheetApp.flush();

  // Re-route the lead if the counselor changed the assignment from inside their tab.
  syncApplicationToCounselorSheet(app, previousAssignedTo);

  const updates = {
    callStatus: value(app["Call Status"]),
    nextFollowUpAt: sheetDateToIso(app["Next Follow-up"]),
    assignedTo: value(app["Assigned To"]),
    remarks: value(app["Remarks"])
  };

  const editable = {
    name:value(app["Name"]), phone:value(app["Phone"]), email:value(app["Email"]),
    college:value(app["College"]), department:value(app["Department"]), year:value(app["Year"]),
    domain:value(app["Domain"]), state:value(app["State"]),
    communicationLanguage:value(app["Communication Language"]),
    startAvailability:value(app["Start Availability"]), applicationReason:value(app["Application Reason"])
  };
  Object.keys(editable).forEach(key => { if (editable[key] !== "") updates[key] = editable[key]; });

  firebaseRestPatch("/submittedApplications/" + encodeURIComponent(applicationId), updates);
  return {status:"success", applicationId:applicationId, counselorSheet:counselorSheet.getName()};
}

function syncSheetRowToFirebase(rowNumber) {
  const sheet = getSheet();
  const headers = getHeaders(sheet);
  const row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];

  const record = {};
  headers.forEach((header, index) => {
    record[normalizeHeader(header)] = row[index];
  });

  const applicationId = value(
    record.applicationid || record.id
  );

  if (!applicationId) {
    console.warn("Sheet row " + rowNumber + " has no Application ID; skipping Firebase sync.");
    return {
      status: "skipped",
      reason: "Missing Application ID",
      row: rowNumber
    };
  }

  /*
   * Only synchronize fields represented by the CRM/application
   * model. This prevents unrelated spreadsheet columns from
   * being pushed into Firebase.
   */
  const updates = {
    callStatus: value(record.callstatus),
    nextFollowUpAt: sheetDateToIso(record.nextfollowup || record.followup),
    assignedTo: value(record.assignedto),
    remarks: value(record.remarks || record.remark)
  };

  /*
   * Also synchronize editable application information when
   * those columns exist. Empty values are intentionally omitted
   * so an accidental blank cell cannot erase the Firebase record.
   */
  const editableFields = {
    name: value(record.name),
    phone: value(record.phone || record.whatsapp || record.phonenumber),
    email: value(record.email),
    college: value(record.college),
    department: value(record.department || record.branch),
    year: value(record.year),
    domain: value(record.domain),
    state: value(record.state),
    communicationLanguage: value(record.communicationlanguage || record.language),
    startAvailability: value(record.startavailability || record.availability),
    applicationReason: value(record.applicationreason || record.reason)
  };

  Object.keys(editableFields).forEach(key => {
    if (editableFields[key] !== "") {
      updates[key] = editableFields[key];
    }
  });

  const result = firebaseRestPatch(
    "/submittedApplications/" + encodeURIComponent(applicationId),
    updates
  );

  console.log("Sheet → Firebase synced:", applicationId, result);

  return {
    status: "success",
    applicationId: applicationId,
    row: rowNumber
  };
}

function syncAllSheetCrmToFirebase() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return {
      status: "success",
      processed: 0,
      message: "No application rows found."
    };
  }

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (let row = 2; row <= lastRow; row++) {
    try {
      const result = syncSheetRowToFirebase(row);
      if (result.status === "success") processed++;
      else skipped++;
    } catch (error) {
      failed++;
      console.error("Row " + row + " failed:", error);
    }
  }

  return {
    status: "success",
    processed: processed,
    skipped: skipped,
    failed: failed,
    totalRows: lastRow - 1
  };
}

function sheetDateToIso(valueFromSheet) {
  if (
    valueFromSheet === null ||
    valueFromSheet === undefined ||
    valueFromSheet === ""
  ) {
    return "";
  }

  const date = valueFromSheet instanceof Date
    ? valueFromSheet
    : new Date(valueFromSheet);

  if (isNaN(date.getTime())) return "";

  return date.toISOString();
}

function sheetDateToTimestamp(valueFromSheet) {
  if (
    valueFromSheet === null ||
    valueFromSheet === undefined ||
    valueFromSheet === ""
  ) {
    return "";
  }

  const date = valueFromSheet instanceof Date
    ? valueFromSheet
    : new Date(valueFromSheet);

  if (isNaN(date.getTime())) return "";

  return date.getTime();
}

function getFirebaseServiceAccount_() {
  const raw = PropertiesService
    .getScriptProperties()
    .getProperty(FIREBASE_SYNC_CONFIG.SERVICE_ACCOUNT_PROPERTY);

  if (!raw) {
    throw new Error(
      "Missing Script Property FIREBASE_SERVICE_ACCOUNT_JSON. " +
      "Add the Firebase service-account JSON to Apps Script Project Settings → Script properties."
    );
  }

  const serviceAccount = JSON.parse(raw);

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing client_email or private_key."
    );
  }

  return serviceAccount;
}

function base64UrlEncode_(input) {
  const bytes = typeof input === "string"
    ? Utilities.newBlob(input).getBytes()
    : input;

  return Utilities
    .base64EncodeWebSafe(bytes)
    .replace(/=+$/g, "");
}

function getFirebaseAccessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("FIREBASE_REST_ACCESS_TOKEN");

  if (cached) return cached;

  const serviceAccount = getFirebaseServiceAccount_();
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const claim = {
    iss: serviceAccount.client_email,
    scope: [
      "https://www.googleapis.com/auth/firebase.database",
      "https://www.googleapis.com/auth/userinfo.email"
    ].join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  const unsignedToken =
    base64UrlEncode_(JSON.stringify(header)) +
    "." +
    base64UrlEncode_(JSON.stringify(claim));

  const signature = Utilities.computeRsaSha256Signature(
    unsignedToken,
    serviceAccount.private_key
  );

  const assertion =
    unsignedToken +
    "." +
    base64UrlEncode_(signature);

  const response = UrlFetchApp.fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "post",
      payload: {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: assertion
      },
      muteHttpExceptions: true
    }
  );

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(
      "Firebase OAuth token request failed (" +
      status +
      "): " +
      body
    );
  }

  const tokenData = JSON.parse(body);

  if (!tokenData.access_token) {
    throw new Error("Firebase OAuth response did not contain an access token.");
  }

  cache.put(
    "FIREBASE_REST_ACCESS_TOKEN",
    tokenData.access_token,
    3300
  );

  return tokenData.access_token;
}

function firebaseRestPatch(path, payload) {
  const token = getFirebaseAccessToken_();

  const url =
    FIREBASE_SYNC_CONFIG.DATABASE_URL +
    path +
    ".json?access_token=" +
    encodeURIComponent(token);

  const response = UrlFetchApp.fetch(
    url,
    {
      method: "patch",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
  );

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(
      "Firebase REST PATCH failed (" +
      status +
      "): " +
      body
    );
  }

  return body ? JSON.parse(body) : {};
}

function testSheetToFirebaseSync() {
  const sheet = getSheet();
  const row = sheet.getActiveRange()
    ? sheet.getActiveRange().getRow()
    : 2;

  if (row < 2) {
    throw new Error("Select an application row first.");
  }

  return syncSheetRowToFirebase(row);
}


function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return jsonResponse({status:"error", message:"No data received."});
    const data = JSON.parse(e.postData.contents);
    if (data.action === "syncApplications") return jsonResponse(syncApplicationsToSheet(data.applications || [], data.updateExisting === true));
    if (data.action === "updateApplication") return jsonResponse(updateApplicationInSheet(data.application || {}));
    if (data.action === "registerCounselor") return jsonResponse(registerCounselor(data.counselorName || data.name || "", data.spreadsheetId || data.sheetId || ""));
    if (data.action === "health") return jsonResponse({status:"online", time:nowString(), message:"InternsForge Sheets receiver is healthy."});
    return saveSingleApplication(data);
  } catch (error) {
    console.error("POST ERROR", error);
    return jsonResponse({status:"error", message:error.message || String(error)});
  }
}

function saveSingleApplication(data) {
  const sheet = getSheet();
  const application = buildApplicationObject(data, value(data.applicationId || data.id || data.applicationID));
  const required = ["Name","Phone","Email","College","Department","Year","Domain"];
  for (const field of required) if (!application[field]) return jsonResponse({status:"error", message:field+" is missing."});
  const headers = getHeaders(sheet);
  if (application["Application ID"]) {
    const existing = findApplicationId(sheet, headers, application["Application ID"]);
    if (existing > 0) return jsonResponse({status:"success", duplicate:true, row:existing, message:"Application already exists."});
  }
  sheet.appendRow(buildRow(headers, application));
  SpreadsheetApp.flush();
  return jsonResponse({status:"success", duplicate:false, applicationId:application["Application ID"], message:"Application saved successfully."});
}

function doGet() {
  return jsonResponse({status:"online", message:"InternsForge Google Sheets receiver is working.", time:nowString()});
}

function syncApplicationsToSheet(applications, updateExisting) {
  if (!Array.isArray(applications)) throw new Error("applications must be an array.");
  const sheet = getSheet();
  ensureHeaders(sheet);
  const headers = getHeaders(sheet);
  const existingIds = getExistingApplicationIds(sheet, headers);
  const existingFingerprints = getExistingFingerprints(sheet, headers);
  const rowsToAdd = [];
  let added=0, updated=0, skipped=0, invalid=0;

  applications.forEach(raw => {
    if (!raw || typeof raw !== "object") { invalid++; return; }
    const id = value(raw.applicationId || raw.applicationID || raw.id || raw.key);
    const app = buildApplicationObject(raw, id);
    if (!app.Name || !app.Phone || !app.Email || !app.College || !app.Department || !app.Year || !app.Domain) { invalid++; return; }

    if (id && existingIds[id]) {
      if (updateExisting) {
        const rowNumber = existingIds[id];
        const current = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
        const previousAssignedTo = getAssignedToFromRow(headers, current);
        updateRowByApplicationId(sheet, headers, rowNumber, app);
        syncApplicationToCounselorSheet(app, previousAssignedTo);
        updated++;
      } else skipped++;
      return;
    }

    const fp = makeFingerprint(app);
    if (fp && existingFingerprints[fp]) { skipped++; return; }
    rowsToAdd.push(buildRow(headers, app));
    if (id) existingIds[id] = sheet.getLastRow() + rowsToAdd.length;
    if (fp) existingFingerprints[fp] = true;
    added++;
  });

  if (rowsToAdd.length) {
    const firstNewRow = sheet.getLastRow() + 1;
    sheet.getRange(firstNewRow,1,rowsToAdd.length,headers.length).setValues(rowsToAdd);
    SpreadsheetApp.flush();

    // Route newly-added assigned leads into their counselor tabs.
    for (let i = 0; i < rowsToAdd.length; i++) {
      const rowValues = rowsToAdd[i];
      const app = rowValuesToApplicationObject(headers, rowValues);
      syncApplicationToCounselorSheet(app, "");
    }
  }
  return {status:"success", message:"Firebase applications processed.", received:applications.length, added, updated, skipped, invalid, totalRows:Math.max(0,sheet.getLastRow()-1)};
}

function updateApplicationInSheet(raw) {
  const id = value(raw.applicationId || raw.applicationID || raw.id);
  if (!id) return {status:"error", message:"Application ID is required."};

  const sheet = getSheet();
  const headers = getHeaders(sheet);
  const rowNumber = findApplicationId(sheet, headers, id);
  const app = buildApplicationObject(raw, id);

  let previousAssignedTo = "";

  if (rowNumber > 0) {
    const current = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    previousAssignedTo = getAssignedToFromRow(headers, current);

    updateRowByApplicationId(sheet, headers, rowNumber, app);
    SpreadsheetApp.flush();

    syncApplicationToCounselorSheet(app, previousAssignedTo);

    return {status:"success", updated:true, row:rowNumber, applicationId:id, assignedTo:app["Assigned To"] || ""};
  }

  sheet.appendRow(buildRow(headers, app));
  SpreadsheetApp.flush();

  syncApplicationToCounselorSheet(app, "");

  return {status:"success", updated:false, added:true, applicationId:id, row:sheet.getLastRow(), assignedTo:app["Assigned To"] || ""};
}

function updateRowByApplicationId(sheet, headers, rowNumber, app) {
  const current = sheet.getRange(rowNumber,1,1,headers.length).getValues()[0];
  const next = current.slice();
  const newRow = buildRow(headers, app);
  headers.forEach((header,i) => {
    // Never erase an existing admin note with an empty Firebase value.
    if (String(newRow[i] ?? "").trim() !== "" || ["Call Status","Next Follow-up","Assigned To","Remarks"].includes(header)) next[i] = newRow[i] ?? current[i];
  });
  sheet.getRange(rowNumber,1,1,headers.length).setValues([next]);
}

/**
 * ==========================================================
 * COUNSELOR MANAGEMENT + SEPARATE SPREADSHEET ROUTING
 * ==========================================================
 *
 * MASTER SPREADSHEET
 *   ├── Sheet1
 *   └── Counselors
 *
 * COUNSELOR SPREADSHEETS
 *   ├── <Counselor A> → <Counselor A>'s Leads
 *   ├── <Counselor B> → <Counselor B>'s Leads
 *   └── ...
 */

function normalizeCounselorName(name) {
  return value(name).replace(/\s+/g, " ").trim();
}

function counselorLeadsSheetName(name) {
  const clean = normalizeCounselorName(name);
  if (!clean) return "";
  return (clean + COUNSELOR_CONFIG.LEADS_SHEET_SUFFIX).slice(0, 100);
}

function getCounselorConfigSheet() {
  const ss = getMasterSpreadsheet_();
  let sheet = ss.getSheetByName(COUNSELOR_CONFIG.LIST_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(COUNSELOR_CONFIG.LIST_SHEET_NAME);

  const headers = getHeaders(sheet);
  if (!headers.some(Boolean)) {
    sheet.getRange(1, 1, 1, COUNSELOR_CONFIG.LIST_HEADERS.length)
      .setValues([COUNSELOR_CONFIG.LIST_HEADERS]);
  } else {
    const existing = {};
    headers.forEach(h => { const n = normalizeHeader(h); if (n) existing[n] = true; });
    COUNSELOR_CONFIG.LIST_HEADERS.forEach(header => {
      if (!existing[normalizeHeader(header)]) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      }
    });
  }
  formatHeader(sheet);
  return sheet;
}

function registerCounselor(name, spreadsheetId) {
  const counselorName = normalizeCounselorName(name);
  if (!counselorName) return {status:"error", message:"Counselor name is required."};

  let targetSpreadsheetId = value(spreadsheetId);
  if (!targetSpreadsheetId) {
    const existing = getCounselorRecord(counselorName);
    targetSpreadsheetId = existing ? value(existing.spreadsheetId) : "";
  }

  if (!targetSpreadsheetId) {
    const created = SpreadsheetApp.create("InternsForge - " + counselorName);
    targetSpreadsheetId = created.getId();
  }

  const targetSS = SpreadsheetApp.openById(targetSpreadsheetId);
  let leadsSheet = targetSS.getSheetByName(counselorLeadsSheetName(counselorName));
  if (!leadsSheet) {
    const first = targetSS.getSheets()[0];
    if (first && first.getName() === "Sheet1" && targetSS.getSheets().length === 1) {
      first.setName(counselorLeadsSheetName(counselorName));
      leadsSheet = first;
    } else {
      leadsSheet = targetSS.insertSheet(counselorLeadsSheetName(counselorName));
    }
  }
  ensureHeaders(leadsSheet);
  leadsSheet.setFrozenRows(1);
  formatHeader(leadsSheet);

  ensureCounselorTrigger(targetSpreadsheetId);

  const config = getCounselorConfigSheet();
  const headers = getHeaders(config);
  const nameCol = headers.findIndex(h => normalizeHeader(h) === "counselorname") + 1;
  const idCol = headers.findIndex(h => normalizeHeader(h) === "spreadsheetid") + 1;
  const activeCol = headers.findIndex(h => normalizeHeader(h) === "active") + 1;
  const createdCol = headers.findIndex(h => normalizeHeader(h) === "createdat") + 1;

  let rowNumber = 0;
  if (config.getLastRow() >= 2 && nameCol) {
    const vals = config.getRange(2, nameCol, config.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (normalizeCounselorName(vals[i][0]).toLowerCase() === counselorName.toLowerCase()) {
        rowNumber = i + 2;
        break;
      }
    }
  }

  if (!rowNumber) {
    const row = new Array(headers.length).fill("");
    row[nameCol - 1] = counselorName;
    if (idCol) row[idCol - 1] = targetSpreadsheetId;
    if (activeCol) row[activeCol - 1] = "Yes";
    if (createdCol) row[createdCol - 1] = nowString();
    config.appendRow(row);
  } else {
    if (idCol) config.getRange(rowNumber, idCol).setValue(targetSpreadsheetId);
    if (activeCol) config.getRange(rowNumber, activeCol).setValue("Yes");
  }

  return {
    status:"success",
    counselorName:counselorName,
    spreadsheetId:targetSpreadsheetId,
    sheetName:leadsSheet.getName()
  };
}


/**
 * Manual helper for adding any future counselor.
 * Enter the counselor name and, when they already have a separate spreadsheet,
 * paste its Spreadsheet ID. Leave the ID blank only if you want Apps Script to
 * create the counselor's separate spreadsheet automatically.
 */
function addNewCounselor() {
  const ui = SpreadsheetApp.getUi();
  const nameResponse = ui.prompt(
    "Add Academic Counselor",
    "Enter the counselor name:",
    ui.ButtonSet.OK_CANCEL
  );
  if (nameResponse.getSelectedButton() !== ui.Button.OK) return "Cancelled";

  const name = normalizeCounselorName(nameResponse.getResponseText());
  if (!name) {
    ui.alert("Counselor name is required.");
    return "No counselor name entered.";
  }

  const idResponse = ui.prompt(
    "Counselor Spreadsheet (Optional)",
    "If this counselor already has a separate Google Spreadsheet, paste its Spreadsheet ID.\n\nLeave blank to create a new spreadsheet automatically.",
    ui.ButtonSet.OK_CANCEL
  );

  if (idResponse.getSelectedButton() === ui.Button.CANCEL) return "Cancelled";

  const spreadsheetId = value(idResponse.getResponseText()).trim();
  const result = registerCounselor(name, spreadsheetId);

  if (result.status === "success") {
    ui.alert(
      "Counselor Ready",
      name + " is now configured.\n\nSpreadsheet ID: " + result.spreadsheetId + "\nLead sheet: " + result.sheetName,
      ui.ButtonSet.OK
    );
  } else {
    ui.alert("Could not add counselor", result.message || "Unknown error", ui.ButtonSet.OK);
  }

  return result;
}


/**
 * Test one counselor's separate spreadsheet connection.
 * Run this from the master spreadsheet Apps Script editor.
 * It does not hard-code any counselor names or Spreadsheet IDs.
 */
function testCounselorConnection() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "Test Counselor Connection",
    "Enter the counselor name exactly as it appears in the Counselors sheet:",
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return "Cancelled";

  const name = normalizeCounselorName(response.getResponseText());
  if (!name) {
    ui.alert("Counselor name is required.");
    return "No counselor name entered.";
  }

  const record = getCounselorRecord(name);
  if (!record) {
    ui.alert("Counselor Not Found", "No matching counselor was found in the Counselors sheet.", ui.ButtonSet.OK);
    return {status:"error", message:"Counselor not found."};
  }
  if (!record.spreadsheetId) {
    ui.alert("Spreadsheet ID Missing", "Add the counselor's separate Spreadsheet ID in the Counselors sheet.", ui.ButtonSet.OK);
    return {status:"error", message:"Spreadsheet ID missing."};
  }

  try {
    const ss = SpreadsheetApp.openById(record.spreadsheetId);
    const sheetName = counselorLeadsSheetName(name);
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    ensureHeaders(sheet);
    sheet.setFrozenRows(1);
    formatHeader(sheet);
    ensureCounselorTrigger(record.spreadsheetId);

    const message =
      "Connection successful.\n\n" +
      "Counselor: " + name + "\n" +
      "Spreadsheet: " + ss.getName() + "\n" +
      "Lead sheet: " + sheetName + "\n\n" +
      "The counselor spreadsheet is ready for lead routing.";
    ui.alert("Counselor Connection OK", message, ui.ButtonSet.OK);
    return {status:"success", counselorName:name, spreadsheetId:record.spreadsheetId, spreadsheetName:ss.getName(), sheetName:sheetName};
  } catch (error) {
    ui.alert(
      "Connection Failed",
      "Apps Script could not open the counselor spreadsheet.\n\nCheck the Spreadsheet ID and make sure the Apps Script account has Editor access.\n\nError: " + error.message,
      ui.ButtonSet.OK
    );
    return {status:"error", message:error.message};
  }
}

/**
 * Convenience alias for future counselor setup.
 * Uses the same dynamic Counselors registry; no code changes are required
 * when additional counselors are added.
 */
function addCounselor() {
  return addNewCounselor();
}

function getCounselors() {
  const sheet = getCounselorConfigSheet();
  const headers = getHeaders(sheet);
  const nameCol = headers.findIndex(h => normalizeHeader(h) === "counselorname");
  const idCol = headers.findIndex(h => normalizeHeader(h) === "spreadsheetid");
  const activeCol = headers.findIndex(h => normalizeHeader(h) === "active");
  if (nameCol < 0 || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return rows.map(row => ({
    name: value(row[nameCol]),
    spreadsheetId: idCol >= 0 ? value(row[idCol]) : "",
    active: activeCol >= 0 ? value(row[activeCol]) : "Yes"
  })).filter(item => item.name);
}

function getCounselorRecord(name) {
  const counselorName = normalizeCounselorName(name);
  if (!counselorName) return null;
  const sheet = getCounselorConfigSheet();
  const headers = getHeaders(sheet);
  const nameCol = headers.findIndex(h => normalizeHeader(h) === "counselorname") + 1;
  const idCol = headers.findIndex(h => normalizeHeader(h) === "spreadsheetid") + 1;
  const activeCol = headers.findIndex(h => normalizeHeader(h) === "active") + 1;
  if (!nameCol || sheet.getLastRow() < 2) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (normalizeCounselorName(rows[i][nameCol - 1]).toLowerCase() === counselorName.toLowerCase()) {
      return {
        row: i + 2,
        name: value(rows[i][nameCol - 1]),
        spreadsheetId: idCol ? value(rows[i][idCol - 1]) : "",
        active: activeCol ? value(rows[i][activeCol - 1]) : "Yes"
      };
    }
  }
  return null;
}

function ensureCounselorTrigger(spreadsheetId) {
  const id = value(spreadsheetId);
  if (!id) return;
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t =>
    t.getHandlerFunction() === "counselorSpreadsheetOnEdit" &&
    t.getTriggerSourceId && t.getTriggerSourceId() === id
  );
  if (!exists) {
    ScriptApp.newTrigger("counselorSpreadsheetOnEdit")
      .forSpreadsheet(id)
      .onEdit()
      .create();
  }
}

function syncApplicationToCounselorSheet(app, previousAssignedTo) {
  const newAssignedTo = normalizeCounselorName(app["Assigned To"]);
  const oldAssignedTo = normalizeCounselorName(previousAssignedTo);
  const applicationId = value(app["Application ID"]);
  if (!applicationId) return;

  if (oldAssignedTo && oldAssignedTo.toLowerCase() !== newAssignedTo.toLowerCase()) {
    removeApplicationFromCounselorSpreadsheet(oldAssignedTo, applicationId);
  }
  if (!newAssignedTo) return;

  const finalRecord = getCounselorRecord(newAssignedTo);
  if (!finalRecord || !finalRecord.spreadsheetId) {
    throw new Error(
      "Counselor \"" + newAssignedTo + "\" is not configured. Add the counselor and their Spreadsheet ID in the master Counselors sheet first."
    );
  }

  const ss = SpreadsheetApp.openById(finalRecord.spreadsheetId);
  const sheetName = counselorLeadsSheetName(newAssignedTo);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  ensureHeaders(sheet);
  const headers = getHeaders(sheet);
  const row = buildRow(headers, app);
  const rowNumber = findApplicationId(sheet, headers, applicationId);

  if (rowNumber > 0) {
    const current = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    const next = current.slice();
    headers.forEach((header, index) => {
      const incoming = row[index];
      if (String(incoming ?? "").trim() !== "" || ["Call Status", "Next Follow-up", "Assigned To", "Remarks"].includes(header)) {
        next[index] = incoming ?? current[index];
      }
    });
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([next]);
  } else {
    sheet.appendRow(row);
  }
  formatHeader(sheet);
}

function removeApplicationFromCounselorSpreadsheet(counselorName, applicationId) {
  const record = getCounselorRecord(counselorName);
  if (!record || !record.spreadsheetId) return;
  try {
    const ss = SpreadsheetApp.openById(record.spreadsheetId);
    const sheet = ss.getSheetByName(counselorLeadsSheetName(counselorName));
    if (!sheet) return;
    const rowNumber = findApplicationId(sheet, getHeaders(sheet), applicationId);
    if (rowNumber > 0) sheet.deleteRow(rowNumber);
  } catch (error) {
    console.error("Could not remove application from counselor spreadsheet:", error);
  }
}

function syncCounselorRowToFirebase(counselorSheet, rowNumber) {
  const headers = getHeaders(counselorSheet);
  const row = counselorSheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  const raw = {};
  headers.forEach((header, index) => raw[header] = row[index]);
  const applicationId = value(raw["Application ID"] || raw.applicationId || raw.id);
  if (!applicationId) return {status:"skipped", reason:"Missing Application ID"};

  const app = buildApplicationObject(raw, applicationId);
  const master = getSheet();
  const masterHeaders = getHeaders(master);
  const masterRow = findApplicationId(master, masterHeaders, applicationId);
  let previousAssignedTo = "";

  if (masterRow > 0) {
    const current = master.getRange(masterRow, 1, 1, masterHeaders.length).getValues()[0];
    previousAssignedTo = getAssignedToFromRow(masterHeaders, current);
    updateRowByApplicationId(master, masterHeaders, masterRow, app);
  } else {
    master.appendRow(buildRow(masterHeaders, app));
  }
  SpreadsheetApp.flush();
  syncApplicationToCounselorSheet(app, previousAssignedTo);

  const updates = {
    callStatus: value(app["Call Status"]),
    nextFollowUpAt: sheetDateToIso(app["Next Follow-up"]),
    assignedTo: value(app["Assigned To"]),
    remarks: value(app["Remarks"])
  };
  const editable = {
    name:value(app["Name"]), phone:value(app["Phone"]), email:value(app["Email"]), college:value(app["College"]),
    department:value(app["Department"]), year:value(app["Year"]), domain:value(app["Domain"]), state:value(app["State"]),
    communicationLanguage:value(app["Communication Language"]), startAvailability:value(app["Start Availability"]), applicationReason:value(app["Application Reason"])
  };
  Object.keys(editable).forEach(key => { if (editable[key] !== "") updates[key] = editable[key]; });
  firebaseRestPatch("/submittedApplications/" + encodeURIComponent(applicationId), updates);
  return {status:"success", applicationId:applicationId, counselorSheet:counselorSheet.getName()};
}

function getAssignedToFromRow(headers, row) {
  const index = headers.findIndex(h => normalizeHeader(h) === "assignedto");
  return index >= 0 ? value(row[index]) : "";
}

function rowValuesToApplicationObject(headers, row) {
  const raw = {};
  headers.forEach((header, index) => raw[header] = row[index]);
  return buildApplicationObject(raw, value(raw["Application ID"] || raw.applicationId));
}

function findApplicationRowInSheet(sheet, applicationId) {
  return findApplicationId(sheet, getHeaders(sheet), applicationId);
}

function buildApplicationObject(data, applicationId) {
  return {
    "Timestamp": formatRecoveryTimestamp(data.submittedAtMs || data.submittedAt || data.timestamp || data.createdAt || data.created_at || data.Timestamp),
    "Application ID": value(applicationId),
    "Name": value(data.name || data.fullName || data.studentName || data.Name),
    "Phone": value(data.phone || data.whatsapp || data.phoneNumber || data.Phone),
    "Email": value(data.email || data.emailAddress || data.Email),
    "College": value(data.college || data.collegeName || data.College),
    "Department": value(data.department || data.branch || data.Department),
    "Year": value(data.year || data.currentYear || data.Year),
    "Domain": value(data.domain || data.interestDomain || data.interesteddomain || data.preferredDomain || data.Domain),
    "State": value(data.state || data.stateUT || data.stateUnionTerritory || data.State),
    "Communication Language": value(data.communicationLanguage || data.language || data.languages || data["Communication Language"]),
    "Start Availability": value(data.startAvailability || data.availability || data.whenAreYouAvailableToStart || data["Start Availability"]),
    "Application Reason": value(data.applicationReason || data.reason || data.whyAreYouApplying || data.interest || data["Application Reason"]),
    "Call Status": normalizeCallStatus_(data.callStatus || data["Call Status"]),
    "Next Follow-up": formatRecoveryTimestamp(data.nextFollowUpAt || data.nextFollowUp || data.followUpAt || data["Next Follow-up"], true),
    "Assigned To": value(data.assignedTo || data["Assigned To"]),
    "Remarks": value(data.remarks || data.remark || data.Remarks)
  };
}

function buildRow(headers, app) {
  return headers.map(header => {
    const n = normalizeHeader(header);
    const map = {
      timestamp:"Timestamp", applicationid:"Application ID", id:"Application ID", name:"Name", fullname:"Name", studentname:"Name",
      phone:"Phone", whatsapp:"Phone", whatsappnumber:"Phone", phonenumber:"Phone", email:"Email", emailaddress:"Email",
      college:"College", collegename:"College", department:"Department", branch:"Department", departmentbranch:"Department",
      year:"Year", currentyear:"Year", domain:"Domain", interesteddomain:"Domain", interestdomain:"Domain", preferreddomain:"Domain",
      state:"State", stateut:"State", stateunionterritory:"State", communicationlanguage:"Communication Language", language:"Communication Language", languages:"Communication Language",
      startavailability:"Start Availability", availability:"Start Availability", whenareyouavailabletostart:"Start Availability",
      applicationreason:"Application Reason", reason:"Application Reason", whyareyouapplying:"Application Reason", interest:"Application Reason",
      callstatus:"Call Status", nextfollowup:"Next Follow-up", followup:"Next Follow-up", assignedto:"Assigned To", remarks:"Remarks", remark:"Remarks"
    };
    return map[n] ? (app[map[n]] || "") : "";
  });
}

function getSheet() {
  const ss = getMasterSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  ensureHeaders(sheet);
  return sheet;
}

function ensureHeaders(sheet) {
  const required = CONFIG.HEADERS.slice();
  const lastColumn = sheet.getLastColumn();

  if (lastColumn === 0) {
    sheet.getRange(1, 1, 1, required.length).setValues([required]);
    formatHeader(sheet);
    applyCallStatusValidation_(sheet);
    return;
  }

  let headers = getHeaders(sheet);

  if (!headers.some(Boolean)) {
    sheet.getRange(1, 1, 1, required.length).setValues([required]);
    formatHeader(sheet);
    applyCallStatusValidation_(sheet);
    return;
  }

  /*
   * IMPORTANT:
   * Older versions could accidentally create duplicate CRM headers.
   * Before adding anything, consolidate duplicate normalized headers.
   * Data from a duplicate column is copied into the first column only
   * where the first column is blank, then the duplicate column is deleted.
   */
  const seen = {};
  const duplicateColumns = [];

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return;

    if (seen[normalized]) {
      duplicateColumns.push({
        column: index + 1,
        primaryColumn: seen[normalized]
      });
    } else {
      seen[normalized] = index + 1;
    }
  });

  // Merge duplicate data before deleting duplicate columns.
  duplicateColumns.forEach(item => {
    const rowCount = sheet.getLastRow();
    if (rowCount < 2) return;

    const primaryValues = sheet
      .getRange(2, item.primaryColumn, rowCount - 1, 1)
      .getValues();

    const duplicateValues = sheet
      .getRange(2, item.column, rowCount - 1, 1)
      .getValues();

    let changed = false;

    for (let i = 0; i < primaryValues.length; i++) {
      const primary = String(primaryValues[i][0] ?? '').trim();
      const duplicate = duplicateValues[i][0];

      if (!primary && duplicate !== '' && duplicate !== null && duplicate !== undefined) {
        primaryValues[i][0] = duplicate;
        changed = true;
      }
    }

    if (changed) {
      sheet
        .getRange(2, item.primaryColumn, rowCount - 1, 1)
        .setValues(primaryValues);
    }
  });

  // Delete from right to left so column indexes remain valid.
  duplicateColumns
    .map(item => item.column)
    .sort((a, b) => b - a)
    .forEach(column => sheet.deleteColumn(column));

  headers = getHeaders(sheet);

  // Remove the retired Last Contacted column from all managed sheets.
  headers = getHeaders(sheet);
  const obsolete = [];
  headers.forEach((header, index) => {
    if (normalizeHeader(header) === "lastcontacted") obsolete.push(index + 1);
  });
  obsolete.sort((a,b) => b-a).forEach(column => sheet.deleteColumn(column));
  headers = getHeaders(sheet);

  // Now add only genuinely missing required headers.
  const existing = {};
  headers.forEach(header => {
    const normalized = normalizeHeader(header);
    if (normalized && !existing[normalized]) {
      existing[normalized] = true;
    }
  });

  required.forEach(header => {
    const normalized = normalizeHeader(header);

    if (!existing[normalized]) {
      const column = sheet.getLastColumn() + 1;
      sheet.getRange(1, column).setValue(header);
      existing[normalized] = true;
    }
  });

  formatHeader(sheet);
  applyCallStatusValidation_(sheet);
}

function standardizeAllCallStatuses() {
  const master = getMasterSpreadsheet_();
  const managedSheets = [getSheet(), ...getCounselors().map(c => {
    try {
      return SpreadsheetApp.openById(c.spreadsheetId).getSheetByName(counselorLeadsSheetName(c.name));
    } catch (_) { return null; }
  }).filter(Boolean)];

  let changed = 0;
  managedSheets.forEach(sheet => {
    const headers = getHeaders(sheet);
    const col = headers.findIndex(h => normalizeHeader(h) === "callstatus") + 1;
    if (!col || sheet.getLastRow() < 2) {
      applyCallStatusValidation_(sheet);
      return;
    }
    const range = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
    const values = range.getValues();
    let dirty = false;
    values.forEach(row => {
      const next = normalizeCallStatus_(row[0]);
      if (String(row[0] ?? "").trim() !== next) { row[0] = next; dirty = true; changed++; }
    });
    if (dirty) range.setValues(values);
    applyCallStatusValidation_(sheet);
  });
  SpreadsheetApp.flush();
  return {status:"success", changed, sheets:managedSheets.length, message:"Call Status values standardized."};
}

function getHeaders(sheet) {
  const cols = sheet.getLastColumn();
  if (!cols) return [];
  return sheet.getRange(1,1,1,cols).getValues()[0].map(h => String(h).trim());
}

function findApplicationId(sheet, headers, id) {
  const col = headers.findIndex(h => ["applicationid","id"].includes(normalizeHeader(h)))+1;
  if (!col || sheet.getLastRow()<2) return 0;
  const values = sheet.getRange(2,col,sheet.getLastRow()-1,1).getValues();
  for (let i=0;i<values.length;i++) if (String(values[i][0]).trim()===String(id).trim()) return i+2;
  return 0;
}

function getExistingApplicationIds(sheet, headers) {
  const result={}; const col=headers.findIndex(h=>["applicationid","id"].includes(normalizeHeader(h)))+1;
  if (!col || sheet.getLastRow()<2) return result;
  sheet.getRange(2,col,sheet.getLastRow()-1,1).getValues().forEach((r,i)=>{const id=String(r[0]||"").trim();if(id)result[id]=i+2;});
  return result;
}

function getExistingFingerprints(sheet, headers) {
  const result={}; if(sheet.getLastRow()<2)return result;
  const rows=sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues();
  rows.forEach(row=>{const obj={};headers.forEach((h,i)=>obj[h]=row[i]);const fp=makeFingerprint({Name:obj.Name,Phone:obj.Phone,Email:obj.Email,College:obj.College,Department:obj.Department,Year:obj.Year,Domain:obj.Domain,Timestamp:obj.Timestamp});if(fp)result[fp]=true;});
  return result;
}

function makeFingerprint(app) {
  const p=[app.Name,app.Phone,app.Email,app.College,app.Department,app.Year,app.Domain,app.Timestamp].map(v=>String(v||"").trim().toLowerCase());
  if(!p[0]&&!p[1]&&!p[2])return ""; return p.join("|");
}

function formatRecoveryTimestamp(raw, blankIfMissing) {
  if(raw===null||raw===undefined||raw==="") return blankIfMissing ? "" : nowString();
  if(typeof raw === "number" || /^[0-9]{10,13}$/.test(String(raw))) {
    const n=Number(raw), ms=String(raw).length===10?n*1000:n;
    return Utilities.formatDate(new Date(ms),CONFIG.TIMEZONE,"dd-MM-yyyy hh:mm:ss a");
  }
  const s=String(raw).trim();
  const m=s.match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if(m)return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]||"00"}`;
  const parsed=new Date(s);
  return isNaN(parsed.getTime()) ? s : Utilities.formatDate(parsed,CONFIG.TIMEZONE,"dd-MM-yyyy hh:mm:ss a");
}

function normalizeHeader(header){return String(header||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
function value(input){return input===null||input===undefined?"":String(input).trim();}
function nowString(){return Utilities.formatDate(new Date(),CONFIG.TIMEZONE,"dd-MM-yyyy hh:mm:ss a");}
function formatHeader(sheet){const cols=sheet.getLastColumn();if(cols){sheet.getRange(1,1,1,cols).setFontWeight("bold");sheet.setFrozenRows(1);}}
function jsonResponse(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
