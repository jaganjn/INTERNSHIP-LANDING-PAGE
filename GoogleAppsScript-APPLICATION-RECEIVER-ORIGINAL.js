/************************************************************
 * INTERNSFORGE 2026
 * GOOGLE SHEETS APPLICATION RECEIVER
 *
 * WEBSITE → APPS SCRIPT → GOOGLE SHEETS
 *
 * FINAL VERSION
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
    "Application Reason"
  ]
};


/**
 * ==========================================================
 * POST RECEIVER
 * ==========================================================
 */
function doPost(e) {

  try {

    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({
        status: "error",
        message: "No application data received."
      });
    }

    const data = JSON.parse(e.postData.contents);

    const sheet = getSheet();

    const timestamp = Utilities.formatDate(
      new Date(),
      CONFIG.TIMEZONE,
      "dd-MM-yyyy HH:mm:ss"
    );


    /*
     * Read values from website.
     *
     * communicationLanguage is the current website field.
     * language is accepted as a fallback.
     */
    const application = {

      "Timestamp": timestamp,

      "Name": value(
        data.name
      ),

      "Phone": value(
        data.phone
      ),

      "Email": value(
        data.email
      ),

      "College": value(
        data.college
      ),

      "Department": value(
        data.department
      ),

      "Year": value(
        data.year
      ),

      "Domain": value(
        data.domain
      ),

      "State": value(
        data.state
      ),

      "Communication Language": value(
        data.communicationLanguage ||
        data.language
      ),

      "Start Availability": value(
        data.startAvailability
      ),

      "Application Reason": value(
        data.applicationReason
      )

    };


    /*
     * Required fields
     */
    const requiredFields = [
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
      "Application Reason"
    ];


    for (let i = 0; i < requiredFields.length; i++) {

      const field = requiredFields[i];

      if (!application[field]) {

        return jsonResponse({
          status: "error",
          message: field + " is missing."
        });

      }

    }


    /*
     * Make sure all required columns exist.
     */
    ensureHeaders(sheet);


    /*
     * Get the current headers.
     */
    const headers = getHeaders(sheet);


    /*
     * Create row according to header names.
     *
     * This means the script will still work even if
     * columns have been moved around.
     */
    const row = headers.map(function(header) {

      const normalized = normalizeHeader(header);

      switch (normalized) {

        case "timestamp":
          return application["Timestamp"];

        case "name":
        case "fullname":
          return application["Name"];

        case "phone":
        case "whatsapp":
        case "whatsappnumber":
        case "phonenumber":
          return application["Phone"];

        case "email":
        case "emailaddress":
          return application["Email"];

        case "college":
        case "collegename":
          return application["College"];

        case "department":
        case "branch":
        case "departmentbranch":
          return application["Department"];

        case "year":
        case "currentyear":
          return application["Year"];

        case "domain":
        case "interesteddomain":
        case "preferreddomain":
          return application["Domain"];

        case "state":
        case "stateut":
        case "stateunionterritory":
          return application["State"];

        case "communicationlanguage":
        case "language":
        case "languages":
          return application["Communication Language"];

        case "startavailability":
        case "availability":
        case "whenareyouavailabletostart":
          return application["Start Availability"];

        case "applicationreason":
        case "reason":
        case "whyareyouapplying":
          return application["Application Reason"];

        default:
          return "";

      }

    });


    /*
     * Append application.
     */
    sheet.appendRow(row);


    /*
     * Format timestamp cell.
     */
    const timestampColumn =
      headers.findIndex(function(header) {

        return normalizeHeader(header) === "timestamp";

      }) + 1;


    if (timestampColumn > 0) {

      const lastRow =
        sheet.getLastRow();

      sheet
        .getRange(
          lastRow,
          timestampColumn
        )
        .setNumberFormat("@");

    }


    /*
     * Flush changes immediately.
     */
    SpreadsheetApp.flush();


    /*
     * SUCCESS
     */
    return jsonResponse({

      status: "success",

      message:
        "Application saved successfully.",

      timestamp:
        timestamp

    });


  } catch (error) {

    console.error(
      "APPLICATION ERROR:",
      error
    );

    return jsonResponse({

      status: "error",

      message:
        error.message || String(error)

    });

  }

}


