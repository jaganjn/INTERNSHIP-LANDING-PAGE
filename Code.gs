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
    "Assigned To", "Last Contacted", "Remarks"
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

  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  if (e.range.getRow() < 2) return;

  // Ignore edits outside the application table.
  if (e.range.getColumn() > sheet.getLastColumn()) return;

  try {
    syncSheetRowToFirebase(e.range.getRow());
  } catch (error) {
    console.error("Sheet → Firebase sync failed:", error);
  }
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
    lastContactedAt: sheetDateToTimestamp(record.lastcontacted),
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
        updateRowByApplicationId(sheet, headers, rowNumber, app);
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
    sheet.getRange(sheet.getLastRow()+1,1,rowsToAdd.length,headers.length).setValues(rowsToAdd);
    SpreadsheetApp.flush();
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
  if (rowNumber > 0) {
    updateRowByApplicationId(sheet, headers, rowNumber, app);
    SpreadsheetApp.flush();
    return {status:"success", updated:true, row:rowNumber, applicationId:id};
  }
  sheet.appendRow(buildRow(headers, app));
  SpreadsheetApp.flush();
  return {status:"success", updated:false, added:true, applicationId:id, row:sheet.getLastRow()};
}

function updateRowByApplicationId(sheet, headers, rowNumber, app) {
  const current = sheet.getRange(rowNumber,1,1,headers.length).getValues()[0];
  const next = current.slice();
  const newRow = buildRow(headers, app);
  headers.forEach((header,i) => {
    // Never erase an existing admin note with an empty Firebase value.
    if (String(newRow[i] ?? "").trim() !== "" || ["Call Status","Next Follow-up","Assigned To","Last Contacted","Remarks"].includes(header)) next[i] = newRow[i] ?? current[i];
  });
  sheet.getRange(rowNumber,1,1,headers.length).setValues([next]);
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
    "Call Status": value(data.callStatus || data["Call Status"]),
    "Next Follow-up": formatRecoveryTimestamp(data.nextFollowUpAt || data.nextFollowUp || data.followUpAt || data["Next Follow-up"], true),
    "Assigned To": value(data.assignedTo || data["Assigned To"]),
    "Last Contacted": formatRecoveryTimestamp(data.lastContactedAt || data.lastContacted || data["Last Contacted"], true),
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
      callstatus:"Call Status", nextfollowup:"Next Follow-up", followup:"Next Follow-up", assignedto:"Assigned To", lastcontacted:"Last Contacted", remarks:"Remarks", remark:"Remarks"
    };
    return map[n] ? (app[map[n]] || "") : "";
  });
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  ensureHeaders(sheet);
  return sheet;
}

function ensureHeaders(sheet) {
  if (sheet.getLastColumn() === 0) {
    sheet.getRange(1,1,1,CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
    formatHeader(sheet); return;
  }
  let headers = getHeaders(sheet);
  if (!headers.some(Boolean)) {
    sheet.getRange(1,1,1,CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
    formatHeader(sheet); return;
  }
  CONFIG.HEADERS.forEach(required => {
    if (!headers.some(existing => normalizeHeader(existing) === normalizeHeader(required))) {
      const col = sheet.getLastColumn()+1;
      sheet.getRange(1,col).setValue(required);
      headers.push(required);
    }
  });
  formatHeader(sheet);
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
    return Utilities.formatDate(new Date(ms),CONFIG.TIMEZONE,"dd-MM-yyyy HH:mm:ss");
  }
  const s=String(raw).trim();
  const m=s.match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if(m)return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]||"00"}`;
  const parsed=new Date(s);
  return isNaN(parsed.getTime()) ? s : Utilities.formatDate(parsed,CONFIG.TIMEZONE,"dd-MM-yyyy HH:mm:ss");
}

function normalizeHeader(header){return String(header||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
function value(input){return input===null||input===undefined?"":String(input).trim();}
function nowString(){return Utilities.formatDate(new Date(),CONFIG.TIMEZONE,"dd-MM-yyyy HH:mm:ss");}
function formatHeader(sheet){const cols=sheet.getLastColumn();if(cols){sheet.getRange(1,1,1,cols).setFontWeight("bold");sheet.setFrozenRows(1);}}
function jsonResponse(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
