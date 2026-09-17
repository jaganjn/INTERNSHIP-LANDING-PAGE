/** InternsForge Code.gs — V15.1 complete backend
 * Includes CRM sync, audit trail, abandoned application recovery,
 * direct abandoned-lead assignment, recovery status updates, deletion,
 * and safe Assigned To column migration.
 */
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

  // Counselor lead sheets use the SAME physical column order as Master Sheet1.
  // This prevents Application ID / Name / Phone / etc. from shifting when a
  // lead is routed from the Admin Dashboard.
  LEADS_HEADERS: [
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

function getEditActor_(e, fallback) {
  try {
    if (e && e.user && typeof e.user.getEmail === "function") {
      const email = value(e.user.getEmail());
      if (email) return email;
    }
  } catch (_) {}
  try {
    const active = value(Session.getActiveUser().getEmail());
    if (active) return active;
  } catch (_) {}
  return value(fallback) || "Unknown editor";
}

function sheetOnEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  if (e.range.getRow() < 2) return;

  try {
    const headers = getHeaders(sheet);
    const actor = getEditActor_(e, "Master Sheet");

    // Typed Google Sheets Date time columns must receive real Date objects,
    // not display strings such as "13-09-2026 10:27:31".
    normalizeEditedDateTimeCells_(sheet, e.range, headers);
    SpreadsheetApp.flush();

    const firstRow = Math.max(2, e.range.getRow());
    const lastRow = Math.min(sheet.getLastRow(), firstRow + e.range.getNumRows() - 1);
    const singleCell = e.range.getNumRows() === 1 && e.range.getNumColumns() === 1;
    const editedHeader = singleCell ? (headers[e.range.getColumn() - 1] || "") : "";
    const results = [];

    // A paste/fill can cover many rows. Process every affected Application ID
    // instead of auditing only the first row.
    for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber++) {
      const result = syncSheetRowToFirebase(
        rowNumber,
        "",
        {
          source: "Master Sheet",
          actor: actor,
          editedColumn: editedHeader,
          oldValue: singleCell ? e.oldValue : "",
          newValue: singleCell ? e.value : "",
          isBulk: !singleCell,
          editedRange: e.range.getA1Notation()
        }
      );
      results.push(result);
    }

    console.log("MASTER EDIT → FIREBASE + COUNSELOR:", JSON.stringify(results));
  } catch (error) {
    console.error("Master Sheet synchronization failed:", error);
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


/**
 * Detects lead copy/paste operations in an individual counselor lead sheet.
 *
 * Google Apps Script's edit event does not reliably identify Ctrl+C/Ctrl+V.
 * Instead, this compares the current Application-ID row map with the map
 * captured after the previous counselor-sheet edit. If an existing Application
 * ID gains a new row occurrence, that new row is treated as a copied lead.
 *
 * The copy itself is logged only; the existing Application ID remains the
 * identity of the live lead, so a copy never creates a second Firebase lead.
 */
function auditCounselorLeadCopies_(sheet, actor, counselorName, editedRange) {
  try {
    if (!sheet || !editedRange) return;

    const headers = getHeaders(sheet);
    const idCol = headers.findIndex(h => normalizeHeader(h) === "applicationid") + 1;
    if (!idCol || sheet.getLastRow() < 2) return;

    // Do not wait for a historical baseline. Immediately inspect the edited
    // rows and look for the same Application ID elsewhere in this counselor
    // sheet. This makes a row copy detectable on the FIRST test after deploy.
    const firstEditedRow = Math.max(2, editedRange.getRow());
    const lastEditedRow = Math.min(
      sheet.getLastRow(),
      firstEditedRow + Math.max(1, editedRange.getNumRows()) - 1
    );

    const allIds = sheet
      .getRange(2, idCol, sheet.getLastRow() - 1, 1)
      .getDisplayValues()
      .map(r => value(r[0]).trim());

    const editedRows = [];
    for (let row = firstEditedRow; row <= lastEditedRow; row++) {
      const id = value(allIds[row - 2]).trim();
      if (id) editedRows.push({ row: row, applicationId: id });
    }

    if (!editedRows.length) return;

    const loggedKey = "IF_AUDIT_COPY_EVENT_" + sheet.getParent().getId();
    const props = PropertiesService.getScriptProperties();
    let recent = {};
    try {
      recent = JSON.parse(props.getProperty(loggedKey) || "{}");
    } catch (_) {
      recent = {};
    }

    const now = Date.now();
    // Keep only a short dedupe window so repeated trigger delivery does not
    // create duplicate "Lead copied" records for the same destination row.
    Object.keys(recent).forEach(k => {
      if (now - Number(recent[k] || 0) > 60000) delete recent[k];
    });

    editedRows.forEach(item => {
      const sourceCandidates = [];
      allIds.forEach((id, index) => {
        const row = index + 2;
        if (id === item.applicationId && row !== item.row) {
          sourceCandidates.push(row);
        }
      });

      // An Application ID that already exists on another row is the strongest
      // observable signal that the lead row was duplicated/copied.
      if (!sourceCandidates.length) return;

      const sourceRow = sourceCandidates[0];
      const dedupeId = item.applicationId + "|" + sourceRow + "|" + item.row;
      if (recent[dedupeId]) return;
      recent[dedupeId] = now;

      recordApplicationActivity_(item.applicationId, {
        source: "Counselor Sheet — " + (counselorName || sheet.getName()),
        actor: actor || ((counselorName || "Unknown") + " / counselor account"),
        action: "Lead copied",
        field: "",
        oldValue: "",
        newValue: "",
        summary:
          "Lead copied from row " + sourceRow + " to row " + item.row,
        counselor: counselorName || sheet.getName(),
        fromRow: sourceRow,
        toRow: item.row
      });
    });

    props.setProperty(loggedKey, JSON.stringify(recent));
  } catch (error) {
    // Audit detection must never block normal CRM synchronization.
    console.warn("Counselor lead copy detection failed:", error);
  }
}

function counselorSpreadsheetOnEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (e.range.getRow() < 2) return;

  try {
    const headers = getHeaders(sheet);
    const counselorName = normalizeCounselorName(sheet.getName().replace(/\'s Leads$/i, ""));
    const actor = getEditActor_(e, counselorName);

    // Normalize pasted Date time text before reading/syncing the row.
    normalizeEditedDateTimeCells_(sheet, e.range, headers);
    SpreadsheetApp.flush();

    // Detect a lead copied/duplicated into a new row BEFORE normal row sync.
    // Google Sheets onEdit does not expose a reliable "copy" flag, so we
    // detect newly-created duplicate Application IDs in the counselor lead sheet.
    auditCounselorLeadCopies_(sheet, actor, counselorName, e.range);

    const firstRow = Math.max(2, e.range.getRow());
    const lastRow = Math.min(sheet.getLastRow(), firstRow + e.range.getNumRows() - 1);
    const singleCell = e.range.getNumRows() === 1 && e.range.getNumColumns() === 1;
    const editedHeader = singleCell ? (headers[e.range.getColumn() - 1] || "") : "";
    const results = [];

    // Handles direct edits, multi-cell paste, fill-down, and multi-row paste.
    for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber++) {
      results.push(syncCounselorRowToFirebase(sheet, rowNumber, {
        source: "Counselor Sheet",
        actor: actor,
        editedColumn: editedHeader,
        oldValue: singleCell ? e.oldValue : "",
        newValue: singleCell ? e.value : "",
        isBulk: !singleCell,
        editedRange: e.range.getA1Notation()
      }));
    }

    console.log("COUNSELOR EDIT → FIREBASE + MASTER + DASHBOARD:", JSON.stringify(results));
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

  const liveBefore = getLiveApplication_(applicationId);

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
          const valueToWrite =
            field === "Timestamp" || field === "Next Follow-up"
              ? toSheetDateTimeValue_(incoming, true)
              : (incoming || "");

          master
            .getRange(masterRow, col)
            .setValue(valueToWrite);
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

  auditLiveChanges_(applicationId, liveBefore, app, editMeta);

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

  const liveBefore = getLiveApplication_(applicationId);

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

  auditLiveChanges_(applicationId, liveBefore, app, editMeta);

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

/**
 * Convert a Sheet date/time value into a real JavaScript Date.
 *
 * IMPORTANT:
 * Google Sheets typed Date time columns reject text such as
 * "13-09-2026 10:27:31". The CRM previously built those values as strings,
 * which caused the red "This value does not match the column type date time"
 * warning shown in the Master/typed table.
 *
 * This parser deliberately supports the formats used by InternsForge:
 *   dd-MM-yyyy HH:mm:ss
 *   dd/MM/yyyy HH:mm:ss
 *   dd-MM-yyyy hh:mm:ss AM/PM
 *   yyyy-MM-dd HH:mm:ss
 * plus normal Date/ISO values.
 */
function parseSheetDateTime_(input) {
  if (input === null || input === undefined || input === "") return null;

  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : new Date(input.getTime());
  }

  if (typeof input === "number") {
    // Firebase/Unix milliseconds or seconds.
    const n = Number(input);
    if (!isFinite(n)) return null;
    const ms = Math.abs(n) < 100000000000 ? n * 1000 : n;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  const s = String(input).trim();
  if (!s) return null;

  // dd-MM-yyyy / dd/MM/yyyy with 24-hour time.
  let m = s.match(
    /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6] || 0);
    try {
      const d = Utilities.parseDate(
        String(day).padStart(2, "0") + "-" +
          String(month).padStart(2, "0") + "-" +
          year + " " +
          String(hour).padStart(2, "0") + ":" +
          String(minute).padStart(2, "0") + ":" +
          String(second).padStart(2, "0"),
        CONFIG.TIMEZONE,
        "dd-MM-yyyy HH:mm:ss"
      );
      if (!isNaN(d.getTime())) return d;
    } catch (_) {}
  }

  // dd-MM-yyyy / dd/MM/yyyy with 12-hour AM/PM time.
  m = s.match(
    /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i
  );
  if (m) {
    const text =
      String(Number(m[1])).padStart(2, "0") + "-" +
      String(Number(m[2])).padStart(2, "0") + "-" +
      m[3] + " " +
      String(Number(m[4])).padStart(2, "0") + ":" +
      m[5] + ":" +
      String(Number(m[6] || 0)).padStart(2, "0") + " " +
      m[7].toUpperCase();
    try {
      const d = Utilities.parseDate(
        text,
        CONFIG.TIMEZONE,
        "dd-MM-yyyy hh:mm:ss a"
      );
      if (!isNaN(d.getTime())) return d;
    } catch (_) {}
  }

  // ISO / yyyy-MM-dd and other formats Google may already understand.
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Return a typed Date value for a Google Sheets Date time column.
 * Invalid text is returned as an empty value instead of writing text into
 * a typed Date time column.
 */
function toSheetDateTimeValue_(input, blankIfInvalid) {
  if (input === null || input === undefined || input === "") return "";
  const date = parseSheetDateTime_(input);
  if (date) return date;
  return blankIfInvalid === false ? input : "";
}

function sheetDateToIso(valueFromSheet) {
  const date = parseSheetDateTime_(valueFromSheet);
  return date ? date.toISOString() : "";
}

function sheetDateToTimestamp(valueFromSheet) {
  const date = parseSheetDateTime_(valueFromSheet);
  return date ? date.getTime() : "";
}

/**
 * Repair a Date time cell immediately after a user paste/edit.
 * This is what clears the red typed-column warning for values such as
 * "13-09-2026 10:27:31" by replacing the text with a real Date object.
 */
function normalizeEditedDateTimeCells_(sheet, editedRange, headers) {
  if (!sheet || !editedRange || !headers || !headers.length) return;

  const dateColumns = [];
  headers.forEach(function(header, index) {
    const key = normalizeHeader(header);
    if (key === "timestamp" || key === "nextfollowup") {
      dateColumns.push(index + 1);
    }
  });
  if (!dateColumns.length) return;

  const firstRow = Math.max(2, editedRange.getRow());
  const lastRow = Math.min(
    sheet.getLastRow(),
    firstRow + Math.max(1, editedRange.getNumRows()) - 1
  );
  const editFirstCol = editedRange.getColumn();
  const editLastCol = editFirstCol + editedRange.getNumColumns() - 1;

  dateColumns.forEach(function(col) {
    if (col < editFirstCol || col > editLastCol) return;

    const range = sheet.getRange(firstRow, col, lastRow - firstRow + 1, 1);
    let values;
    try {
      values = range.getDisplayValues();
    } catch (_) {
      return;
    }

    const converted = values.map(function(row) {
      const text = String(row[0] || "").trim();
      if (!text) return [""];
      const parsed = parseSheetDateTime_(text);
      return [parsed || text];
    });

    try {
      range.setValues(converted);
    } catch (error) {
      // Do not break the CRM if a particular typed column is locked by the
      // table configuration. The synchronization can still continue.
      console.warn(
        "Date/time normalization skipped for " + sheet.getName() +
        " column " + col + ": " + error.message
      );
    }
  });
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

function firebaseRestGet_(path) {
  const token = getFirebaseAccessToken_();
  const url = FIREBASE_SYNC_CONFIG.DATABASE_URL + path + ".json?access_token=" + encodeURIComponent(token);
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error("Firebase REST GET failed (" + status + "): " + body);
  }
  if (!body || body === "null") return null;
  return JSON.parse(body);
}

function getLiveApplication_(applicationId) {
  const id = value(applicationId);
  if (!id) return null;
  try {
    return firebaseRestGet_("/submittedApplications/" + encodeURIComponent(id));
  } catch (error) {
    console.warn("Could not read live Firebase application before audit:", error);
    return null;
  }
}

function auditFieldValue_(app, field) {
  if (!app) return "";
  const map = {
    "Name": ["name"],
    "Phone": ["phone"],
    "Email": ["email"],
    "College": ["college"],
    "Department": ["department"],
    "Year": ["year"],
    "Domain": ["domain"],
    "State": ["state"],
    "Communication Language": ["communicationLanguage", "language"],
    "Start Availability": ["startAvailability"],
    "Application Reason": ["applicationReason"],
    "Call Status": ["callStatus"],
    "Next Follow-up": ["nextFollowUpAt", "nextFollowUp"],
    "Assigned To": ["assignedTo"],
    "Remarks": ["remarks"]
  };
  const keys = map[field] || [];
  for (const key of keys) {
    if (app[key] !== undefined && app[key] !== null) return value(app[key]);
  }
  return "";
}

function auditComparableValue_(field, raw) {
  const text = value(raw);
  if (!text) return "";
  if (field === "Next Follow-up") {
    const d = new Date(text);
    if (!isNaN(d.getTime())) return String(d.getTime());
    const m = text.match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return String(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime());
  }
  return text;
}

function auditLiveChanges_(applicationId, liveBefore, appAfter, editMeta) {
  // A missing live record means this is likely a new lead. Do not manufacture
  // a long list of "changes" from blank values; audit the next real edit.
  if (!liveBefore || typeof liveBefore !== "object") return [];

  const fields = [
    "Name", "Phone", "Email", "College", "Department", "Year", "Domain",
    "State", "Communication Language", "Start Availability", "Application Reason",
    "Call Status", "Next Follow-up", "Assigned To", "Remarks"
  ];
  const entries = [];
  const singleCell = !!(editMeta && editMeta.editedColumn);

  fields.forEach(field => {
    const before = auditFieldValue_(liveBefore, field);
    const after = value(appAfter && appAfter[field]);
    if (auditComparableValue_(field, before) === auditComparableValue_(field, after)) return;

    let oldValue = before;
    let newValue = after;
    if (singleCell && field === editMeta.editedColumn) {
      oldValue = value(editMeta.oldValue);
      newValue = value(editMeta.newValue);
      if (auditComparableValue_(field, oldValue) === auditComparableValue_(field, newValue)) return;
    }

    entries.push({
      source: value(editMeta && editMeta.source) || "Google Sheets",
      actor: value(editMeta && editMeta.actor) || "Unknown editor",
      action: editMeta && editMeta.isBulk ? "Bulk update" : "Field updated",
      field: field,
      oldValue: oldValue,
      newValue: newValue,
      summary: editMeta && editMeta.isBulk
        ? field + " updated by paste/fill"
        : field + " changed"
    });
  });

  if (!entries.length && editMeta && editMeta.isBulk) {
    return recordApplicationActivity_(applicationId, {
      source: value(editMeta.source) || "Google Sheets",
      actor: value(editMeta.actor) || "Unknown editor",
      action: "Bulk edit",
      summary: "A paste/fill operation was detected, but it produced no live-data changes."
    });
  }

  return recordApplicationActivityBatch_(applicationId, entries);
}

function firebaseRestDelete(path) {
  const url = FIREBASE_SYNC_CONFIG.DATABASE_URL.replace(/\/$/, "") + path + ".json";
  const token = getFirebaseAccessToken_();
  const options = {method:"delete", muteHttpExceptions:true, headers:{Authorization:"Bearer " + token}};
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error("Firebase DELETE failed (" + code + "): " + response.getContentText());
  return response.getContentText();
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
 * APPLICATION ACTIVITY / AUDIT TRAIL — LIVE-SYNCED V3
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



/**
 * ==========================================================
 * APPLICATION RECOVERY / ABANDONMENT TRACKING
 * ==========================================================
 * Stores incomplete application sessions in a dedicated sheet.
 * The browser sends only a snapshot when a meaningful application
 * is cancelled/left; completed submissions are marked submitted.
 */
const ABANDONED_SHEET_NAME = "Abandoned Applications";
const ABANDONED_HEADERS = [
  "Recorded At", "Draft ID", "Started At", "Last Active", "Name", "Phone",
  "Email", "College", "Department", "Year", "Domain", "State",
  "Communication Language", "Start Availability", "Application Reason",
  "Progress %", "Current Step", "Last Field", "Exit Type", "Exit Reason",
  "Referral", "Device", "Recovery Status", "Application ID", "Assigned To"
];

function ensureAbandonedApplicationsSheet_() {
  const ss = getMasterSpreadsheet_();
  let sheet = ss.getSheetByName(ABANDONED_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(ABANDONED_SHEET_NAME);

  // Canonical 25-column structure. Existing rows are preserved.
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ABANDONED_HEADERS.length).setValues([ABANDONED_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const currentLastColumn = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getRange(1, 1, 1, currentLastColumn).getValues()[0]
    .map(h => String(h || '').trim());

  // Do not destroy an existing Assigned To column if an older version
  // placed it somewhere else. Prefer the canonical column 25.
  const assignedIndex = current.findIndex(h => h.toLowerCase() === 'assigned to');
  if (assignedIndex !== -1 && assignedIndex !== 24) {
    const existingAssignedValues = sheet.getLastRow() >= 2
      ? sheet.getRange(2, assignedIndex + 1, sheet.getLastRow() - 1, 1).getValues()
      : [];
    sheet.getRange(1, 25).setValue('Assigned To');
    if (existingAssignedValues.length) {
      sheet.getRange(2, 25, existingAssignedValues.length, 1).setValues(existingAssignedValues);
    }
  } else {
    sheet.getRange(1, 25).setValue('Assigned To');
  }

  // Repair only the canonical headers. Existing data below the headers is untouched.
  ABANDONED_HEADERS.forEach((header, index) => {
    if (index === 24) return;
    const existing = String(sheet.getRange(1, index + 1).getValue() || '').trim();
    if (existing !== header) sheet.getRange(1, index + 1).setValue(header);
  });

  sheet.setFrozenRows(1);
  return sheet;
}

function setupAbandonedApplicationsSheet() {
  const sheet = ensureAbandonedApplicationsSheet_();
  const sync = syncAbandonedApplicationsSheetToFirebase();
  return {status:"success", sheetName:sheet.getName(), synced:sync.synced, failed:sync.failed, message:"Abandoned Applications sheet is ready and synchronized to Firebase."};
}

/**
 * One-way backfill/synchronization for the Abandoned Applications workspace.
 * Google Sheets remains the durable source; Firebase receives a mirror so the
 * Admin Dashboard can update in real time. This does not modify any other CRM
 * or application-management data.
 */
function syncAbandonedApplicationsSheetToFirebase() {
  const sheet = ensureAbandonedApplicationsSheet_();
  if (sheet.getLastRow() < 2) return {status:"success", synced:0, changed:0, failed:0};

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, ABANDONED_HEADERS.length).getValues();
  let synced = 0;
  let changed = 0;
  let failed = 0;

  // Read the persistent Firebase mirror ONCE. This is Sheet -> Firebase only;
  // Firebase is never allowed to rewrite the Sheet automatically.
  let existing = {};
  try {
    existing = firebaseRestGet_('/abandonedApplications') || {};
  } catch (error) {
    return {status:"error", synced:0, changed:0, failed:rows.length, message:"Unable to read Firebase abandonedApplications: " + (error.message || error)};
  }

  rows.forEach(row => {
    const draftId = normalizeRecoveryText_(row[1], 120);
    if (!draftId) return;
    const recoveryId = draftId.replace(/[.#$\[\]\/]/g, "_");
    const next = {
      draftId: draftId,
      startedAt: normalizeRecoveryText_(row[2], 80),
      lastActive: normalizeRecoveryText_(row[3], 80),
      name: normalizeRecoveryText_(row[4], 120),
      phone: normalizeRecoveryText_(row[5], 40),
      email: normalizeRecoveryText_(row[6], 180),
      college: normalizeRecoveryText_(row[7], 180),
      department: normalizeRecoveryText_(row[8], 120),
      year: normalizeRecoveryText_(row[9], 40),
      domain: normalizeRecoveryText_(row[10], 160),
      state: normalizeRecoveryText_(row[11], 100),
      communicationLanguage: normalizeRecoveryText_(row[12], 80),
      startAvailability: normalizeRecoveryText_(row[13], 100),
      applicationReason: normalizeRecoveryText_(row[14], 600),
      progress: Math.max(0, Math.min(100, Number(row[15]) || 0)),
      currentStep: normalizeRecoveryText_(row[16], 40),
      lastField: normalizeRecoveryText_(row[17], 120),
      exitType: normalizeRecoveryText_(row[18] || "Left Page", 60),
      exitReason: normalizeRecoveryText_(row[19], 240),
      referral: normalizeRecoveryText_(row[20], 120),
      device: normalizeRecoveryText_(row[21], 80),
      recoveryStatus: normalizeRecoveryText_(row[22] || "Needs Follow-up", 60),
      applicationId: normalizeRecoveryText_(row[23], 120),
      assignedTo: normalizeRecoveryText_(row[24], 120)
    };

    try {
      const prev = existing[recoveryId] || {};
      const fields = Object.keys(next);
      const different = fields.some(k => String(prev[k] == null ? '' : prev[k]) !== String(next[k] == null ? '' : next[k]));
      if (different || !existing[recoveryId]) {
        next.updatedAtMs = Date.now();
        firebaseRestPatch("/abandonedApplications/" + recoveryId, next);
        changed++;
      }
      synced++;
    } catch (error) {
      failed++;
      console.warn("Abandoned application Sheet -> Firebase sync failed for " + draftId + ":", error);
    }
  });

  return {status:"success", synced:synced, changed:changed, failed:failed, direction:"sheet_to_firebase"};
}

/**
 * Safe realtime mirror: Google Sheet -> Firebase.
 * This trigger is deliberately one-way. It NEVER writes Firebase data back
 * into the Google Sheet, so it cannot cause repeated/random Sheet updates.
 */
function syncAbandonedSheetToFirebaseTrigger() {
  return syncAbandonedApplicationsSheetToFirebase();
}

/**
 * Install exactly one safe 1-minute Sheet -> Firebase mirror trigger.
 * Legacy Firebase/liveVisitors -> Sheet triggers are removed first.
 */
function repairAndStartAbandonedSync() {
  // One-time repair: deduplicate the Sheet, then mirror the repaired Sheet to
  // Firebase so the Admin Dashboard immediately sees the same records.
  const cleanup = cleanupAbandonedApplicationDuplicates();
  const sync = syncAbandonedApplicationsSheetToFirebase();
  const trigger = createAbandonedSheetToFirebaseTrigger();
  return {
    status: sync.status === 'error' ? 'completed_with_errors' : 'success',
    cleanup: cleanup,
    sync: sync,
    trigger: trigger,
    message: 'Abandoned Applications repaired and safe Sheet -> Firebase sync installed.'
  };
}

function createAbandonedSheetToFirebaseTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    const h = t.getHandlerFunction();
    if (h === 'syncAbandonedApplicationsFirebaseToSheet' ||
        h === 'syncAbandonedSourcesToSheet' ||
        h === 'syncLiveVisitorsToAbandonedApplications' ||
        h === 'syncAbandonedSheetToFirebaseTrigger' ||
        h === 'syncAbandonedApplicationsSheetToFirebase') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('syncAbandonedSheetToFirebaseTrigger').timeBased().everyMinutes(1).create();
  return 'Safe Sheet -> Firebase abandoned mirror installed. Firebase/liveVisitors -> Sheet triggers removed.';
}

/**
 * Firebase -> Google Sheets synchronization for Abandoned Applications.
 *
 * This is intentionally separate from the existing Sheet -> Firebase sync.
 * It makes Firebase-backed abandoned records visible in the Google Sheet even
 * when the student's final browser exit request never reached Apps Script.
 * Existing Recovery Status, Application ID and Assigned To values in the Sheet
 * are preserved when already present.
 */

/**
 * Live Visitors -> Abandoned Applications synchronization.
 *
 * The Admin dashboard recovery table combines the persistent
 * /abandonedApplications record with the latest /liveVisitors snapshot.
 * Therefore a lead can appear in the dashboard even when the final browser
 * save request never created the persistent abandoned record. This function
 * closes that gap by copying incomplete visitor snapshots into both the
 * persistent Firebase abandoned record and the Google Sheet.
 */
function syncLiveVisitorsToAbandonedApplications() {
  // DISABLED BY DESIGN. liveVisitors is volatile browser presence data and must
  // never write/overwrite the Abandoned Applications Sheet.
  return { status: 'success', recordsFound: 0, added: 0, updated: 0, skipped: 0, disabled: true,
    message: 'Live visitor -> Sheet synchronization is disabled.' };
}

function syncAbandonedSourcesToSheet() {
  // DISABLED BY DESIGN: Google Sheets must only change from the Admin Dashboard
  // actions or the original student save operation. Never overwrite Sheet rows
  // from liveVisitors/Firebase on a timer.
  return { status: 'success', added: 0, updated: 0, skipped: 0, disabled: true,
    message: 'Automatic Firebase/Live Visitor -> Sheet sync is disabled. Admin Dashboard changes only update the Sheet.' };
}

function syncAbandonedApplicationsFirebaseToSheet() {
  // DISABLED BY DESIGN. The Abandoned Applications Sheet must never be
  // rewritten from Firebase/liveVisitors. Existing Sheet rows can only be
  // changed by the controlled Admin Dashboard endpoints or the original
  // student recovery-save operation.
  return {
    status: 'success',
    added: 0,
    updated: 0,
    skipped: 0,
    disabled: true,
    message: 'Firebase → Sheet synchronization is disabled. Admin Dashboard changes only update the Sheet.'
  };
}

/**
 * Install a 1-minute trigger so new Firebase abandoned records are copied to
 * the Abandoned Applications sheet automatically. Existing triggers for this
 * handler are removed first to avoid duplicates.
 */
function createAbandonedFirebaseToSheetTrigger() {
  // Backward-compatible function name. The installed trigger is now SAFE:
  // Sheet -> Firebase only. It never rewrites the Abandoned Applications Sheet.
  ScriptApp.getProjectTriggers().forEach(function(t) {
    const h = t.getHandlerFunction();
    if (h === 'syncAbandonedApplicationsFirebaseToSheet' ||
        h === 'syncAbandonedSourcesToSheet' ||
        h === 'syncLiveVisitorsToAbandonedApplications') {
      ScriptApp.deleteTrigger(t);
    }
  });
  return createAbandonedSheetToFirebaseTrigger();
}

function removeAbandonedFirebaseToSheetTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    const handler = trigger.getHandlerFunction();
    if (handler === 'syncAbandonedApplicationsFirebaseToSheet' || handler === 'syncAbandonedSourcesToSheet' || handler === 'syncLiveVisitorsToAbandonedApplications' || handler === 'syncAbandonedSheetToFirebaseTrigger' || handler === 'syncAbandonedApplicationsSheetToFirebase') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  return 'Abandoned Firebase → Sheet triggers removed.';
}
function normalizeRecoveryText_(v, max) {
  const text = String(v == null ? "" : v).trim();
  return max ? text.slice(0, max) : text;
}


function recoveryDateMs_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
  const text = String(value || '').trim();
  if (!text) return 0;
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

/**
 * Remove duplicate abandoned rows using Draft ID as the ONLY identity key.
 * When duplicates exist, the row with the newest Last Active is kept and
 * missing fields are merged from the other duplicate rows. Admin-controlled
 * fields (Recovery Status / Application ID / Assigned To) are preserved.
 */
function cleanupAbandonedApplicationDuplicates() {
  const sheet = ensureAbandonedApplicationsSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (sheet.getLastRow() < 2) return {status:'success', duplicatesRemoved:0, groups:0};
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ABANDONED_HEADERS.length).getValues();
    const groups = {};
    values.forEach(function(row, index) {
      const id = normalizeRecoveryText_(row[1], 120);
      if (!id) return;
      if (!groups[id]) groups[id] = [];
      groups[id].push({rowNumber:index + 2, row:row});
    });

    let duplicatesRemoved = 0;
    const rowsToDelete = [];
    Object.keys(groups).forEach(function(id) {
      const group = groups[id];
      if (group.length < 2) return;
      group.sort(function(a,b) {
        return (recoveryDateMs_(b.row[3]) || recoveryDateMs_(b.row[0]) || b.rowNumber) -
               (recoveryDateMs_(a.row[3]) || recoveryDateMs_(a.row[0]) || a.rowNumber);
      });
      const keeper = group[0];
      const merged = keeper.row.slice();

      // Merge missing student/application fields from duplicate copies.
      for (let col = 0; col < ABANDONED_HEADERS.length; col++) {
        if (col === 22 || col === 23 || col === 24) continue;
        if (String(merged[col] == null ? '' : merged[col]).trim() !== '') continue;
        for (let i = 1; i < group.length; i++) {
          const candidate = group[i].row[col];
          if (String(candidate == null ? '' : candidate).trim() !== '') {
            merged[col] = candidate;
            break;
          }
        }
      }
      // Preserve any admin-controlled value if the newest copy lacks it.
      [22,23,24].forEach(function(col) {
        if (String(merged[col] == null ? '' : merged[col]).trim() !== '') return;
        for (let i = 1; i < group.length; i++) {
          const candidate = group[i].row[col];
          if (String(candidate == null ? '' : candidate).trim() !== '') {
            merged[col] = candidate;
            break;
          }
        }
      });

      sheet.getRange(keeper.rowNumber, 1, 1, ABANDONED_HEADERS.length).setValues([merged]);
      for (let i = 1; i < group.length; i++) rowsToDelete.push(group[i].rowNumber);
    });

    // Delete ALL duplicate rows in descending physical row order so row shifts
    // cannot accidentally delete or preserve the wrong record in another group.
    rowsToDelete.sort(function(a,b){ return b-a; });
    rowsToDelete.forEach(function(rowNumber) {
      sheet.deleteRow(rowNumber);
      duplicatesRemoved++;
    });
    SpreadsheetApp.flush();
    return {status:'success', duplicatesRemoved:duplicatesRemoved, groups:Object.keys(groups).length};
  } finally {
    lock.releaseLock();
  }
}

function saveAbandonedApplication(raw) {
  raw = raw || {};
  const draftId = normalizeRecoveryText_(raw.draftId || raw.visitorId, 120);
  if (!draftId) return jsonResponse({status:"error", message:"Draft ID is required."});

  const sheet = ensureAbandonedApplicationsSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    const values = sheet.getLastRow() > 1
      ? sheet.getRange(2, 1, sheet.getLastRow() - 1, ABANDONED_HEADERS.length).getValues()
      : [];
    let rowNumber = -1;
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][1] || "").trim() === draftId) { rowNumber = i + 2; break; }
    }

    const now = new Date();
    const row = [
      now,
      draftId,
      normalizeRecoveryText_(raw.startedAt, 80),
      normalizeRecoveryText_(raw.lastActive, 80),
      normalizeRecoveryText_(raw.name, 120),
      normalizeRecoveryText_(raw.phone, 40),
      normalizeRecoveryText_(raw.email, 180),
      normalizeRecoveryText_(raw.college, 180),
      normalizeRecoveryText_(raw.department, 120),
      normalizeRecoveryText_(raw.year, 40),
      normalizeRecoveryText_(raw.domain, 160),
      normalizeRecoveryText_(raw.state, 100),
      normalizeRecoveryText_(raw.communicationLanguage, 80),
      normalizeRecoveryText_(raw.startAvailability, 100),
      normalizeRecoveryText_(raw.applicationReason, 600),
      Math.max(0, Math.min(100, Number(raw.progress) || 0)),
      normalizeRecoveryText_(raw.currentStep, 40),
      normalizeRecoveryText_(raw.lastField, 120),
      normalizeRecoveryText_(raw.exitType || "Left Page", 60),
      normalizeRecoveryText_(raw.exitReason, 240),
      normalizeRecoveryText_(raw.referral, 120),
      normalizeRecoveryText_(raw.device, 80),
      normalizeRecoveryText_(raw.recoveryStatus || "Needs Follow-up", 60),
      normalizeRecoveryText_(raw.applicationId, 120),
      normalizeRecoveryText_(raw.assignedTo, 120)
    ];

    if (rowNumber > 0) {
      // Existing row is the durable record. Student recovery snapshots may
      // refresh the student's entered fields, but MUST NEVER overwrite the
      // Admin Dashboard-controlled fields: Recovery Status, Application ID,
      // Assigned To. Dashboard edits use dedicated field-level endpoints.
      const existing = sheet.getRange(rowNumber, 1, 1, ABANDONED_HEADERS.length).getValues()[0];
      const merged = existing.slice();
      merged[0] = existing[0] || now;
      merged[2] = existing[2] || row[2];
      for (let col = 1; col < ABANDONED_HEADERS.length; col++) {
        if (col === 22 || col === 23 || col === 24) continue;
        const incoming = row[col];
        const hasIncoming = incoming instanceof Date ? !isNaN(incoming.getTime()) : String(incoming == null ? '' : incoming).trim() !== '';
        if (hasIncoming) merged[col] = incoming;
      }
      sheet.getRange(rowNumber, 1, 1, ABANDONED_HEADERS.length).setValues([merged]);
    } else {
      sheet.appendRow(row);
      rowNumber = sheet.getLastRow();
    }
    SpreadsheetApp.flush();

    // Keep the Admin Abandoned Applications dashboard synchronized with the
    // same recovery record that is written to Google Sheets.  The browser
    // may be unauthenticated, so do this server-side with the existing
    // Firebase service-account REST helper.
    try {
      const recoveryId = String(draftId).replace(/[.#$\[\]\/]/g, "_");
      firebaseRestPatch("/abandonedApplications/" + recoveryId, {
        draftId: draftId,
        visitorId: normalizeRecoveryText_(raw.visitorId, 120),
        startedAt: normalizeRecoveryText_(raw.startedAt, 80),
        lastActive: normalizeRecoveryText_(raw.lastActive, 80),
        name: normalizeRecoveryText_(raw.name, 120),
        phone: normalizeRecoveryText_(raw.phone, 40),
        email: normalizeRecoveryText_(raw.email, 180),
        college: normalizeRecoveryText_(raw.college, 180),
        department: normalizeRecoveryText_(raw.department, 120),
        year: normalizeRecoveryText_(raw.year, 40),
        domain: normalizeRecoveryText_(raw.domain, 160),
        state: normalizeRecoveryText_(raw.state, 100),
        communicationLanguage: normalizeRecoveryText_(raw.communicationLanguage, 80),
        startAvailability: normalizeRecoveryText_(raw.startAvailability, 100),
        applicationReason: normalizeRecoveryText_(raw.applicationReason, 600),
        progress: Math.max(0, Math.min(100, Number(raw.progress) || 0)),
        currentStep: normalizeRecoveryText_(raw.currentStep, 40),
        lastField: normalizeRecoveryText_(raw.lastField, 120),
        exitType: normalizeRecoveryText_(raw.exitType || "Left Page", 60),
        exitReason: normalizeRecoveryText_(raw.exitReason, 240),
        referral: normalizeRecoveryText_(raw.referral, 120),
        device: normalizeRecoveryText_(raw.device, 80),
        recoveryStatus: normalizeRecoveryText_(raw.recoveryStatus || "Needs Follow-up", 60),
        applicationId: normalizeRecoveryText_(raw.applicationId, 120),
        assignedTo: normalizeRecoveryText_(raw.assignedTo, 120),
        updatedAtMs: Date.now()
      });
    } catch (firebaseError) {
      // The Sheet remains the durable copy; surface the Firebase failure in
      // logs without making a successful Sheet recovery save fail.
      console.warn("Abandoned application Firebase sync failed:", firebaseError);
    }

    return jsonResponse({status:"success", row:rowNumber, draftId:draftId, message:"Application recovery record saved."});
  } finally {
    lock.releaseLock();
  }
}