/**
 * ==========================================================
 * GET TEST
 * ==========================================================
 */
function doGet() {

  return jsonResponse({

    status: "online",

    message:
      "InternsForge Google Sheets receiver is working.",

    time:
      Utilities.formatDate(
        new Date(),
        CONFIG.TIMEZONE,
        "dd-MM-yyyy HH:mm:ss"
      )

  });

}


/**
 * ==========================================================
 * GET SHEET
 * ==========================================================
 */
function getSheet() {

  const spreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  let sheet =
    spreadsheet.getSheetByName(
      CONFIG.SHEET_NAME
    );


  if (!sheet) {

    sheet =
      spreadsheet.insertSheet(
        CONFIG.SHEET_NAME
      );

  }


  ensureHeaders(sheet);

  return sheet;

}


/**
 * ==========================================================
 * ENSURE ALL HEADERS EXIST
 * ==========================================================
 */
function ensureHeaders(sheet) {

  let lastColumn =
    sheet.getLastColumn();


  /*
   * Completely empty sheet
   */
  if (lastColumn === 0) {

    sheet
      .getRange(
        1,
        1,
        1,
        CONFIG.HEADERS.length
      )
      .setValues([
        CONFIG.HEADERS
      ]);

    formatHeader(sheet);

    return;

  }


  let headers =
    sheet
      .getRange(
        1,
        1,
        1,
        Math.max(lastColumn, 1)
      )
      .getValues()[0]
      .map(function(header) {

        return String(header).trim();

      });


  /*
   * Completely blank first row
   */
  const hasHeaders =
    headers.some(function(header) {

      return header !== "";

    });


  if (!hasHeaders) {

    sheet
      .getRange(
        1,
        1,
        1,
        CONFIG.HEADERS.length
      )
      .setValues([
        CONFIG.HEADERS
      ]);

    formatHeader(sheet);

    return;

  }


  /*
   * Add missing columns.
   */
  CONFIG.HEADERS.forEach(function(requiredHeader) {

    const exists =
      headers.some(function(existingHeader) {

        return normalizeHeader(existingHeader) ===
          normalizeHeader(requiredHeader);

      });


    if (!exists) {

      const newColumn =
        sheet.getLastColumn() + 1;

      sheet
        .getRange(
          1,
          newColumn
        )
        .setValue(
          requiredHeader
        );

      headers.push(
        requiredHeader
      );

    }

  });


  formatHeader(sheet);

}


/**
 * ==========================================================
 * GET HEADERS
 * ==========================================================
 */
function getHeaders(sheet) {

  const lastColumn =
    sheet.getLastColumn();


  if (lastColumn === 0) {
    return [];
  }


  return sheet
    .getRange(
      1,
      1,
      1,
      lastColumn
    )
    .getValues()[0]
    .map(function(header) {

      return String(header).trim();

    });

}


/**
 * ==========================================================
 * NORMALIZE HEADER
 * ==========================================================
 */
function normalizeHeader(header) {

  return String(header || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

}


/**
 * ==========================================================
 * CLEAN VALUE
 * ==========================================================
 */
function value(input) {

  if (
    input === null ||
    input === undefined
  ) {

    return "";

  }

  return String(input).trim();

}


/**
 * ==========================================================
 * FORMAT HEADER
 * ==========================================================
 */
function formatHeader(sheet) {

  const columns =
    sheet.getLastColumn();


  if (columns < 1) {
    return;
  }


  sheet
    .getRange(
      1,
      1,
      1,
      columns
    )
    .setFontWeight("bold");


  sheet.setFrozenRows(1);

}


/**
 * ==========================================================
 * JSON RESPONSE
 * ==========================================================
 */
function jsonResponse(data) {

  return ContentService

    .createTextOutput(
      JSON.stringify(data)
    )

    .setMimeType(
      ContentService.MimeType.JSON
    );

}