/************************************************************
 * INTERNSFORGE 2026
 * GOOGLE SHEETS APPLICATION RECEIVER — RELIABLE VERSION
 * WEBSITE → APPS SCRIPT → GOOGLE SHEETS
 *
 * IMPORTANT:
 * 1. Deploy this script as a Web App.
 * 2. Execute as: Me
 * 3. Who has access: Anyone
 * 4. After every code change, create a NEW deployment version.
 ************************************************************/

const CONFIG = {
  SHEET_NAME: 'Sheet1',
  TIMEZONE: 'Asia/Kolkata',
  HEADERS: [
    'Timestamp',
    'Name',
    'Phone',
    'Email',
    'College',
    'Department',
    'Year',
    'Domain',
    'State',
    'Communication Language',
    'Start Availability',
    'Application Reason',
    'Application ID',
    'Interest',
    'Referral Code',
    'Referred By',
    'Referral URL',
    'Submitted At',
    'Submitted At Ms',
    'Source'
  ]
};

function doGet(e) {
  return jsonResponse({
    status: 'online',
    message: 'InternsForge Google Sheets receiver is working.',
    time: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd-MM-yyyy HH:mm:ss')
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: 'error', message: 'No application data received.' });
    }

    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return jsonResponse({ status: 'error', message: 'Invalid JSON received.' });
    }

    const sheet = getSheet();
    ensureHeaders(sheet);
    const headers = getHeaders(sheet);

    const submittedAtMs = data.submittedAtMs || Date.now();
    const timestamp = data.submittedAt || Utilities.formatDate(
      new Date(Number(submittedAtMs)),
      CONFIG.TIMEZONE,
      'dd-MM-yyyy HH:mm:ss'
    );

    // Current landing page sends these core fields. Older/newer versions may
    // send the additional fields, so every field is optional except the core set.
    const application = {
      'Timestamp': value(timestamp),
      'Name': value(data.name || data.fullName),
      'Phone': value(data.phone || data.whatsapp || data.whatsappNumber),
      'Email': value(data.email || data.emailAddress),
      'College': value(data.college || data.collegeName),
      'Department': value(data.department || data.branch),
      'Year': value(data.year || data.currentYear),
      'Domain': value(data.domain || data.interestedDomain || data.preferredDomain),
      'State': value(data.state || data.stateUT),
      'Communication Language': value(data.communicationLanguage || data.language),
      'Start Availability': value(data.startAvailability || data.availability),
      'Application Reason': value(data.applicationReason || data.reason || data.whyAreYouApplying),
      'Application ID': value(data.applicationId || data.id),
      'Interest': value(data.interest),
      'Referral Code': value(data.referralCode),
      'Referred By': value(data.referredBy),
      'Referral URL': value(data.referralUrl),
      'Submitted At': value(data.submittedAt),
      'Submitted At Ms': value(data.submittedAtMs),
      'Source': value(data.source)
    };

    const missing = ['Name', 'Phone', 'Email', 'College', 'Department', 'Year', 'Domain']
      .filter(field => !application[field]);

    if (missing.length) {
      return jsonResponse({
        status: 'error',
        message: 'Required application fields missing: ' + missing.join(', ')
      });
    }

    // Idempotency: retries and Admin Panel syncs must not create duplicates.
    const existingRow = findExistingApplicationRow(sheet, headers, application);
    const row = headers.map(header => valueForHeader(header, application));

    if (existingRow > 1) {
      sheet.getRange(existingRow, 1, 1, headers.length).setValues([row]);
      formatTimestampCell(sheet, headers, existingRow);
      SpreadsheetApp.flush();
      return jsonResponse({
        status: 'success',
        action: 'updated',
        row: existingRow,
        message: 'Application updated in Google Sheets.'
      });
    }

    sheet.appendRow(row);
    const lastRow = sheet.getLastRow();
    formatTimestampCell(sheet, headers, lastRow);
    SpreadsheetApp.flush();

    return jsonResponse({
      status: 'success',
      action: 'inserted',
      row: lastRow,
      message: 'Application saved successfully.'
    });

  } catch (error) {
    console.error('APPLICATION ERROR:', error && error.stack ? error.stack : error);
    return jsonResponse({
      status: 'error',
      message: error && error.message ? error.message : String(error)
    });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
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
    sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
    formatHeader(sheet);
    return;
  }

  let headers = sheet.getRange(1, 1, 1, Math.max(lastColumn, 1)).getValues()[0]
    .map(header => String(header).trim());

  if (!headers.some(header => header !== '')) {
    sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
    formatHeader(sheet);
    return;
  }

  CONFIG.HEADERS.forEach(requiredHeader => {
    const exists = headers.some(existing => normalizeHeader(existing) === normalizeHeader(requiredHeader));
    if (!exists) {
      const newColumn = sheet.getLastColumn() + 1;
      sheet.getRange(1, newColumn).setValue(requiredHeader);
      headers.push(requiredHeader);
    }
  });

  formatHeader(sheet);
}