function deleteAbandonedApplication(raw) {
  raw = raw || {};
  const draftId = normalizeRecoveryText_(raw.draftId || raw.visitorId || "", 120);
  if (!draftId) return jsonResponse({status:"error", message:"Draft ID is required."});

  const result = {status:"success", draftId:draftId, deleted:0, firebaseDeleted:false};
  const sheet = ensureAbandonedApplicationsSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    if (sheet.getLastRow() >= 2) {
      const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ABANDONED_HEADERS.length).getValues();
      for (let i = values.length - 1; i >= 0; i--) {
        if (String(values[i][1] || "").trim() === draftId) {
          sheet.deleteRow(i + 2);
          result.deleted++;
        }
      }
      SpreadsheetApp.flush();
    }

    try {
      const recoveryId = draftId.replace(/[.#$\[\]\/]/g, "_");
      firebaseRestDelete("/abandonedApplications/" + recoveryId);
      result.firebaseDeleted = true;
    } catch (firebaseError) {
      result.status = "completed_with_errors";
      result.firebaseError = firebaseError.message || String(firebaseError);
    }

    result.message = result.deleted || result.firebaseDeleted
      ? "Abandoned application deleted."
      : "Draft ID was not found in the Abandoned Applications sheet.";
    return jsonResponse(result);
  } finally {
    lock.releaseLock();
  }
}


