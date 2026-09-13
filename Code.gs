/************************************************************
 * INTERNSFORGE 2026
 * GOOGLE SHEETS RECEIVER + RECOVERY + CRM SYNC
 ************************************************************/

const CONFIG = {
  SHEET_NAME: "Sheet1",
  TIMEZONE: "Asia/Kolkata",
  HEADERS: [
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

const MASTER_SPREADSHEET_ID = "1zqXBMY_Y97cgk1wdT3ZdzqW1ZH7cmyAipIsDQCB3Nfs";

/**
 * ==========================================================
 * CANONICAL CALL STATUS CONFIGURATION
 * ==========================================================
 */

const CALL_STATUS_OPTIONS = [
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

const CALL_STATUS_MIGRATION = {
  "Called": "Connected",
  "Call Back": "Callback",
  "Follow Up": "Follow-up",
  "Selected": "Paid / Pre-Reg",
  "Joined": "Enrolled",
  "Not Reachable": "Not Picking"
};

/**
 * Convert legacy Call Status values to the canonical list.
 */
function standardizeCallStatus_(rawStatus) {
  const status = value(rawStatus);
  if (!status) return "";

  const migrationKey = Object.keys(CALL_STATUS_MIGRATION).find(
    key => key.toLowerCase() === status.toLowerCase()
  );

  return migrationKey
    ? CALL_STATUS_MIGRATION[migrationKey]
    : status;
}

/**
 * Apply the canonical Call Status dropdown to a managed sheet.
 */
function ensureCallStatusDropdown_(sheet) {
  if (!sheet) return;

  try {
    const headers = getHeaders(sheet);
    const statusCol =
      headers.findIndex(
        h => normalizeHeader(h) === "callstatus"
      ) + 1;

    if (!statusCol) return;

    const rows = Math.max(sheet.getMaxRows() - 1, 1);

    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(CALL_STATUS_OPTIONS, true)
      .setAllowInvalid(false)
      .build();

    sheet
      .getRange(2, statusCol, rows, 1)
      .setDataValidation(rule);
  } catch (error) {
    // Dropdown formatting is optional. Never let a typed-column restriction
    // break counselor registration or Firebase synchronization.
    console.log(
      "Call Status dropdown skipped for " +
      sheet.getName() +
      ": " +
      error.message
    );
  }
}


function getMasterSpreadsheet_() {
  return SpreadsheetApp.openById(MASTER_SPREADSHEET_ID);
}

const FIREBASE_SYNC_CONFIG = {
  DATABASE_URL: "https://mnc-internship-live-default-rtdb.asia-southeast1.firebasedatabase.app",
  SERVICE_ACCOUNT_PROPERTY: "FIREBASE_SERVICE_ACCOUNT_JSON"
};

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
  LEADS_SHEET_SUFFIX: "'s Leads",

  // Existing counselor files use this physical order (as shown in the
  // counselor LeadsTable screenshot). Keep this separate from Master Sheet1.
  LEADS_HEADERS: [
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
  ]
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

  // Only Master Sheet1 is handled here.
  // Counselor spreadsheets use counselorSpreadsheetOnEdit().
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  if (e.range.getRow() < 2) return;

  try {
    const headers = getHeaders(sheet);
    const assignedToCol =
      headers.findIndex(h => normalizeHeader(h) === "assignedto") + 1;

    // oldValue is only useful when the edited cell is Assigned To.
    // For Call Status / Remarks / Next Follow-up edits the current
    // assignment is already the correct counselor, so no old counselor
    // lookup is necessary.
    const previousAssignedTo =
      assignedToCol &&
      e.range.getNumRows() === 1 &&
      e.range.getNumColumns() === 1 &&
      e.range.getColumn() === assignedToCol
        ? value(e.oldValue)
        : "";

    const editedHeader =
      headers[e.range.getColumn() - 1] || "";
    const result = syncSheetRowToFirebase(
      e.range.getRow(),
      previousAssignedTo,
      {
        source: "Master Sheet",
        actor: "Master Sheet",
        editedColumn: e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 ? editedHeader : "",
        oldValue: e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 ? e.oldValue : "",
        newValue: e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 ? e.value : ""
      }
    );

    console.log(
      "MASTER EDIT → FIREBASE + COUNSELOR:",
      JSON.stringify(result)
    );

  } catch (error) {
    console.error(
      "Master Sheet synchronization failed:",
      error
    );
  }
}

function readManagedRow_(sheet, rowNumber, columnCount) {
  if (!sheet || !rowNumber || !columnCount) return [];

  // Google Sheets typed/table columns can reject bulk getValues() calls.
  // Prefer display values for managed CRM rows; fall back to individual
  // cell reads so one typed column cannot block the entire synchronization.
  try {
    return sheet.getRange(rowNumber, 1, 1, columnCount).getDisplayValues()[0];
  } catch (displayError) {
    const result = [];
    for (let col = 1; col <= columnCount; col++) {
      try {
        result.push(sheet.getRange(rowNumber, col).getDisplayValue());
      } catch (cellError) {
        // Last resort: a single-cell getValue().
        try {
          result.push(sheet.getRange(rowNumber, col).getValue());
        } catch (valueError) {
          throw new Error(
            "Cannot read " + sheet.getName() + " row " + rowNumber +
            ", column " + col + ": " + valueError.message
          );
        }
      }
    }
    return result;
  }
}

function counselorSpreadsheetOnEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (e.range.getRow() < 2) return;
  try {
    syncCounselorRowToFirebase(
      sheet,
      e.range.getRow(),
      {
        source: "Counselor Sheet",
        actor: normalizeCounselorName(sheet.getName().replace(/\'s Leads$/i, "")),
        editedColumn: getHeaders(sheet)[e.range.getColumn() - 1] || "",
        oldValue: e.oldValue,
        newValue: e.value
      }
    );
  } catch (error) {
    console.error("Counselor spreadsheet → Firebase sync failed:", error);
  }
}

function syncCounselorRowToFirebase(counselorSheet, rowNumber, editMeta) {
  if (!counselorSheet || !rowNumber || rowNumber < 2) {
    return {
      status: "skipped",
      reason: "Invalid counselor row"
    };
  }

  const headers = getHeaders(counselorSheet);
  const row = readManagedRow_(
    counselorSheet,
    rowNumber,
    headers.length
  );

  const raw = {};
  headers.forEach((header, index) => {
    raw[header] = row[index];
  });

  const applicationId = value(
    raw["Application ID"] ||
    raw.applicationId ||
    raw.id
  );

  if (!applicationId) {
    return {
      status: "skipped",
      reason: "Missing Application ID",
      counselorSheet: counselorSheet.getName(),
      row: rowNumber
    };
  }

  const app = buildApplicationObject(
    raw,
    applicationId
  );

  app["Call Status"] =
    standardizeCallStatus_(
      app["Call Status"]
    );

  const master = getMasterSpreadsheet_()
    .getSheetByName(CONFIG.SHEET_NAME);

  if (!master) {
    throw new Error(
      "Master Sheet1 was not found."
    );
  }

  const masterHeaders = CONFIG.HEADERS.slice();

  const masterRow =
    findApplicationId(
      master,
      masterHeaders,
      applicationId
    );

  let previousAssignedTo = "";

  /*
   * ==========================================================
   * COUNSELOR → MASTER
   * ==========================================================
   *
   * The counselor normally changes Call Status, Remarks or
   * Next Follow-up. Do not allow a blank Assigned To in the
   * counselor copy to unassign the lead in Master.
   */
  if (masterRow > 0) {
    const masterCurrent =
      readManagedRow_(
        master,
        masterRow,
        masterHeaders.length
      );

    previousAssignedTo =
      getAssignedToFromRow(
        masterHeaders,
        masterCurrent
      );

    if (!value(app["Assigned To"])) {
      app["Assigned To"] =
        previousAssignedTo;
    }

    /*
     * Update only the fields represented by the counselor edit.
     * This avoids replacing the entire typed Master row.
     */
    const fieldNames = [
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
      "Next Follow-up",
      "Assigned To"
    ];

    fieldNames.forEach(field => {
      const col =
        masterHeaders.findIndex(
          h => normalizeHeader(h) === normalizeHeader(field)
        ) + 1;

      if (!col) return;

      /*
       * Preserve Master values for ordinary fields when the
       * counselor copy does not contain a value.
       *
       * CRM control fields are allowed to update explicitly.
       */
      const incoming =
        app[field];

      const isControlField =
        [
          "Call Status",
          "Remarks",
          "Next Follow-up",
          "Assigned To"
        ].includes(field);

      if (
        isControlField ||
        value(incoming) !== ""
      ) {
        try {
          master
            .getRange(masterRow, col)
            .setValue(incoming || "");
        } catch (error) {
          throw new Error(
            "Could not update Master " +
            field +
            " for application " +
            applicationId +
            ": " +
            error.message
          );
        }
      }
    });

  } else {
    /*
     * Lead is not in Master yet.
     * Append using the Master's actual column order.
     */
    master.appendRow(
      buildRow(
        masterHeaders,
        app
      )
    );
  }

  SpreadsheetApp.flush();

  /*
   * ==========================================================
   * COUNSELOR → FIREBASE / APPLICATION MANAGEMENT
   * ==========================================================
   */
  const firebaseUpdates = {
    callStatus:
      value(app["Call Status"]),

    nextFollowUpAt:
      sheetDateToIso(
        app["Next Follow-up"]
      ),

    assignedTo:
      value(app["Assigned To"]),

    remarks:
      value(app["Remarks"])
  };

  const editable = {
    name: value(app["Name"]),
    phone: value(app["Phone"]),
    email: value(app["Email"]),
    college: value(app["College"]),
    department: value(app["Department"]),
    year: value(app["Year"]),
    domain: value(app["Domain"]),
    state: value(app["State"]),
    communicationLanguage:
      value(app["Communication Language"]),
    startAvailability:
      value(app["Start Availability"]),
    applicationReason:
      value(app["Application Reason"])
  };

  Object.keys(editable).forEach(key => {
    if (editable[key] !== "") {
      firebaseUpdates[key] =
        editable[key];
    }
  });

  const firebaseResult =
    firebaseRestPatch(
      "/submittedApplications/" +
        encodeURIComponent(applicationId),
      firebaseUpdates
    );

  /*
   * If Assigned To was deliberately changed in the counselor
   * sheet, route the lead to the new counselor.
   */
  const newAssignedTo =
    value(app["Assigned To"]);

  if (
    newAssignedTo &&
    newAssignedTo.toLowerCase() !==
      previousAssignedTo.toLowerCase()
  ) {
    syncApplicationToCounselorSheet(
      app,
      previousAssignedTo
    );
  }

  logApplicationSheetEdit_(
    applicationId,
    value(editMeta && editMeta.source) || "Counselor Sheet",
    value(editMeta && editMeta.actor) || normalizeCounselorName(counselorSheet.getName().replace(/\'s Leads$/i, "")),
    value(editMeta && editMeta.editedColumn),
    value(editMeta && editMeta.oldValue),
    value(editMeta && editMeta.newValue)
  );

  return {
    status: "success",
    applicationId:
      applicationId,
    counselorSheet:
      counselorSheet.getName(),
    counselorRow:
      rowNumber,
    masterRow:
      masterRow > 0
        ? masterRow
        : master.getLastRow(),
    callStatus:
      app["Call Status"] || "",
    assignedTo:
      app["Assigned To"] || "",
    firebase:
      firebaseResult
  };
}


function syncSheetRowToFirebase(rowNumber, previousAssignedTo, editMeta) {
  const sheet = getSheet();

  if (
    !rowNumber ||
    rowNumber < 2 ||
    rowNumber > sheet.getLastRow()
  ) {
    return {
      status: "skipped",
      reason: "Invalid row",
      row: rowNumber
    };
  }

  const headers = getHeaders(sheet);
  const row = readManagedRow_(sheet, rowNumber, headers.length);

  const record = {};

  headers.forEach((header, index) => {
    record[normalizeHeader(header)] = row[index];
  });

  const applicationId = value(
    record.applicationid || record.id
  );

  if (!applicationId) {
    console.warn(
      "Master row " +
      rowNumber +
      " has no Application ID; skipping."
    );

    return {
      status: "skipped",
      reason: "Missing Application ID",
      row: rowNumber
    };
  }

  /*
   * Build the complete application object from the CURRENT
   * Master Sheet row. This is important because the user may
   * have just changed Call Status, Next Follow-up, Assigned To,
   * Remarks, or another editable field.
   */
  const app = buildApplicationObject(
    record,
    applicationId
  );

  // Always store the canonical Call Status.
  app["Call Status"] =
    standardizeCallStatus_(app["Call Status"]);

  /*
   * Do not write back to the Master Call Status typed column during
   * synchronization. The selected value is synced as-is (after legacy
   * normalization) to Firebase and the counselor sheet.
   */

  /*
   * ==========================================================
   * 1. MASTER SHEET → FIREBASE / APPLICATION MANAGEMENT
   * ==========================================================
   */
  const updates = {
    callStatus: value(app["Call Status"]),
    nextFollowUpAt: sheetDateToIso(
      app["Next Follow-up"]
    ),
    assignedTo: value(app["Assigned To"]),
    remarks: value(app["Remarks"])
  };

  const editableFields = {
    name: value(app["Name"]),
    phone: value(app["Phone"]),
    email: value(app["Email"]),
    college: value(app["College"]),
    department: value(app["Department"]),
    year: value(app["Year"]),
    domain: value(app["Domain"]),
    state: value(app["State"]),
    communicationLanguage:
      value(app["Communication Language"]),
    startAvailability:
      value(app["Start Availability"]),
    applicationReason:
      value(app["Application Reason"])
  };

  Object.keys(editableFields).forEach(key => {
    if (editableFields[key] !== "") {
      updates[key] = editableFields[key];
    }
  });

  const firebaseResult = firebaseRestPatch(
    "/submittedApplications/" +
      encodeURIComponent(applicationId),
    updates
  );

  /*
   * ==========================================================
   * 2. MASTER SHEET → ASSIGNED COUNSELOR SHEET
   * ==========================================================
   *
   * This is deliberately part of the SAME live edit operation.
   * Therefore changing Call Status in Sheet1 immediately mirrors
   * that status into the assigned counselor's Leads sheet.
   */
  const counselorResult =
    syncApplicationToCounselorSheet(
      app,
      value(previousAssignedTo)
    );

  SpreadsheetApp.flush();

  logApplicationSheetEdit_(
    applicationId,
    value(editMeta && editMeta.source) || "Master Sheet",
    value(editMeta && editMeta.actor) || "Master Sheet",
    value(editMeta && editMeta.editedColumn),
    value(editMeta && editMeta.oldValue),
    value(editMeta && editMeta.newValue)
  );

  console.log(
    "Master → Firebase + Counselor synchronized:",
    applicationId,
    "status=",
    app["Call Status"]
  );

  return {
    status: "success",
    applicationId: applicationId,
    row: rowNumber,
    callStatus: app["Call Status"],
    assignedTo: app["Assigned To"] || "",
    firebase: firebaseResult,
    counselor: counselorResult
  };
}


/**
 * Manual diagnostic:
 * Select any lead row in Master Sheet1 and run this function.
 * It performs the SAME Master → Firebase → Counselor operation
 * used by the live onEdit trigger.
 */
function testSelectedMasterLeadSync() {
  const sheet = getSheet();
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    "Test Master → Firebase → Counselor Sync",
    "Enter the row number of the lead you want to test.\n\nExample: 2, 3, 15...",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return "Cancelled";
  }

  const rowNumber = parseInt(
    value(response.getResponseText()),
    10
  );

  if (!rowNumber || rowNumber < 2) {
    ui.alert(
      "Invalid Row",
      "Enter a lead row number of 2 or greater.",
      ui.ButtonSet.OK
    );
    return {
      status: "error",
      message: "Invalid lead row number."
    };
  }

  if (rowNumber > sheet.getLastRow()) {
    ui.alert(
      "Row Not Found",
      "Row " + rowNumber + " does not exist in Master Sheet1.",
      ui.ButtonSet.OK
    );
    return {
      status: "error",
      message: "Row is outside the Master Sheet data range.",
      row: rowNumber
    };
  }

  const result = syncSheetRowToFirebase(
    rowNumber,
    ""
  );

  console.log(
    "TEST RESULT:",
    JSON.stringify(result)
  );

  ui.alert(
    "Sync Test Complete",
    "Application ID: " + (result.applicationId || "N/A") +
    "\nCall Status: " + (result.callStatus || "N/A") +
    "\nAssigned To: " + (result.assignedTo || "Unassigned") +
    "\n\nCheck Master Sheet, Firebase, and the assigned counselor sheet.",
    ui.ButtonSet.OK
  );

  return result;
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



/**
 * ==========================================================
 * APPLICATION ACTIVITY / AUDIT TRAIL
 * ==========================================================
 * Stores an append-only activity record in:
 * /applicationActivity/{Application ID}/{eventId}
 *
 * This is intentionally separate from the application record so the
 * current lead state remains compact while its history remains recoverable.
 */
function recordApplicationActivity_(applicationId, payload) {
  const id = value(applicationId);
  if (!id) return {status:"skipped", reason:"Missing Application ID"};

  const eventId = Utilities.getUuid();
  const event = {
    eventId: eventId,
    applicationId: id,
    timestampMs: Date.now(),
    timestamp: nowString(),
    source: value(payload && payload.source) || "Google Sheets",
    actor: value(payload && payload.actor) || "System",
    action: value(payload && payload.action) || "Updated",
    field: value(payload && payload.field) || "",
    oldValue: value(payload && payload.oldValue),
    newValue: value(payload && payload.newValue),
    summary: value(payload && payload.summary) || ""
  };

  try {
    firebaseRestPatch(
      "/applicationActivity/" +
        encodeURIComponent(id) +
        "/" +
        encodeURIComponent(eventId),
      event
    );
    return {status:"success", eventId:eventId};
  } catch (error) {
    console.warn("Application activity log failed:", error);
    return {status:"error", message:error.message || String(error)};
  }
}

function recordApplicationActivityBatch_(applicationId, entries) {
  const results = [];
  (entries || []).forEach(entry => {
    results.push(recordApplicationActivity_(applicationId, entry));
  });
  return results;
}

function logApplicationSheetEdit_(applicationId, source, actor, editedColumn, oldValue, newValue) {
  const column = value(editedColumn);
  const oldText = value(oldValue);
  const newText = value(newValue);

  if (column) {
    return recordApplicationActivity_(applicationId, {
      source: source,
      actor: actor,
      action: "Field updated",
      field: column,
      oldValue: oldText,
      newValue: newText,
      summary: column + " changed" + (oldText || newText ? " from \"" + oldText + "\" to \"" + newText + "\"" : "")
    });
  }

  return recordApplicationActivity_(applicationId, {
    source: source,
    actor: actor,
    action: "Lead updated",
    summary: "Lead record synchronized from " + source
  });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return jsonResponse({status:"error", message:"No data received."});
    const data = JSON.parse(e.postData.contents);
    if (data.action === "syncApplications") return jsonResponse(syncApplicationsToSheet(data.applications || [], data.updateExisting === true));
    if (data.action === "updateApplication") return jsonResponse(updateApplicationInSheet(data.application || {}));
    if (data.action === "deleteApplication") return jsonResponse(deleteApplicationFromSheets(data.application || data));
    if (data.action === "registerCounselor") return jsonResponse(registerCounselor(data.counselorName || data.name || "", data.spreadsheetId || data.sheetId || ""));
    if (data.action === "removeCounselor") return jsonResponse(removeCounselor(data.counselorName || data.name || ""));
    if (data.action === "health") return jsonResponse({status:"online", time:nowString(), message:"InternsForge Sheets receiver is healthy."});
    return saveSingleApplication(data);
  } catch (error) {
    console.error("POST ERROR", error);
    return jsonResponse({status:"error", message:error.message || String(error)});
  }
}

/**
 * Delete ONE application everywhere it is managed by InternsForge.
 * Firebase is intentionally handled by the dashboard after this request;
 * this endpoint removes the corresponding Master row and every counselor
 * copy so stale lead records cannot remain in Google Sheets.
 */
function deleteApplicationFromSheets(raw) {
  raw = raw || {};
  const applicationId = value(raw.applicationId || raw.applicationID || raw.id || raw.key);
  if (!applicationId) {
    return {status:"error", message:"Application ID is required."};
  }

  const result = {
    status:"success",
    applicationId:applicationId,
    masterDeleted:0,
    counselorDeleted:0,
    counselorsChecked:0,
    errors:[]
  };

  // 1) Delete the canonical Master Sheet row.
  try {
    const master = getMasterSpreadsheet_();
    const sheet = master.getSheetByName(CONFIG.SHEET_NAME);
    if (sheet) {
      const headers = getHeaders(sheet);
      const rowNumber = findApplicationId(sheet, headers, applicationId);
      if (rowNumber > 0) {
        sheet.deleteRow(rowNumber);
        SpreadsheetApp.flush();
        result.masterDeleted = 1;
        result.masterRow = rowNumber;
      }
    }
  } catch (error) {
    result.errors.push("Master: " + error.message);
  }

  // 2) Delete every counselor copy, not just the currently assigned one.
  //    This also cleans up duplicates created by older routing versions.
  try {
    const counselors = getCounselors();
    counselors.forEach(function(counselor) {
      const name = normalizeCounselorName(counselor.name);
      const spreadsheetId = value(counselor.spreadsheetId);
      if (!name || !spreadsheetId) return;
      result.counselorsChecked++;
      try {
        const ss = SpreadsheetApp.openById(spreadsheetId);
        const leadSheet = findCounselorLeadSheet_(ss, name, false);
        if (!leadSheet) return;
        const headers = getHeaders(leadSheet);
        let rowNumber = findApplicationId(leadSheet, headers, applicationId);
        // A duplicate is possible in an old sheet. Remove all matching rows.
        while (rowNumber > 0) {
          leadSheet.deleteRow(rowNumber);
          result.counselorDeleted++;
          rowNumber = findApplicationId(leadSheet, headers, applicationId);
        }
      } catch (error) {
        result.errors.push(name + ": " + error.message);
      }
    });
  } catch (error) {
    result.errors.push("Counselors: " + error.message);
  }

  if (result.errors.length) result.status = "completed_with_errors";
  result.message = result.masterDeleted || result.counselorDeleted
    ? "Application deleted from Google Sheets."
    : "Application ID was not found in Google Sheets.";
  return result;
}

function saveSingleApplication(data) {
  const sheet = getSheet();
  const application = buildApplicationObject(data, value(data.applicationId || data.id || data.applicationID));
  application["Call Status"] = standardizeCallStatus_(application["Call Status"]);
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
     app["Call Status"] = standardizeCallStatus_(app["Call Status"]);
    if (!app.Name || !app.Phone || !app.Email || !app.College || !app.Department || !app.Year || !app.Domain) { invalid++; return; }

    if (id && existingIds[id]) {
      if (updateExisting) {
        const rowNumber = existingIds[id];
        const current = readManagedRow_(sheet, rowNumber, headers.length);
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
  app["Call Status"] = standardizeCallStatus_(app["Call Status"]);

  let previousAssignedTo = "";

  if (rowNumber > 0) {
    const current = readManagedRow_(sheet, rowNumber, headers.length);
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
  const current = readManagedRow_(sheet, rowNumber, headers.length);
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


function findCounselorLeadSheet_(ss, counselorName, createIfMissing) {
  if (!ss) return null;

  const expected = counselorLeadsSheetName(counselorName);

  // Existing installations may use LeadsTable or LeadApplications.
  const candidates = [
    expected,
    "LeadsTable",
    "LeadApplications"
  ].filter(Boolean);

  for (const name of candidates) {
    const sheet = ss.getSheetByName(name);
    if (sheet) return sheet;
  }

  if (createIfMissing) {
    return ss.insertSheet(expected);
  }

  return null;
}

function counselorLeadsSheetName(name) {
  const clean = normalizeCounselorName(name);
  if (!clean) return "";
  return (clean + COUNSELOR_CONFIG.LEADS_SHEET_SUFFIX).slice(0, 100);
}

function getCounselorConfigSheet() {
  const ss = getMasterSpreadsheet_();
  let sheet = ss.getSheetByName(COUNSELOR_CONFIG.LIST_SHEET_NAME);

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

function removeCounselor(name) {
  const counselorName = normalizeCounselorName(name);
  if (!counselorName) return {status:"error", message:"Counselor name is required."};

  const config = getCounselorConfigSheet();
  const headers = getHeaders(config);
  const nameCol = headers.findIndex(h => normalizeHeader(h) === "counselorname") + 1;
  const activeCol = headers.findIndex(h => normalizeHeader(h) === "active") + 1;

  if (!nameCol) return {status:"error", message:"Counselor registry is missing the Counselor Name column."};

  let rowNumber = 0;
  if (config.getLastRow() >= 2) {
    const vals = config.getRange(2, nameCol, config.getLastRow() - 1, 1).getDisplayValues();
    for (let i = 0; i < vals.length; i++) {
      if (normalizeCounselorName(vals[i][0]).toLowerCase() === counselorName.toLowerCase()) {
        rowNumber = i + 2;
        break;
      }
    }
  }

  if (!rowNumber) {
    return {status:"success", counselorName:counselorName, removed:false, message:"Counselor was not present in the registry."};
  }

  // Keep the counselor spreadsheet intact. Mark the registry entry inactive
  // rather than deleting the external spreadsheet or its historical records.
  if (activeCol) {
    config.getRange(rowNumber, activeCol).setValue("No");
  } else {
    config.deleteRow(rowNumber);
  }
  SpreadsheetApp.flush();

  return {
    status:"success",
    counselorName:counselorName,
    removed:true,
    message:"Counselor removed from the active dashboard registry. The separate counselor spreadsheet was not deleted."
  };
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
  ensureCallStatusDropdown_(leadsSheet);

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
    const sheet = findCounselorLeadSheet_(
      ss,
      name,
      true
    );
    const sheetName = sheet.getName();
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
  })).filter(item => item.name && String(item.active || "Yes").trim().toLowerCase() !== "no" && String(item.active || "Yes").trim().toLowerCase() !== "false");
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


/**
 * One-time setup helper.
 * Ensures every active counselor spreadsheet in the Counselors
 * registry has an installable onEdit trigger.
 */
function ensureAllCounselorTriggers() {
  const counselors = getCounselors();
  let created = 0;
  let existing = 0;
  const errors = [];

  counselors.forEach(counselor => {
    const id = value(counselor.spreadsheetId);
    const name = normalizeCounselorName(counselor.name);

    if (!name || !id) return;

    try {
      const triggers =
        ScriptApp.getProjectTriggers();

      const alreadyExists =
        triggers.some(trigger =>
          trigger.getHandlerFunction() ===
            "counselorSpreadsheetOnEdit" &&
          trigger.getTriggerSourceId &&
          trigger.getTriggerSourceId() === id
        );

      if (alreadyExists) {
        existing++;
      } else {
        ScriptApp.newTrigger(
          "counselorSpreadsheetOnEdit"
        )
          .forSpreadsheet(id)
          .onEdit()
          .create();

        created++;
      }

    } catch (error) {
      errors.push(
        name + ": " + error.message
      );
    }
  });

  return {
    status:
      errors.length
        ? "completed_with_errors"
        : "success",
    created: created,
    existing: existing,
    errors: errors
  };
}

function removeApplicationFromAllOtherCounselors_(applicationId, keepCounselorName) {
  const id = value(applicationId);
  const keep = normalizeCounselorName(keepCounselorName).toLowerCase();
  if (!id) return {checked:0, removed:0, errors:[]};

  const counselors = getCounselors();
  let checked = 0;
  let removed = 0;
  const errors = [];

  counselors.forEach(counselor => {
    const name = normalizeCounselorName(counselor.name);
    const spreadsheetId = value(counselor.spreadsheetId);
    if (!name || !spreadsheetId || name.toLowerCase() === keep) return;
    checked++;
    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      const sheet = ss.getSheetByName(counselorLeadsSheetName(name));
      if (!sheet) return;
      const headers = getHeaders(sheet);
      const rowNumber = findApplicationId(sheet, headers, id);
      if (rowNumber > 0) {
        sheet.deleteRow(rowNumber);
        removed++;
      }
    } catch (error) {
      errors.push(name + ': ' + error.message);
    }
  });

  return {checked:checked, removed:removed, errors:errors};
}


/**
 * Remove all counselor onEdit triggers created by this project and recreate
 * one installable trigger for every counselor spreadsheet in the registry.
 */
function reinstallAllCounselorTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === "counselorSpreadsheetOnEdit") {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  const result = ensureAllCounselorTriggers();

  return {
    status: result.status,
    removed: removed,
    created: result.created,
    existing: result.existing,
    errors: result.errors
  };
}

/**
 * Directly test one counselor row without depending on the installable
 * onEdit trigger. This is the safest way to diagnose counselor → Master.
 */
function testCounselorRowSync() {
  const ui = SpreadsheetApp.getUi();

  const counselorResponse = ui.prompt(
    "Test Counselor → Master Sync",
    "Enter the counselor name exactly as it appears in the Counselors sheet:",
    ui.ButtonSet.OK_CANCEL
  );

  if (counselorResponse.getSelectedButton() !== ui.Button.OK) {
    return "Cancelled";
  }

  const counselorName =
    normalizeCounselorName(
      counselorResponse.getResponseText()
    );

  if (!counselorName) {
    ui.alert("Counselor name is required.");
    return {
      status: "error",
      message: "Counselor name is required."
    };
  }

  const record = getCounselorRecord(counselorName);

  if (!record || !record.spreadsheetId) {
    ui.alert(
      "Counselor Not Configured",
      "No Spreadsheet ID was found for " + counselorName +
      " in the Counselors sheet.",
      ui.ButtonSet.OK
    );

    return {
      status: "error",
      message: "Counselor or Spreadsheet ID not found."
    };
  }

  const ss =
    SpreadsheetApp.openById(
      record.spreadsheetId
    );

  const sheet =
    findCounselorLeadSheet_(
      ss,
      counselorName,
      false
    );

  if (!sheet) {
    ui.alert(
      "Lead Sheet Not Found",
      "Could not find " +
      counselorLeadsSheetName(counselorName) +
      ", LeadsTable, or LeadApplications in the counselor spreadsheet.",
      ui.ButtonSet.OK
    );

    return {
      status: "error",
      message: "Counselor lead sheet not found."
    };
  }

  const rowResponse = ui.prompt(
    "Test Counselor Row",
    "Enter the lead row number in " + sheet.getName() +
    ". Example: 2",
    ui.ButtonSet.OK_CANCEL
  );

  if (rowResponse.getSelectedButton() !== ui.Button.OK) {
    return "Cancelled";
  }

  const rowNumber =
    parseInt(
      value(rowResponse.getResponseText()),
      10
    );

  if (!rowNumber || rowNumber < 2 || rowNumber > sheet.getLastRow()) {
    ui.alert(
      "Invalid Row",
      "Enter a valid lead row between 2 and " +
      sheet.getLastRow() + ".",
      ui.ButtonSet.OK
    );

    return {
      status: "error",
      message: "Invalid counselor lead row.",
      row: rowNumber
    };
  }

  const result =
    syncCounselorRowToFirebase(
      sheet,
      rowNumber
    );

  ui.alert(
    "Counselor Sync Test Complete",
    "Counselor: " + counselorName +
    "\nSheet: " + sheet.getName() +
    "\nRow: " + rowNumber +
    "\nApplication ID: " + (result.applicationId || "N/A") +
    "\nStatus: " + (result.status || "N/A") +
    "\n\nCheck the corresponding Master row and Firebase.",
    ui.ButtonSet.OK
  );

  console.log(
    "COUNSELOR TEST RESULT:",
    JSON.stringify(result)
  );

  return result;
}



function diagnoseCounselorTriggers() {
  const counselors = getCounselors();
  const triggers = ScriptApp.getProjectTriggers();

  const result = counselors.map(counselor => {
    const id = value(counselor.spreadsheetId);
    const name = normalizeCounselorName(counselor.name);

    const triggerExists = triggers.some(trigger =>
      trigger.getHandlerFunction() ===
        "counselorSpreadsheetOnEdit" &&
      trigger.getTriggerSourceId &&
      trigger.getTriggerSourceId() === id
    );

    let sheetName = "";
    let sheetFound = false;
    let error = "";

    try {
      const ss = SpreadsheetApp.openById(id);
      const sheet =
        findCounselorLeadSheet_(
          ss,
          name,
          false
        );

      if (sheet) {
        sheetName = sheet.getName();
        sheetFound = true;
      }
    } catch (e) {
      error = e.message;
    }

    return {
      counselor: name,
      spreadsheetId: id,
      triggerExists: triggerExists,
      leadSheet: sheetName,
      leadSheetFound: sheetFound,
      error: error
    };
  });

  console.log(
    "COUNSELOR TRIGGER DIAGNOSTIC:",
    JSON.stringify(result)
  );

  return result;
}


function syncApplicationToCounselorSheet(app, previousAssignedTo) {
  const newAssignedTo =
    normalizeCounselorName(app["Assigned To"]);

  const oldAssignedTo =
    normalizeCounselorName(previousAssignedTo);

  const applicationId =
    value(app["Application ID"]);

  if (!applicationId) {
    return {
      status: "skipped",
      reason: "Missing Application ID"
    };
  }

  /*
   * If the admin changed Assigned To in Master Sheet1, remove
   * the old copy from the previous counselor.
   */
  if (
    oldAssignedTo &&
    oldAssignedTo.toLowerCase() !==
      newAssignedTo.toLowerCase()
  ) {
    removeApplicationFromCounselorSpreadsheet(
      oldAssignedTo,
      applicationId
    );
  }

  // If the previous assignment was unavailable (for example a pasted/multi-cell
  // edit has no e.oldValue), remove stale copies from every other counselor.
  // This prevents duplicate leads after reassignment.
  if (newAssignedTo && !oldAssignedTo) {
    removeApplicationFromAllOtherCounselors_(
      applicationId,
      newAssignedTo
    );
  }

  /*
   * If the lead is intentionally unassigned, Firebase and Master
   * remain valid and there is simply no counselor copy to maintain.
   */
  if (!newAssignedTo) {
    return {
      status: "success",
      applicationId: applicationId,
      assignedTo: "",
      counselor: null
    };
  }

  const finalRecord =
    getCounselorRecord(newAssignedTo);

  if (
    !finalRecord ||
    !finalRecord.spreadsheetId
  ) {
    throw new Error(
      'Counselor "' +
        newAssignedTo +
        '" is not configured. Add the counselor and their Spreadsheet ID in the master Counselors sheet first.'
    );
  }

  const ss =
    SpreadsheetApp.openById(
      finalRecord.spreadsheetId
    );

  const sheetName =
    counselorLeadsSheetName(
      newAssignedTo
    );

  let sheet =
    findCounselorLeadSheet_(
      ss,
      newAssignedTo,
      true
    );

  if (!sheet) {
    throw new Error(
      "Could not create/find the counselor lead sheet for " +
      newAssignedTo
    );
  }

  ensureHeaders(sheet);

  app["Call Status"] =
    standardizeCallStatus_(
      app["Call Status"]
    );

  const headers =
    getHeaders(sheet);

  const newRow =
    buildRow(headers, app);

  const rowNumber =
    findApplicationId(
      sheet,
      headers,
      applicationId
    );

  if (rowNumber > 0) {

    const current =
      sheet
        .getRange(
          rowNumber,
          1,
          1,
          headers.length
        )
        .getValues()[0];

    const next =
      current.slice();

    headers.forEach(
      (header, index) => {

        const incoming =
          newRow[index];

        /*
         * CRM-controlled fields MUST always mirror Master.
         * This is especially important for Call Status.
         */
        const forceSync =
          [
            "Call Status",
            "Next Follow-up",
            "Assigned To",
            "Remarks"
          ].includes(header);

        if (
          forceSync ||
          String(incoming ?? "").trim() !== ""
        ) {
          next[index] =
            incoming ??
            current[index];
        }
      }
    );

    sheet
      .getRange(
        rowNumber,
        1,
        1,
        headers.length
      )
      .setValues([next]);

  } else {

    sheet.appendRow(newRow);
  }

  SpreadsheetApp.flush();

  return {
    status: "success",
    applicationId: applicationId,
    counselor: newAssignedTo,
    sheetName: sheetName,
    row: rowNumber > 0
      ? rowNumber
      : sheet.getLastRow(),
    callStatus: app["Call Status"]
  };
}
function removeApplicationFromCounselorSpreadsheet(counselorName, applicationId) {
  const record = getCounselorRecord(counselorName);
  if (!record || !record.spreadsheetId) return;
  try {
    const ss = SpreadsheetApp.openById(record.spreadsheetId);
    const sheet = findCounselorLeadSheet_(
      ss,
      counselorName,
      false
    );
    if (!sheet) return;
    const rowNumber = findApplicationId(sheet, getHeaders(sheet), applicationId);
    if (rowNumber > 0) sheet.deleteRow(rowNumber);
  } catch (error) {
    console.error("Could not remove application from counselor spreadsheet:", error);
  }
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
  data = data || {};

  /*
   * IMPORTANT SYNC FIX
   * -------------------
   * Master Sheet1 is read through a normalized-header map in
   * syncSheetRowToFirebase(). That means keys can arrive as
   * `callstatus`, `assignedto`, `nextfollowup`, etc.
   *
   * The previous implementation only looked for camelCase keys
   * such as `callStatus` and `assignedTo`. As a result, a normal
   * Master Sheet edit could send empty Call Status / Assigned To
   * values to Firebase. The dashboard then received those empty
   * values and sent them back to Google Sheets, making the user's
   * update appear to disappear.
   *
   * Pick values case-insensitively and without punctuation so the
   * same builder works for Master rows, counselor rows, Firebase
   * objects and dashboard recovery payloads.
   */
  const keys = Object.keys(data);
  const normalized = {};
  keys.forEach(key => {
    const n = normalizeHeader(key);
    if (n && normalized[n] === undefined) normalized[n] = data[key];
  });

  const pick = (...candidates) => {
    for (const candidate of candidates) {
      const n = normalizeHeader(candidate);
      if (n && normalized[n] !== undefined && normalized[n] !== null && String(normalized[n]).trim() !== "") {
        return normalized[n];
      }
    }
    return "";
  };

  return {
    "Timestamp": formatRecoveryTimestamp(pick("submittedAtMs", "submittedAt", "timestamp", "createdAt", "created_at", "Timestamp")),
    "Application ID": value(applicationId || pick("Application ID", "applicationId", "applicationID", "id", "key")),
    "Name": value(pick("name", "fullName", "studentName", "Name")),
    "Phone": value(pick("phone", "whatsapp", "phoneNumber", "Phone")),
    "Email": value(pick("email", "emailAddress", "Email")),
    "College": value(pick("college", "collegeName", "College")),
    "Department": value(pick("department", "branch", "Department")),
    "Year": value(pick("year", "currentYear", "Year")),
    "Domain": value(pick("domain", "interestDomain", "interesteddomain", "preferredDomain", "Domain")),
    "State": value(pick("state", "stateUT", "stateUnionTerritory", "State")),
    "Communication Language": value(pick("communicationLanguage", "language", "languages", "Communication Language")),
    "Start Availability": value(pick("startAvailability", "availability", "whenAreYouAvailableToStart", "Start Availability")),
    "Application Reason": value(pick("applicationReason", "reason", "whyAreYouApplying", "interest", "Application Reason")),
    "Call Status": value(pick("callStatus", "Call Status")),
    "Next Follow-up": formatRecoveryTimestamp(pick("nextFollowUpAt", "nextFollowUp", "followUpAt", "Next Follow-up"), true),
    "Assigned To": value(pick("assignedTo", "Assigned To")),
    "Remarks": value(pick("remarks", "remark", "Remarks"))
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

/**
 * Repair Google Sheets Table column names without writing directly into typed
 * table cells. Google Sheets Tables keep their column names in the Table
 * metadata; writing A1 headers with Range.setValues() can fail on typed columns.
 * This uses the Sheets API over UrlFetchApp so no Advanced Sheets service is
 * required.
 */
function updateManagedTableHeaders_(sheet) {
  if (!sheet) return false;

  const sheetName = sheet.getName();
  let required = null;

  if (sheetName === CONFIG.SHEET_NAME) {
    required = CONFIG.HEADERS.slice();
  } else if (
    typeof COUNSELOR_CONFIG !== "undefined" &&
    (
      sheetName.endsWith(COUNSELOR_CONFIG.LEADS_SHEET_SUFFIX) ||
      sheetName === "LeadsTable" ||
      sheetName === "LeadApplications"
    )
  ) {
    required = COUNSELOR_CONFIG.LEADS_HEADERS.slice();
  }

  if (!required) return false;

  try {
    const spreadsheetId = sheet.getParent().getId();
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(spreadsheetId) +
      "?fields=sheets(properties(sheetId,title),tables(tableId,name,columnProperties))";

    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken()
      },
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      console.log("Table metadata read skipped: HTTP " + code + " " + response.getContentText());
      return false;
    }

    const data = JSON.parse(response.getContentText() || "{}");
    const apiSheet = (data.sheets || []).find(function(item) {
      return item.properties && item.properties.sheetId === sheet.getSheetId();
    });

    const tables = apiSheet && apiSheet.tables ? apiSheet.tables : [];
    if (!tables.length) return false;

    // Prefer the table whose width matches the managed schema.
    const table = tables.find(function(t) {
      return Array.isArray(t.columnProperties) &&
        t.columnProperties.length === required.length;
    }) || tables[0];

    if (!table || !Array.isArray(table.columnProperties)) return false;

    const columns = table.columnProperties.map(function(column, index) {
      return Object.assign({}, column, {
        columnIndex: index,
        columnName: required[index] || column.columnName || ("Column " + (index + 1))
      });
    });

    const same = table.columnProperties.length === columns.length &&
      columns.every(function(column, index) {
        return String(table.columnProperties[index].columnName || "") ===
          String(column.columnName || "");
      });

    if (same) return false;

    const updateUrl =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(spreadsheetId) + ":batchUpdate";

    const updateBody = {
      requests: [{
        updateTable: {
          table: {
            tableId: table.tableId,
            columnProperties: columns
          },
          fields: "columnProperties"
        }
      }]
    };

    const updateResponse = UrlFetchApp.fetch(updateUrl, {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken()
      },
      payload: JSON.stringify(updateBody),
      muteHttpExceptions: true
    });

    const updateCode = updateResponse.getResponseCode();
    if (updateCode < 200 || updateCode >= 300) {
      console.log("Table header repair failed: HTTP " + updateCode + " " + updateResponse.getContentText());
      return false;
    }

    console.log(
      "Table headers repaired for " + sheet.getName() +
      ": " + required.join(" | ")
    );
    return true;
  } catch (error) {
    console.log(
      "Table header repair skipped for " +
      sheet.getName() + ": " + error.message
    );
    return false;
  }
}

/**
 * One-time/manual repair for all managed sheets.
 * Run this after replacing Code.gs if an existing Google Sheets Table still
 * displays Column 1, Column 2, etc.
 */
function repairAllManagedTableHeaders() {
  const repaired = [];

  const master = getMasterSpreadsheet_();
  const masterSheet = master.getSheetByName(CONFIG.SHEET_NAME);
  if (masterSheet && updateManagedTableHeaders_(masterSheet)) {
    repaired.push(master.getName() + " / " + masterSheet.getName());
  }

  const config = master.getSheetByName(COUNSELOR_CONFIG.LIST_SHEET_NAME);
  if (config) {
    const headers = COUNSELOR_CONFIG.LIST_HEADERS.slice();
    let rows = [];
    try {
      if (config.getLastRow() > 1) {
        rows = config.getRange(2, 1, config.getLastRow() - 1, headers.length).getDisplayValues();
      }
    } catch (error) {
      console.log("Counselor registry read skipped: " + error.message);
    }

    rows.forEach(function(row) {
      const counselorName = value(row[0]);
      const spreadsheetId = value(row[1]);
      if (!counselorName || !spreadsheetId) return;

      try {
        const ss = SpreadsheetApp.openById(spreadsheetId);
        const leadSheet = findCounselorLeadSheet_(ss, counselorName, false);
        if (leadSheet && updateManagedTableHeaders_(leadSheet)) {
          repaired.push(ss.getName() + " / " + leadSheet.getName());
        }
      } catch (error) {
        console.log(
          "Counselor table header repair skipped for " + counselorName +
          ": " + error.message
        );
      }
    });
  }

  Logger.log(
    repaired.length
      ? "Repaired table headers: " + repaired.join(", ")
      : "No table headers required repair."
  );

  return repaired;
}

function ensureHeaders(sheet) {
  // Repair native Google Sheets Table metadata first; this is safe for typed columns.
  updateManagedTableHeaders_(sheet);

  const required = CONFIG.HEADERS.slice();
  const lastColumn = sheet.getLastColumn();

  if (lastColumn === 0) {
    sheet.getRange(1, 1, 1, required.length).setValues([required]);
    formatHeader(sheet);
    return;
  }

  let headers = getHeaders(sheet);

  if (!headers.some(Boolean)) {
    sheet.getRange(1, 1, 1, required.length).setValues([required]);
    formatHeader(sheet);
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
}

function getHeaders(sheet) {
  if (!sheet) return [];

  const sheetName = sheet.getName();

  /*
   * Managed CRM sheets can use Google Sheets typed columns.
   * Reading row 1 with getDisplayValues() can throw:
   * "This operation is not allowed on cells in typed columns."
   *
   * Master Sheet1 and every counselor Leads sheet are controlled by
   * this script, so their canonical physical column order is defined
   * centrally in CONFIG. The actual Master order is:
   *
   * Timestamp, Name, Phone, Email, College, Department, Year, Domain,
   * State, Communication Language, Start Availability, Application Reason,
   * Call Status, Remarks, Application ID, Next Follow-up, Assigned To
   */
  if (sheetName === CONFIG.SHEET_NAME) {
    return CONFIG.HEADERS.slice();
  }

  if (
    typeof COUNSELOR_CONFIG !== "undefined" &&
    sheetName === COUNSELOR_CONFIG.LIST_SHEET_NAME
  ) {
    return COUNSELOR_CONFIG.LIST_HEADERS.slice();
  }

  if (
    typeof COUNSELOR_CONFIG !== "undefined" &&
    (
      sheetName.endsWith(COUNSELOR_CONFIG.LEADS_SHEET_SUFFIX) ||
      sheetName === "LeadsTable" ||
      sheetName === "LeadApplications"
    )
  ) {
    return COUNSELOR_CONFIG.LEADS_HEADERS.slice();
  }

  const cols = sheet.getLastColumn();
  if (!cols || cols < 1) return [];

  try {
    return sheet
      .getRange(1, 1, 1, cols)
      .getDisplayValues()[0]
      .map(function(header) {
        return String(header || "").trim();
      });
  } catch (error) {
    console.log(
      "getHeaders skipped for " +
      sheet.getName() +
      ": " +
      error.message
    );
    return [];
  }
}

function findApplicationId(sheet, headers, id) {
  const col = headers.findIndex(h => ["applicationid","id"].includes(normalizeHeader(h)))+1;
  if (!col || sheet.getLastRow()<2) return 0;
  const values = sheet.getRange(2,col,sheet.getLastRow()-1,1).getDisplayValues();
  for (let i=0;i<values.length;i++) if (String(values[i][0]).trim()===String(id).trim()) return i+2;
  return 0;
}

function getExistingApplicationIds(sheet, headers) {
  const result={}; const col=headers.findIndex(h=>["applicationid","id"].includes(normalizeHeader(h)))+1;
  if (!col || sheet.getLastRow()<2) return result;
  sheet.getRange(2,col,sheet.getLastRow()-1,1).getDisplayValues().forEach((r,i)=>{const id=String(r[0]||"").trim();if(id)result[id]=i+2;});
  return result;
}
function standardizeAllCallStatuses() {
  const master = getMasterSpreadsheet_();
  const masterSheet = master.getSheetByName(CONFIG.SHEET_NAME);

  let masterChanged = 0;
  let counselorSheets = 0;
  let counselorChanged = 0;
  let firebaseSynced = 0;
  let errors = [];

  // ==========================================================
  // 1. STANDARDIZE MASTER SHEET
  // ==========================================================

  if (masterSheet) {

    const headers = getHeaders(masterSheet);

    const statusCol =
      headers.findIndex(
        h => normalizeHeader(h) === "callstatus"
      ) + 1;

    if (statusCol && masterSheet.getLastRow() >= 2) {

      const range = masterSheet.getRange(
        2,
        statusCol,
        masterSheet.getLastRow() - 1,
        1
      );

      const values = range.getValues();

      values.forEach(row => {

        const before = value(row[0]);

        const after =
          standardizeCallStatus_(before);

        if (before !== after) {

          row[0] = after;
          masterChanged++;

        }

      });

      range.setValues(values);
    }

    // Apply canonical dropdown
    ensureCallStatusDropdown_(masterSheet);
  }


  // ==========================================================
  // 2. STANDARDIZE ALL COUNSELOR SPREADSHEETS
  // ==========================================================

  const counselors = getCounselors();

  counselors.forEach(counselor => {

    const counselorName =
      value(counselor.name);

    const spreadsheetId =
      value(counselor.spreadsheetId);

    const active =
      counselor.active !== false &&
      String(counselor.active).toLowerCase() !== "false";


    if (!active || !spreadsheetId) {
      return;
    }


    try {

      const ss =
        SpreadsheetApp.openById(
          spreadsheetId
        );

      const sheetName =
        counselorLeadsSheetName(
          counselorName
        );

      const sheet =
        ss.getSheetByName(sheetName);


      if (!sheet) {

        errors.push(
          counselorName +
          ": Lead sheet not found (" +
          sheetName +
          ")"
        );

        return;
      }


      counselorSheets++;


      // --------------------------------------------------------
      // Apply canonical dropdown
      // --------------------------------------------------------

      ensureCallStatusDropdown_(sheet);


      const headers =
        getHeaders(sheet);

      const statusCol =
        headers.findIndex(
          h => normalizeHeader(h) === "callstatus"
        ) + 1;


      if (!statusCol || sheet.getLastRow() < 2) {
        return;
      }


      // --------------------------------------------------------
      // Convert legacy status values
      // --------------------------------------------------------

      const range =
        sheet.getRange(
          2,
          statusCol,
          sheet.getLastRow() - 1,
          1
        );


      const values =
        range.getValues();


      const changedRows = [];


      values.forEach((row, index) => {

        const before =
          value(row[0]);

        const after =
          standardizeCallStatus_(
            before
          );


        if (before !== after) {

          row[0] = after;

          counselorChanged++;

          changedRows.push(
            index + 2
          );

        }

      });


      if (changedRows.length > 0) {

        range.setValues(values);

        SpreadsheetApp.flush();


        // ------------------------------------------------------
        // Sync changed counselor rows to Firebase + Master
        // ------------------------------------------------------

        changedRows.forEach(rowNumber => {

          try {

            const result =
              syncCounselorRowToFirebase(
                sheet,
                rowNumber
              );


            if (
              result &&
              result.status === "success"
            ) {
              firebaseSynced++;
            }

          } catch (syncError) {

            errors.push(
              counselorName +
              " row " +
              rowNumber +
              ": " +
              syncError.message
            );

          }

        });

      }

    } catch (error) {

      errors.push(
        counselorName +
        ": " +
        error.message
      );

    }

  });


  // ==========================================================
  // 3. FINAL RESULT
  // ==========================================================

  SpreadsheetApp.flush();


  const result = {
    status: "success",

    masterChanged:
      masterChanged,

    counselorSheets:
      counselorSheets,

    counselorChanged:
      counselorChanged,

    firebaseSynced:
      firebaseSynced,

    errors:
      errors
  };


  console.log(
    "Call Status standardization completed:",
    JSON.stringify(result)
  );


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
function formatHeader(sheet) {
  // Intentionally disabled. Header formatting is optional and can fail on
  // Google Sheets typed columns (notably the Counselors registry).
  // CRM synchronization does not depend on header formatting.
  return;
}
function jsonResponse(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