function getHeaders(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(header => String(header).trim());
}

function findExistingApplicationRow(sheet, headers, application) {
  const idColumn = findHeaderIndex(headers, ['applicationid']);
  const emailColumn = findHeaderIndex(headers, ['email', 'emailaddress']);

  // Primary dedupe key: Firebase push ID.
  if (idColumn > -1 && application['Application ID']) {
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const values = sheet.getRange(2, idColumn + 1, lastRow - 1, 1).getDisplayValues();
      const target = String(application['Application ID']);
      for (let i = 0; i < values.length; i++) {
        if (String(values[i][0]) === target) return i + 2;
      }
    }
  }

  // Fallback for old rows created before Application ID existed.
  if (emailColumn > -1 && application.Email && application['Submitted At']) {
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const width = Math.max(idColumn + 1, emailColumn + 1, headers.length);
      const rows = sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues();
      const emailTarget = String(application.Email).toLowerCase();
      const timeTarget = String(application['Submitted At']);
      for (let i = 0; i < rows.length; i++) {
        const rowEmail = String(rows[i][emailColumn] || '').toLowerCase();
        if (rowEmail === emailTarget && String(rows[i][0] || '') === timeTarget) return i + 2;
      }
    }
  }

  return -1;
}

function findHeaderIndex(headers, normalizedNames) {
  for (let i = 0; i < headers.length; i++) {
    if (normalizedNames.indexOf(normalizeHeader(headers[i])) !== -1) return i;
  }
  return -1;
}

function valueForHeader(header, application) {
  switch (normalizeHeader(header)) {
    case 'timestamp': return application['Timestamp'];
    case 'name':
    case 'fullname': return application['Name'];
    case 'phone':
    case 'whatsapp':
    case 'whatsappnumber':
    case 'phonenumber': return application['Phone'];
    case 'email':
    case 'emailaddress': return application['Email'];
    case 'college':
    case 'collegename': return application['College'];
    case 'department':
    case 'branch':
    case 'departmentbranch': return application['Department'];
    case 'year':
    case 'currentyear': return application['Year'];
    case 'domain':
    case 'interesteddomain':
    case 'preferreddomain': return application['Domain'];
    case 'state':
    case 'stateut':
    case 'stateunionterritory': return application['State'];
    case 'communicationlanguage':
    case 'language':
    case 'languages': return application['Communication Language'];
    case 'startavailability':
    case 'availability':
    case 'whenareyouavailabletostart': return application['Start Availability'];
    case 'applicationreason':
    case 'reason':
    case 'whyareyouapplying': return application['Application Reason'];
    case 'applicationid': return application['Application ID'];
    case 'interest': return application['Interest'];
    case 'referralcode': return application['Referral Code'];
    case 'referredby': return application['Referred By'];
    case 'referralurl': return application['Referral URL'];
    case 'submittedat': return application['Submitted At'];
    case 'submittedatms': return application['Submitted At Ms'];
    case 'source': return application['Source'];
    default: return '';
  }
}

function formatTimestampCell(sheet, headers, row) {
  const timestampColumn = findHeaderIndex(headers, ['timestamp']) + 1;
  if (timestampColumn > 0) sheet.getRange(row, timestampColumn).setNumberFormat('@');
}

function normalizeHeader(header) {
  return String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function value(input) {
  if (input === null || input === undefined) return '';
  return String(input).trim();
}

function formatHeader(sheet) {
  const columns = sheet.getLastColumn();
  if (columns < 1) return;
  sheet.getRange(1, 1, 1, columns).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