/**
 * ADMIN DASHBOARD -> GOOGLE SHEET / FIREBASE ONLY.
 * This is the controlled path for recovery-status edits.
 */
function updateAbandonedRecoveryStatus(raw) {
  raw = raw || {};
  const draftId = normalizeRecoveryText_(raw.draftId || raw.visitorId || "", 120);
  const recoveryStatus = normalizeRecoveryText_(raw.recoveryStatus || "Needs Follow-up", 80);
  if (!draftId) return jsonResponse({status:"error", message:"Draft ID is required."});
  const allowed = ["Needs Follow-up", "Contacted", "Recovered", "Submitted / Recovered"];
  if (!allowed.includes(recoveryStatus)) return jsonResponse({status:"error", message:"Invalid recovery status."});
  const sheet = ensureAbandonedApplicationsSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    let updated = 0;
    if (sheet.getLastRow() >= 2) {
      const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ABANDONED_HEADERS.length).getValues();
      for (let i = 0; i < values.length; i++) {
        if (String(values[i][1] || "").trim() === draftId) {
          sheet.getRange(i + 2, 23).setValue(recoveryStatus);
          updated = 1;
          break;
        }
      }
    }
    const recoveryId = draftId.replace(/[.#$\[\]\/]/g, "_");
    firebaseRestPatch("/abandonedApplications/" + recoveryId, {recoveryStatus: recoveryStatus, updatedAtMs: Date.now()});
    SpreadsheetApp.flush();
    return jsonResponse({status:"success", updated:updated, draftId:draftId, recoveryStatus:recoveryStatus});
  } finally {
    lock.releaseLock();
  }
}

