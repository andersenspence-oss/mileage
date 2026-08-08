// Google Sheets + Drive REST calls. Columns are matched by header name
// (row 1), so the sheet can be reordered or extended safely; any missing
// expected headers are appended automatically on first sync.
window.Sheets = (() => {
  const EXPECTED_HEADERS = [
    "Date", "Where", "What", "Trip miles", "Begin Mileage", "End Mileage",
    "Using Formula mileage", "total mileage", "Notes", "Category",
    "Who's Phone / Driver", "Rate per Mile", "Deduction $", "Vehicle",
    "Business Purpose", "Start Location", "End Location", "Round Trip",
    "Fuel Total $", "Gallons", "Price/Gal", "Begin Odometer Photo",
    "End Odometer Photo", "Tripometer Photo", "Receipt Photo",
    "Logged At", "Flags", "Entry ID",
  ];

  async function call(url, options) {
    const token = await GAuth.getToken(false);
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: "Bearer " + token,
        ...(options && options.json ? { "Content-Type": "application/json" } : {}),
        ...(options ? options.headers : {}),
      },
      body: options && options.json ? JSON.stringify(options.json) : options ? options.body : undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error("Google API error " + response.status + ": " + text.slice(0, 300));
    }
    return response.status === 204 ? null : response.json();
  }

  const base = () => "https://sheets.googleapis.com/v4/spreadsheets/" + CONFIG.spreadsheetId;
  const quote = (title) => "'" + title.replace(/'/g, "''") + "'";
  const valuesURL = (range, params) => {
    const p = new URLSearchParams(params || {});
    return base() + "/values/" + encodeURIComponent(range) + (p.toString() ? "?" + p : "");
  };

  function columnLetter(index) {
    let letters = "";
    do {
      letters = String.fromCharCode(65 + (index % 26)) + letters;
      index = Math.floor(index / 26) - 1;
    } while (index >= 0);
    return letters;
  }

  async function firstSheetTitle() {
    const meta = await call(base() + "?fields=sheets.properties.title");
    if (!meta.sheets || !meta.sheets.length) throw new Error("Spreadsheet has no tabs.");
    return meta.sheets[0].properties.title;
  }

  async function headerMap(title) {
    const data = await call(valuesURL(quote(title) + "!1:1"));
    let headers = (data.values && data.values[0]) || [];
    const missing = EXPECTED_HEADERS.filter(h => !headers.includes(h));
    if (missing.length) {
      headers = headers.concat(missing);
      await call(valuesURL(quote(title) + "!1:1", { valueInputOption: "RAW" }), {
        method: "PUT",
        json: { values: [headers] },
      });
    }
    const map = {};
    headers.forEach((name, i) => { map[name.trim()] = i; });
    return map;
  }

  async function appendRow(row, title) {
    await call(valuesURL(quote(title) + "!A1:append", {
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    }), { method: "POST", json: { values: [row] } });
  }

  async function findRow(entryID, map, title) {
    if (map["Entry ID"] === undefined) return null;
    const col = columnLetter(map["Entry ID"]);
    const data = await call(valuesURL(quote(title) + "!" + col + ":" + col));
    const values = data.values || [];
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] === entryID) return i + 1;
    }
    return null;
  }

  async function updateRow(row, rowNumber, title) {
    const last = columnLetter(row.length - 1);
    await call(valuesURL(quote(title) + "!A" + rowNumber + ":" + last + rowNumber, {
      valueInputOption: "USER_ENTERED",
    }), { method: "PUT", json: { values: [row] } });
  }

  // ---- Drive photo backup ----

  async function driveSearch(q) {
    const url = "https://www.googleapis.com/drive/v3/files?fields=files(id)&q=" + encodeURIComponent(q);
    const data = await call(url);
    return data.files && data.files[0] ? data.files[0].id : null;
  }

  async function ensureFolder(year) {
    const rootQ = "name = '" + CONFIG.driveFolderName.replace(/'/g, "\\'") + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    let rootId = await driveSearch(rootQ);
    if (!rootId) {
      const created = await call("https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "POST",
        json: { name: CONFIG.driveFolderName, mimeType: "application/vnd.google-apps.folder" },
      });
      rootId = created.id;
    }
    const yearQ = "name = '" + year + "' and mimeType = 'application/vnd.google-apps.folder' and '" + rootId + "' in parents and trashed = false";
    let yearId = await driveSearch(yearQ);
    if (!yearId) {
      const created = await call("https://www.googleapis.com/drive/v3/files?fields=id", {
        method: "POST",
        json: { name: String(year), mimeType: "application/vnd.google-apps.folder", parents: [rootId] },
      });
      yearId = created.id;
    }
    return yearId;
  }

  async function uploadPhoto(blob, filename, folderId) {
    const boundary = "mileage" + Date.now();
    const meta = JSON.stringify({ name: filename, parents: [folderId] });
    const body = new Blob([
      "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",
      meta,
      "\r\n--" + boundary + "\r\nContent-Type: image/jpeg\r\n\r\n",
      blob,
      "\r\n--" + boundary + "--\r\n",
    ]);
    const uploaded = await call(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      { method: "POST", body, headers: { "Content-Type": "multipart/related; boundary=" + boundary } }
    );
    // Anyone-with-link read access so =IMAGE() renders inside the sheet.
    await call("https://www.googleapis.com/drive/v3/files/" + uploaded.id + "/permissions", {
      method: "POST",
      json: { role: "reader", type: "anyone" },
    });
    return uploaded.id;
  }

  // Image shown inside the cell; the link opens the full-res original.
  function imageCellFormula(fileId) {
    return '=HYPERLINK("https://drive.google.com/file/d/' + fileId + '/view", IMAGE("https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400"))';
  }

  return { EXPECTED_HEADERS, firstSheetTitle, headerMap, appendRow, findRow, updateRow, ensureFolder, uploadPhoto, imageCellFormula };
})();