/**
 * ADMIN DASHBOARD -> GOOGLE SHEET / FIREBASE ONLY.
 * This is the controlled path for counselor-assignment edits.
 */
function updateAbandonedApplicationAssignment(raw) {
  raw = raw || {};
  const draftId = normalizeRecoveryText_(raw.draftId || raw.visitorId || "", 120);
  const assignedTo = normalizeRecoveryText_(raw.assignedTo || "", 120);
  if (!draftId) return jsonResponse({status:"error", message:"Draft ID is required."});

  const sheet = ensureAbandonedApplicationsSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    let updated = 0;
    if (sheet.getLastRow() >= 2) {
      const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ABANDONED_HEADERS.length).getValues();
      for (let i = 0; i < values.length; i++) {
        if (String(values[i][1] || "").trim() === draftId) {
          sheet.getRange(i + 2, 25).setValue(assignedTo);
          updated = 1;
          break;
        }
      }
    }

    const recoveryId = draftId.replace(/[.#$\[\]\/]/g, "_");
    firebaseRestPatch("/abandonedApplications/" + recoveryId, {
      assignedTo: assignedTo,
      updatedAtMs: Date.now()
    });
    SpreadsheetApp.flush();
    return jsonResponse({
      status:"success",
      updated:updated,
      draftId:draftId,
      assignedTo:assignedTo,
      message: updated ? "Abandoned application assignment updated." : "Firebase assignment updated; sheet row was not found."
    });
  } finally {
    lock.releaseLock();
  }
}

function markAbandonedApplicationSubmitted(raw) {
  raw = raw || {};
  const draftId = normalizeRecoveryText_(raw.draftId || "", 120);
  const applicationId = normalizeRecoveryText_(raw.applicationId || "", 120);
  if (!draftId && !applicationId) return jsonResponse({status:"error", message:"Draft ID or Application ID is required."});

  const sheet = ensureAbandonedApplicationsSheet_();
  if (sheet.getLastRow() < 2) return jsonResponse({status:"success", updated:0});
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ABANDONED_HEADERS.length).getValues();
  let updated = 0;
  values.forEach((row, i) => {
    const sameDraft = draftId && String(row[1] || "").trim() === draftId;
    const sameApplication = applicationId && String(row[23] || "").trim() === applicationId;
    if (sameDraft || sameApplication) {
      const rowNumber = i + 2;
      sheet.getRange(rowNumber, 23).setValue("Submitted / Recovered");
      if (applicationId) sheet.getRange(rowNumber, 24).setValue(applicationId);
      updated++;
    }
  });
  SpreadsheetApp.flush();
  return jsonResponse({status:"success", updated:updated});
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return jsonResponse({status:"error", message:"No data received."});
    const data = JSON.parse(e.postData.contents);
    if (data.action === "syncApplications") return jsonResponse(syncApplicationsToSheet(data.applications || [], data.updateExisting === true));
    if (data.action === "updateApplication") return jsonResponse(updateApplicationInSheet(data.application || {}));
    if (data.action === "deleteApplication") return jsonResponse(deleteApplicationFromSheets(data.application || data));
    if (data.action === "saveAbandonedApplication") return saveAbandonedApplication(data);
    if (data.action === "syncAbandonedApplicationsNow") return jsonResponse(syncAbandonedApplicationsSheetToFirebase());
    if (data.action === "updateAbandonedApplicationAssignment") return updateAbandonedApplicationAssignment(data);
    if (data.action === "updateAbandonedRecoveryStatus") return updateAbandonedRecoveryStatus(data);
    if (data.action === "markAbandonedApplicationSubmitted") return markAbandonedApplicationSubmitted(data);
    if (data.action === "deleteAbandonedApplication") return deleteAbandonedApplication(data);
    if (data.action === "cleanupAbandonedApplicationDuplicates") return jsonResponse(cleanupAbandonedApplicationDuplicates());
    if (data.action === "repairAndStartAbandonedSync") return jsonResponse(repairAndStartAbandonedSync());
    if (data.action === "registerCounselor") return jsonResponse(registerCounselor(data.counselorName || data.name || "", data.spreadsheetId || data.sheetId || ""));
    if (data.action === "verifyCounselorLiveSync") return jsonResponse(verifyCounselorLiveSync(data.counselorName || data.name || ""));
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

function doGet(e) {
  try {
    const p = (e && e.parameter) ? e.parameter : {};
    const action = String(p.action || '').trim();

    // Health/default endpoint.
    if (!action) {
      return jsonResponse({
        status:"online",
        message:"InternsForge Google Sheets receiver is working.",
        time:nowString()
      });
    }

    // Abandoned Applications endpoints.
    if (action === "updateAbandonedApplicationAssignment") {
      return updateAbandonedApplicationAssignment(p);
    }
    if (action === "updateAbandonedRecoveryStatus") {
      return updateAbandonedRecoveryStatus(p);
    }
    if (action === "deleteAbandonedApplication") {
      return deleteAbandonedApplication(p);
    }
    if (action === "syncAbandonedApplicationsNow") {
      return jsonResponse(syncAbandonedApplicationsSheetToFirebase());
    }
    if (action === "syncAbandonedApplicationsFirebaseToSheet") {
      return jsonResponse(syncAbandonedApplicationsFirebaseToSheet());
    }
    if (action === "syncAbandonedSourcesToSheet") {
      return jsonResponse(syncAbandonedSourcesToSheet());
    }
    if (action === "repairAndStartAbandonedSync") {
      return jsonResponse(repairAndStartAbandonedSync());
    }
    if (action === "health") {
      return jsonResponse({
        status:"online",
        time:nowString(),
        message:"InternsForge Sheets receiver is healthy."
      });
    }

    return jsonResponse({status:"error", message:"Unknown action: " + action});
  } catch (error) {
    console.error("GET ERROR", error);
    return jsonResponse({status:"error", message:error.message || String(error)});
  }
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
    const existingRowNumber = id && existingIds[id] ? existingIds[id] : 0;
    let existingApp = null;
    if (existingRowNumber) existingApp = rowValuesToApplicationObject(headers, readManagedRow_(sheet, existingRowNumber, headers.length));
    const normalizedRaw = normalizeIncomingAssignmentPayload_(raw, existingApp);
    const app = buildApplicationObject(normalizedRaw, id);
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
  let current = null;
  if (rowNumber > 0) {
    current = rowValuesToApplicationObject(headers, readManagedRow_(sheet, rowNumber, headers.length));
  }
  const normalizedRaw = normalizeIncomingAssignmentPayload_(raw, current);
  const app = buildApplicationObject(normalizedRaw, id);
  app["Call Status"] = standardizeCallStatus_(app["Call Status"]);

  let previousAssignedTo = "";

  if (rowNumber > 0) {
    const currentRow = readManagedRow_(sheet, rowNumber, headers.length);
    previousAssignedTo = getAssignedToFromRow(headers, currentRow);

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
  // V15.17: every counselor created/registered from the dashboard is
  // initialized through the counselor-specific schema, never the generic
  // CRM/abandoned-application schema. This is the permanent guard that
  // prevents Draft ID / Progress / Exit fields from entering counselor leads.
  // V15.21: registration is the permanent server-side activation point.
  // A counselor added from the dashboard must have BOTH the correct sheet
  // schema and an installable onEdit trigger before they can receive leads.
  ensureCounselorLiveSync_(targetSpreadsheetId, counselorName);
  leadsSheet = targetSS.getSheetByName(counselorLeadsSheetName(counselorName)) || leadsSheet;
  leadsSheet.setFrozenRows(1);
  formatHeader(leadsSheet);

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
    initializeCounselorLeadSheet_(sheet, name);
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

function repairAllCounselorLeadColumnOrders() {
  const counselors = getCounselors();
  const results = [];
  counselors.forEach(function(counselor) {
    const name = normalizeCounselorName(counselor.name);
    if (!name || !counselor.spreadsheetId) return;
    try {
      const ss = SpreadsheetApp.openById(counselor.spreadsheetId);
      const sheet = findCounselorLeadSheet_(ss, name, false);
      if (!sheet) {
        results.push({ counselor: name, status: "skipped", reason: "Lead sheet not found" });
        return;
      }
      initializeCounselorLeadSheet_(sheet, name);
      // Table metadata is optional; the physical sheet schema is authoritative.
      updateManagedTableHeaders_(sheet);
      results.push({ counselor: name, status: "success", sheet: sheet.getName() });
    } catch (error) {
      results.push({ counselor: name, status: "error", message: error.message });
    }
  });
  Logger.log(JSON.stringify(results));
  return results;
}

/**
 * V15.21: Explicitly ensure the counselor spreadsheet has the installable
 * onEdit trigger used for Counselor Sheet -> Master -> Firebase sync.
 * This is called during registration, so counselors added from the dashboard
 * are not merely local UI names.
 */
function ensureCounselorLiveSync_(spreadsheetId, counselorName) {
  const id = value(spreadsheetId);
  if (!id) throw new Error("Counselor spreadsheet ID is missing for " + (counselorName || "counselor") + ".");
  const ss = SpreadsheetApp.openById(id);
  const sheet = findCounselorLeadSheet_(ss, counselorName, true);
  initializeCounselorLeadSheet_(sheet, counselorName);
  assertCounselorLeadSchemaForWrite_(sheet, counselorName);
  ensureCallStatusDropdown_(sheet);
  ensureCounselorTrigger(id);
  return { spreadsheetId: id, sheetName: sheet.getName(), trigger: true };
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
function verifyCounselorLiveSync(counselorName) {
  const name = normalizeCounselorName(counselorName);
  if (!name) return { status: "error", message: "Counselor name is required." };
  const record = getCounselorRecord(name);
  if (!record || !record.spreadsheetId) {
    return { status: "error", counselor: name, registered: false, message: "Counselor is not registered in the Counselors sheet." };
  }
  try {
    const sync = ensureCounselorLiveSync_(record.spreadsheetId, name);
    return { status: "success", counselor: name, registered: true, spreadsheetId: record.spreadsheetId, sheetName: sync.sheetName, trigger: true };
  } catch (error) {
    return { status: "error", counselor: name, registered: true, message: error.message || String(error) };
  }
}

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


function readPhysicalHeaderRow_(sheet) {
  if (!sheet || sheet.getLastColumn() < 1) return [];
  try {
    return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(v) {
      return String(v == null ? "" : v).trim();
    });
  } catch (error) {
    // Fallback for typed Google Sheets Tables. The two supported counselor
    // layouts are the current Master-order schema and the legacy V15 schema.
    const width = sheet.getLastColumn();
    if (width === COUNSELOR_CONFIG.LEADS_HEADERS.length) {
      return COUNSELOR_CONFIG.LEADS_HEADERS.slice();
    }
    return [];
  }
}


function isLikelyApplicationId_(v) {
  const s = value(v);
  return !!s && /^-[A-Za-z0-9_\-]+$/.test(s) === false && (s.length >= 6);
}

function getMasterApplicationIndex_() {
  const master = getSheet();
  const headers = getHeaders(master);
  const rows = master.getLastRow() >= 2
    ? master.getRange(2, 1, master.getLastRow() - 1, headers.length).getValues()
    : [];
  const byId = {};
  rows.forEach(function(row, i) {
    const app = rowValuesToApplicationObject(headers, row);
    const id = value(app["Application ID"]);
    if (id) byId[id] = { app: app, row: i + 2 };
  });
  return { headers: headers, byId: byId };
}

function backupCounselorRows_(sheet, values) {
  if (!values || !values.length) return "";
  const ss = sheet.getParent();
  const stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyyMMdd_HHmmss");
  let name = (sheet.getName() + " - Repair Backup " + stamp).slice(0, 95);
  let n = 1;
  while (ss.getSheetByName(name)) name = (sheet.getName() + " - Repair Backup " + stamp + " " + n++).slice(0, 95);
  const backup = ss.insertSheet(name);
  const width = Math.max.apply(null, values.map(function(r){ return r.length; }));
  backup.getRange(1,1,values.length,width).setValues(values.map(function(r){
    const x = r.slice(); while (x.length < width) x.push(""); return x;
  }));
  return name;
}

/**
 * Repair a counselor lead sheet whose rows were previously written with the
 * Abandoned Applications (25-column) layout or another shifted layout.
 * Only an Application ID that can be resolved to Master Sheet1 is trusted.
 * Draft IDs are resolved through the persistent abandonedApplications record
 * when that record contains an Application ID. Unresolvable rows are removed
 * from the live counselor sheet after being copied to a timestamped backup.
 */
function repairCounselorLeadSheetFromMaster_(sheet, counselorName) {
  if (!sheet) return { repaired: 0, removed: 0, backup: "" };
  const masterIndex = getMasterApplicationIndex_();
  const desired = COUNSELOR_CONFIG.LEADS_HEADERS.slice();
  const lastRow = sheet.getLastRow();
  const width = Math.max(sheet.getLastColumn(), desired.length);
  if (lastRow < 2) {
    if (sheet.getMaxColumns() < desired.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), desired.length - sheet.getMaxColumns());
    sheet.getRange(1,1,1,desired.length).setValues([desired]);
    if (sheet.getLastColumn() > desired.length) sheet.deleteColumns(desired.length + 1, sheet.getLastColumn() - desired.length);
    return { repaired: 0, removed: 0, backup: "" };
  }

  const values = sheet.getRange(1,1,lastRow,width).getValues();
  const physicalHeaders = values[0].map(function(v){ return String(v == null ? "" : v).trim(); });
  const headerMap = {};
  physicalHeaders.forEach(function(h,i){ const n=normalizeHeader(h); if(n) headerMap[n]=i; });

  const applicationIdIndex = headerMap["applicationid"];
  const draftIdIndex = headerMap["draftid"];
  const rowsToWrite = [];
  const unresolved = [];
  const seen = {};

  for (let r=1; r<values.length; r++) {
    const row = values[r];
    let applicationId = applicationIdIndex !== undefined ? value(row[applicationIdIndex]) : "";

    // Known abandoned-record positional layout: Application ID is column 24
    // and Draft ID is column 2 (1-based positions in that layout).
    if (!applicationId && row.length >= 24) applicationId = value(row[23]);
    let draftId = draftIdIndex !== undefined ? value(row[draftIdIndex]) : "";
    if (!draftId && row.length >= 2 && /^-[A-Za-z0-9_\-]+$/.test(value(row[1]))) draftId = value(row[1]);

    // If an old row only has Draft ID, resolve it through persistent Firebase.
    if (!applicationId && draftId) {
      try {
        const persistent = firebaseRestGet_('/abandonedApplications/' + encodeURIComponent(draftId));
        if (persistent && typeof persistent === 'object') applicationId = value(persistent.applicationId || persistent["Application ID"]);
      } catch (e) {
        console.warn('Draft ID resolution failed for ' + draftId + ': ' + e.message);
      }
    }

    const masterRecord = applicationId ? masterIndex.byId[applicationId] : null;
    if (!masterRecord) {
      unresolved.push(row);
      continue;
    }

    const assigned = normalizeCounselorName(masterRecord.app["Assigned To"]);
    if (!assigned || (counselorName && assigned.toLowerCase() !== normalizeCounselorName(counselorName).toLowerCase())) {
      unresolved.push(row);
      continue;
    }
    if (seen[applicationId]) continue;
    seen[applicationId] = true;
    rowsToWrite.push(buildRow(desired, masterRecord.app));
  }

  // Include a backup whenever malformed/shifted data was encountered.
  const malformed = values.slice(1).some(function(row){
    return row.length !== desired.length ||
      String(row[1] || '').match(/^-[A-Za-z0-9_\-]+$/) ||
      (applicationIdIndex !== undefined && applicationIdIndex !== 14);
  });
  let backup = "";
  if (malformed || unresolved.length) backup = backupCounselorRows_(sheet, values);

  if (sheet.getMaxColumns() < desired.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), desired.length - sheet.getMaxColumns());
  sheet.clearContents();
  if (sheet.getMaxColumns() > desired.length) sheet.deleteColumns(desired.length + 1, sheet.getMaxColumns() - desired.length);
  sheet.getRange(1,1,1,desired.length).setValues([desired]);
  if (rowsToWrite.length) sheet.getRange(2,1,rowsToWrite.length,desired.length).setValues(rowsToWrite);
  SpreadsheetApp.flush();

  return { repaired: rowsToWrite.length, removed: unresolved.length, backup: backup };
}

/**
 * V15.19 PERMANENT COUNSELOR SHEET INITIALIZER
 * ----------------------------------------------
 * This is the ONLY schema initializer used for counselor lead sheets.
 * It is deliberately independent from CONFIG/ensureHeaders(), because the
 * generic CRM/abandoned workflows have different physical schemas.
 *
 * Every future counselor created from the Admin Dashboard passes through
 * this function before any lead can be routed to the counselor.
 */
function initializeCounselorLeadSheet_(sheet, counselorName) {
  if (!sheet) throw new Error("Counselor lead sheet is missing.");

  const desired = COUNSELOR_CONFIG.LEADS_HEADERS.slice();
  const expectedName = counselorLeadsSheetName(counselorName);

  // If an older generic sheet was selected accidentally, repair it from the
  // authoritative Master rows before allowing new writes.
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow > 1 || lastColumn !== desired.length) {
    ensureCounselorLeadSchema_(sheet);
  }

  // The schema function may intentionally return after repairing existing
  // rows. Re-read the physical dimensions and force the canonical 17-column
  // header if necessary.
  if (sheet.getMaxColumns() < desired.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), desired.length - sheet.getMaxColumns());
  }
  if (sheet.getLastColumn() > desired.length) {
    sheet.deleteColumns(desired.length + 1, sheet.getLastColumn() - desired.length);
  }

  sheet.getRange(1, 1, 1, desired.length).setValues([desired]);

  // Remove any stale rows that still look like the 25-column abandoned
  // payload. For resolvable rows ensureCounselorLeadSchema_ already rebuilt
  // them from Master; unresolved rows are intentionally not retained.
  const width = desired.length;
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues()
    : [];
  const bad = [];
  rows.forEach(function(row, index) {
    if (/^-[A-Za-z0-9_\-]+$/.test(value(row[1]))) bad.push(index + 2);
  });
  bad.sort(function(a,b){ return b-a; }).forEach(function(rowNumber){
    sheet.deleteRow(rowNumber);
  });

  if (expectedName && sheet.getName() !== expectedName) {
    // Do not rename legacy LeadsTable/LeadApplications sheets here; routing
    // intentionally supports those names.
  }

  SpreadsheetApp.flush();
  return sheet;
}

function ensureCounselorLeadSchema_(sheet) {
  if (!sheet) return;
  const desired = COUNSELOR_CONFIG.LEADS_HEADERS.slice();
  const physical = readPhysicalHeaderRow_(sheet);
  const normalizedPhysical = physical.map(normalizeHeader);
  const normalizedDesired = desired.map(normalizeHeader);

  const exact = physical.length === desired.length && normalizedDesired.every(function(name, index) {
    return normalizedPhysical[index] === name;
  });

  // Even when the header looks correct, older versions could have written a
  // 25-column Abandoned Applications row underneath it. Detect that condition
  // and rebuild the sheet from authoritative Master records.
  let hasExtraColumns = sheet.getLastColumn() > desired.length;
  let hasMalformedRows = false;
  if (sheet.getLastRow() > 1) {
    const width = Math.max(sheet.getLastColumn(), desired.length);
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
    hasMalformedRows = rows.some(function(row) {
      return row.length !== desired.length || /^-[A-Za-z0-9_\-]+$/.test(value(row[1]));
    });
  }

  if (exact && !hasExtraColumns && !hasMalformedRows) return;

  // Legacy/shifted/abandoned-layout sheets are repaired by reconstructing each
  // resolvable lead from Master Sheet1. This prevents any stale raw array from
  // ever being carried forward into the counselor sheet.
  if (sheet.getLastRow() > 1 && (!exact || hasExtraColumns || hasMalformedRows)) {
    const repair = repairCounselorLeadSheetFromMaster_(sheet, sheet.getName().replace(/'s Leads$/i, ''));
    console.log('Counselor repair for ' + sheet.getName() + ': ' + JSON.stringify(repair));
    return;
  }

  if (sheet.getMaxColumns() < desired.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), desired.length - sheet.getMaxColumns());
  sheet.getRange(1, 1, 1, desired.length).setValues([desired]);
  if (sheet.getLastColumn() > desired.length) sheet.deleteColumns(desired.length + 1, sheet.getLastColumn() - desired.length);
}

/**
 * V15.19 WRITE BARRIER
 * --------------------
 * A counselor lead sheet must never accept a raw abandoned-application
 * payload. Before EVERY counselor write we verify the physical schema and
 * self-heal any shifted/25-column rows from authoritative Master data.
 */
function assertCounselorLeadSchemaForWrite_(sheet, counselorName) {
  if (!sheet) throw new Error("Counselor lead sheet is missing.");

  const desired = COUNSELOR_CONFIG.LEADS_HEADERS.slice();
  const physical = readPhysicalHeaderRow_(sheet).map(normalizeHeader);
  const exact = physical.length === desired.length && desired.every(function(h, i) {
    return physical[i] === normalizeHeader(h);
  });

  let malformed = !exact || sheet.getLastColumn() > desired.length;

  if (!malformed && sheet.getLastRow() > 1) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, desired.length).getValues();
    malformed = rows.some(function(row) {
      return /^-[A-Za-z0-9_\\-]+$/.test(value(row[1])) ||
        (value(row[1]) && !value(row[14]));
    });
  }

  if (malformed) {
    const repair = repairCounselorLeadSheetFromMaster_(sheet, counselorName || sheet.getName().replace(/'s Leads$/i, ''));
    console.log("V15.18 counselor write-barrier repair: " + JSON.stringify(repair));
  }

  // Hard physical schema enforcement after repair. Never trust table metadata.
  if (sheet.getMaxColumns() < desired.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), desired.length - sheet.getMaxColumns());
  }
  if (sheet.getMaxColumns() > desired.length) {
    sheet.deleteColumns(desired.length + 1, sheet.getMaxColumns() - desired.length);
  }
  sheet.getRange(1, 1, 1, desired.length).setValues([desired]);

  // Final assertion: if a raw Draft ID is still sitting in column B, stop the
  // write rather than allowing another shifted row to be created.
  if (sheet.getLastRow() > 1) {
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, desired.length).getValues();
    const badRow = rows.findIndex(function(row) {
      return /^-[A-Za-z0-9_\\-]+$/.test(value(row[1]));
    });
    if (badRow >= 0) {
      throw new Error("Counselor sheet schema validation failed: Draft ID detected in Name column. No lead was written.");
    }
  }

  return sheet;
}

function syncApplicationToCounselorSheet(app, previousAssignedTo) {
  /*
   * V15.15 AUTHORITATIVE ASSIGNMENT FIX
   * -----------------------------------
   * Never build a counselor lead from a stale Admin/Firebase object.
   * The Master Sheet1 row identified by Application ID is the canonical
   * student record. We read that exact row immediately before routing.
   */
  app = app || {};
  const applicationId = value(app["Application ID"] || app.applicationId || app.id);
  if (!applicationId) {
    return { status: "skipped", reason: "Missing Application ID" };
  }

  const master = getSheet();
  const masterHeaders = getHeaders(master);
  const masterRowNumber = findApplicationId(master, masterHeaders, applicationId);
  if (!masterRowNumber) {
    throw new Error("Application ID " + applicationId + " was not found in Master Sheet1. Counselor assignment was not written.");
  }

  // Canonical record: always read the complete current Master row.
  const masterRow = master.getRange( masterRowNumber, 1, 1, masterHeaders.length ).getValues()[0];
  const canonicalApp = rowValuesToApplicationObject(masterHeaders, masterRow);
  canonicalApp["Application ID"] = applicationId;

  const newAssignedTo = normalizeCounselorName(canonicalApp["Assigned To"] || app["Assigned To"] || "");
  const oldAssignedTo = normalizeCounselorName(previousAssignedTo || "");

  // Make the routing field canonical as well, without altering other student data.
  canonicalApp["Assigned To"] = newAssignedTo;
  canonicalApp["Call Status"] = standardizeCallStatus_(canonicalApp["Call Status"]);

  if (oldAssignedTo && oldAssignedTo.toLowerCase() !== newAssignedTo.toLowerCase()) {
    removeApplicationFromCounselorSpreadsheet(oldAssignedTo, applicationId);
  }

  // Always remove stale copies from all other counselors before writing the
  // authoritative row to the newly selected counselor.
  if (newAssignedTo) {
    const cleanup = removeApplicationFromAllOtherCounselors_(applicationId, newAssignedTo);
    if (cleanup && cleanup.errors && cleanup.errors.length) {
      throw new Error("Could not remove stale counselor copies: " + cleanup.errors.join(" | "));
    }
  } else {
    const cleanup = removeApplicationFromAllCounselorSpreadsheets_(applicationId);
    if (cleanup.errors.length) {
      throw new Error("Lead was unassigned in Master, but counselor cleanup failed: " + cleanup.errors.join(" | "));
    }
    return {
      status: "success",
      applicationId: applicationId,
      assignedTo: "",
      counselor: null,
      counselorCleanup: cleanup,
      source: "Master Sheet1"
    };
  }

  const finalRecord = getCounselorRecord(newAssignedTo);
  if (!finalRecord || !finalRecord.spreadsheetId) {
    throw new Error('Counselor "' + newAssignedTo + '" is not configured. Add the counselor and their Spreadsheet ID in the master Counselors sheet first.');
  }

  const ss = SpreadsheetApp.openById(finalRecord.spreadsheetId);
  const sheet = findCounselorLeadSheet_(ss, newAssignedTo, true);
  if (!sheet) throw new Error("Could not create/find the counselor lead sheet for " + newAssignedTo);

  // V15.18: hard write barrier. The counselor sheet is validated immediately
  // before every assignment, so even a stale/old malformed row cannot cause
  // a new 25-column abandoned payload to be appended.
  assertCounselorLeadSchemaForWrite_(sheet, newAssignedTo);
  const headers = COUNSELOR_CONFIG.LEADS_HEADERS.slice();

  // Build the counselor row ONLY from the canonical Master record.
  // Hard invariant: the counselor name is column 17 (Assigned To), never
  // column 14 (Remarks).
  if (value(canonicalApp["Remarks"]).trim().toLowerCase() === newAssignedTo.trim().toLowerCase()) {
    canonicalApp["Remarks"] = "";
  }
  canonicalApp["Assigned To"] = newAssignedTo;
  const newRow = buildRow(headers, canonicalApp);
  const rowNumber = findApplicationId(sheet, headers, applicationId);

  if (rowNumber > 0) {
    // Existing copy: replace the complete lead with the canonical Master row.
    // This avoids field-by-field mixing of stale dashboard/Firebase data.
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([newRow]);
  } else {
    sheet.appendRow(newRow);
  }

  SpreadsheetApp.flush();
  return {
    status: "success",
    applicationId: applicationId,
    counselor: newAssignedTo,
    sheetName: sheet.getName(),
    row: rowNumber > 0 ? rowNumber : sheet.getLastRow(),
    callStatus: canonicalApp["Call Status"],
    source: "Master Sheet1",
    sourceRow: masterRowNumber
  };
}

/**
 * V15.15 one-time repair for existing counselor sheets.
 * For every Application ID found in a counselor sheet, the Master Sheet1
 * record is authoritative. The lead is corrected in its assigned counselor's
 * sheet; stale copies in other counselor sheets are removed.
 */
function repairAllCounselorLeadRowsFromMaster() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const result = { status: 'success', counselors: 0, repaired: 0, removed: 0, backups: [], errors: [] };
    getCounselors().forEach(function(c) {
      const name = normalizeCounselorName(c.name);
      const id = value(c.spreadsheetId);
      if (!name || !id) return;
      result.counselors++;
      try {
        const ss = SpreadsheetApp.openById(id);
        const sheet = findCounselorLeadSheet_(ss, name, false);
        if (!sheet) return;
        const r = repairCounselorLeadSheetFromMaster_(sheet, name);
        result.repaired += Number(r.repaired || 0);
        result.removed += Number(r.removed || 0);
        if (r.backup) result.backups.push(name + ': ' + r.backup);
      } catch (e) {
        result.errors.push(name + ': ' + (e.message || e));
      }
    });
    if (result.errors.length) result.status = 'completed_with_errors';
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function repairAllCounselorSheetsFromMaster() {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const master = getSheet();
    const masterHeaders = getHeaders(master);
    const masterRows = master.getLastRow() >= 2
      ? master.getRange(2, 1, master.getLastRow() - 1, masterHeaders.length).getValues()
      : [];
    const masterById = {};
    masterRows.forEach((row, i) => {
      const app = rowValuesToApplicationObject(masterHeaders, row);
      const id = value(app["Application ID"]);
      if (id) masterById[id] = { app: app, row: i + 2 };
    });

    const result = { status: "success", masterApplications: Object.keys(masterById).length, repaired: 0, removedStale: 0, skippedUnassigned: 0, errors: [] };
    const counselors = getCounselors();

    counselors.forEach(c => {
      const name = normalizeCounselorName(c.name);
      if (!name || !value(c.spreadsheetId)) return;
      try {
        const ss = SpreadsheetApp.openById(c.spreadsheetId);
        const sheet = findCounselorLeadSheet_(ss, name, false);
        if (!sheet) return;
        ensureCounselorLeadSchema_(sheet);
        ensureHeaders(sheet);
        const headers = getHeaders(sheet);
        const ids = getExistingApplicationIds(sheet, headers);
        Object.keys(ids).forEach(id => {
          const masterRecord = masterById[id];
          if (!masterRecord) {
            // Unknown/stale lead: remove it rather than risk showing mismatched data.
            sheet.deleteRow(ids[id]);
            result.removedStale++;
            return;
          }
          const assigned = normalizeCounselorName(masterRecord.app["Assigned To"]);
          if (!assigned) {
            sheet.deleteRow(ids[id]);
            result.skippedUnassigned++;
            return;
          }
          if (assigned.toLowerCase() !== name.toLowerCase()) {
            sheet.deleteRow(ids[id]);
            result.removedStale++;
          }
        });
      } catch (e) {
        result.errors.push(name + ": " + (e.message || e));
      }
    });

    // Now write the authoritative Master rows to their assigned counselors.
    Object.keys(masterById).forEach(id => {
      const app = masterById[id].app;
      const assigned = normalizeCounselorName(app["Assigned To"]);
      if (!assigned) return;
      try {
        const r = syncApplicationToCounselorSheet(app, "");
        if (r && r.status === "success") result.repaired++;
      } catch (e) {
        result.errors.push(id + ": " + (e.message || e));
      }
    });

    if (result.errors.length) result.status = "completed_with_errors";
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function removeApplicationFromCounselorSpreadsheet(counselorName, applicationId) {
  const record = getCounselorRecord(counselorName);
  if (!record || !record.spreadsheetId) {
    return { status: "skipped", counselor: counselorName || "", deleted: 0, errors: [] };
  }

  const result = {
    status: "success",
    counselor: normalizeCounselorName(counselorName),
    spreadsheetId: record.spreadsheetId,
    deleted: 0,
    errors: []
  };

  try {
    const ss = SpreadsheetApp.openById(record.spreadsheetId);
    const sheet = findCounselorLeadSheet_(ss, counselorName, false);
    if (!sheet) return result;

    const headers = getHeaders(sheet);
    // Remove ALL matching copies, not just the first one.
    let rowNumber = findApplicationId(sheet, headers, applicationId);
    while (rowNumber > 0) {
      sheet.deleteRow(rowNumber);
      result.deleted++;
      rowNumber = findApplicationId(sheet, headers, applicationId);
    }
    SpreadsheetApp.flush();
  } catch (error) {
    result.status = "error";
    result.errors.push(normalizeCounselorName(counselorName) + ": " + (error.message || String(error)));
    console.error("Could not remove application from counselor spreadsheet:", error);
  }

  return result;
}

/**
 * Remove an application from every configured counselor spreadsheet.
 * Used for a true dashboard UNASSIGN so no stale counselor copy survives.
 */
function removeApplicationFromAllCounselorSpreadsheets_(applicationId) {
  const result = {
    status: "success",
    applicationId: applicationId,
    counselorsChecked: 0,
    deleted: 0,
    errors: []
  };

  const counselors = getCounselors();
  counselors.forEach(function(counselor) {
    const name = normalizeCounselorName(counselor.name);
    if (!name || !value(counselor.spreadsheetId)) return;
    result.counselorsChecked++;

    const one = removeApplicationFromCounselorSpreadsheet(name, applicationId);
    result.deleted += Number(one.deleted || 0);
    if (one.errors && one.errors.length) result.errors.push.apply(result.errors, one.errors);
  });

  if (result.errors.length) result.status = "completed_with_errors";
  return result;
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

/**
 * V15.19 ASSIGNMENT/REMARKS FIELD BARRIER
 * ----------------------------------------
 * Dashboard assignment payloads from older clients could occasionally carry
 * the selected counselor in `remarks`, or carry a Draft ID as `name`. Never
 * allow either shape to corrupt the canonical Master/CRM fields.
 */
function looksLikeDraftId_(v) {
  return /^-[A-Za-z0-9_\-]+$/.test(value(v));
}

function isRegisteredCounselorName_(name) {
  const target = normalizeCounselorName(name).toLowerCase();
  if (!target) return false;
  try {
    return getCounselors().some(function(c) {
      return normalizeCounselorName(c.name).toLowerCase() === target && value(c.active).toLowerCase() !== 'no';
    });
  } catch (e) {
    console.warn('Counselor registry lookup failed:', e.message || e);
    return false;
  }
}

function normalizeIncomingAssignmentPayload_(raw, existingApp) {
  const data = Object.assign({}, raw || {});
  const current = existingApp || {};

  // Older abandoned/application payloads can put Draft ID into `name` while
  // the actual student name is available as fullName/studentName.
  if (looksLikeDraftId_(data.name) && !looksLikeDraftId_(data.fullName || data.studentName)) {
    const fallbackName = value(data.fullName || data.studentName || data['Full Name'] || data['Student Name']);
    if (fallbackName) data.name = fallbackName;
  }

  // Hard field rule: counselor names belong ONLY in Assigned To.
  // If an older dashboard payload put the selected counselor in remarks and
  // did not send assignedTo, recover that intent server-side.
  const incomingAssigned = value(data.assignedTo || data.AssignedTo || data['Assigned To']);
  const incomingRemarks = value(data.remarks || data.remark || data.Remarks || data.Remark);
  if (!incomingAssigned && incomingRemarks && isRegisteredCounselorName_(incomingRemarks)) {
    data.assignedTo = incomingRemarks;
    // Preserve a real existing remark instead of replacing it with the
    // counselor name. If there is no existing remark, keep it blank.
    data.remarks = value(current['Remarks']);
  }

  // If Assigned To is supplied explicitly, never let a duplicate counselor
  // name in remarks overwrite a real existing note.
  if (incomingAssigned) {
    if (incomingRemarks && incomingRemarks.toLowerCase() === incomingAssigned.toLowerCase()) {
      data.remarks = value(current['Remarks']);
    }
  }

  return data;
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
    if (!map[n]) return "";

    const field = map[n];
    const raw = app[field];

    // CRITICAL: Timestamp and Next Follow-up belong to typed Date time
    // columns. Never write the formatted string representation into those
    // columns; convert it to a real Date object first.
    if (field === "Timestamp" || field === "Next Follow-up") {
      return toSheetDateTimeValue_(raw, true);
    }

    return raw || "";
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
   * centrally. The actual Master/counselor order is:
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
/**
 * One-time repair for existing red Date time cells.
 *
 * Run this AFTER deploying this version if the sheet already contains text
 * dates such as "13-09-2026 10:27:31". It converts every parseable Timestamp
 * and Next Follow-up value in the Master and counselor lead sheets into real
 * Google Sheets Date values.
 */
function repairAllTypedDateTimeValues() {
  const report = {
    status: "success",
    master: 0,
    counselors: 0,
    errors: []
  };

  function repairSheet_(sheet) {
    if (!sheet || sheet.getLastRow() < 2) return 0;

    const headers = getHeaders(sheet);
    const dateColumns = [];
    headers.forEach(function(header, index) {
      const key = normalizeHeader(header);
      if (key === "timestamp" || key === "nextfollowup") {
        dateColumns.push(index + 1);
      }
    });
    if (!dateColumns.length) return 0;

    let changed = 0;
    const rows = sheet.getLastRow() - 1;

    dateColumns.forEach(function(col) {
      const range = sheet.getRange(2, col, rows, 1);
      const display = range.getDisplayValues();
      const converted = display.map(function(row) {
        const text = String(row[0] || "").trim();
        if (!text) return [""];
        const parsed = parseSheetDateTime_(text);
        if (parsed) {
          changed++;
          return [parsed];
        }
        return [text];
      });

      range.setValues(converted);
    });

    SpreadsheetApp.flush();
    return changed;
  }

  try {
    const master = getMasterSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME);
    report.master = repairSheet_(master);
  } catch (error) {
    report.errors.push("Master: " + error.message);
  }

  try {
    getCounselors().forEach(function(counselor) {
      const name = normalizeCounselorName(counselor.name);
      const spreadsheetId = value(counselor.spreadsheetId);
      if (!name || !spreadsheetId) return;

      try {
        const ss = SpreadsheetApp.openById(spreadsheetId);
        const sheet = findCounselorLeadSheet_(ss, name, false);
        if (!sheet) return;
        report.counselors += repairSheet_(sheet);
      } catch (error) {
        report.errors.push(name + ": " + error.message);
      }
    });
  } catch (error) {
    report.errors.push("Counselors: " + error.message);
  }

  if (report.errors.length) report.status = "completed_with_errors";
  return report;
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
