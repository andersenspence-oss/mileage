// Local-first sync queue: entries save to IndexedDB instantly (offline
// OK); this pushes pending entries to Drive + the Sheet whenever the
// phone is online, and retries failures. An entry is only marked synced
// after both its photos and its row are written.
window.Sync = (() => {
  let syncing = false;
  let status = "";
  const listeners = [];

  function onChange(fn) { listeners.push(fn); }
  function setStatus(text) {
    status = text;
    listeners.forEach(fn => fn(status, syncing));
  }
  function getStatus() { return { status, syncing }; }

  async function pendingCount() {
    const entries = await DB.all("entries");
    return entries.filter(e => e.syncState !== "synced").length;
  }

  async function syncNow(interactive) {
    if (syncing) return;
    if (!navigator.onLine) {
      setStatus("Offline — entries are saved and will sync automatically.");
      return;
    }
    if (!GAuth.isConnected()) {
      setStatus("Not connected to Google — open Settings to connect.");
      return;
    }
    syncing = true;
    setStatus("Syncing…");
    try {
      if (interactive) await GAuth.getToken(true);
      const title = await Sheets.firstSheetTitle();
      const map = await Sheets.headerMap(title);
      const entries = (await DB.all("entries"))
        .filter(e => e.syncState !== "synced")
        .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

      let failed = 0;
      for (const entry of entries) {
        try {
          await syncEntry(entry, title, map);
          entry.syncState = "synced";
          entry.lastSyncError = "";
        } catch (e) {
          entry.syncState = "failed";
          entry.lastSyncError = String(e.message || e);
          failed++;
        }
        await DB.put("entries", entry);
      }
      setStatus(failed === 0 ? "All entries synced." : failed + " entr" + (failed === 1 ? "y" : "ies") + " failed — will retry.");
    } catch (e) {
      setStatus("Sync failed: " + (e.message || e));
    } finally {
      syncing = false;
      listeners.forEach(fn => fn(status, syncing));
    }
  }

  async function syncEntry(entry, title, map) {
    const year = (entry.tripDate || "").slice(0, 4) || String(new Date().getFullYear());
    let folderId = null;

    for (const kind of ["begin", "end", "trip", "receipt"]) {
      const photo = await DB.get("photos", entry.entryID + "_" + kind);
      if (!photo || entry.driveIds[kind]) continue;
      if (!folderId) folderId = await Sheets.ensureFolder(year);
      const compressed = await App.compressBlob(photo.blob, 1600, 0.6);
      const label = { begin: "begin-odometer", end: "end-odometer", trip: "tripometer", receipt: "receipt" }[kind];
      const filename = entry.tripDate + "_" + entry.vehicleName.replace(/ /g, "-") + "_" + label + "_" + entry.entryID.slice(0, 8) + ".jpg";
      entry.driveIds[kind] = await Sheets.uploadPhoto(compressed, filename, folderId);
      await DB.put("entries", entry);
    }

    const row = buildRow(entry, map);
    const existing = await Sheets.findRow(entry.entryID, map, title);
    if (existing) {
      await Sheets.updateRow(row, existing, title);
    } else {
      await Sheets.appendRow(row, title);
    }
    entry.updatedAt = new Date().toISOString();
  }

  function buildRow(entry, map) {
    const d = App.derived(entry);
    const photo = (kind) => entry.driveIds[kind] ? Sheets.imageCellFormula(entry.driveIds[kind]) : "";
    const num = (v) => (v === null || v === undefined || isNaN(v)) ? "" : v;
    const byHeader = {
      "Date": App.usDate(entry.tripDate),
      "Where": entry.whereText,
      "What": entry.kind === "fuel" && !entry.purpose ? "Fuel purchase" : entry.purpose,
      "Trip miles": num(d.tripMiles),
      "Begin Mileage": num(entry.beginOdometer),
      "End Mileage": num(entry.endOdometer),
      "Using Formula mileage": num(d.formulaMiles),
      "total mileage": entry.voided ? "" : num(d.totalMiles),
      "Notes": entry.notes,
      "Category": entry.category,
      "Who's Phone / Driver": entry.person,
      "Rate per Mile": d.isBusiness ? d.rate : 0,
      "Deduction $": d.deduction ? d.deduction.toFixed(2) : "",
      "Vehicle": entry.vehicleName,
      "Business Purpose": entry.kind === "fuel" && !entry.purpose ? "Fuel purchase" : entry.purpose,
      "Start Location": entry.startLocation,
      "End Location": entry.endLocation,
      "Round Trip": entry.roundTrip ? "Yes" : "",
      "Fuel Total $": num(entry.fuelTotal),
      "Gallons": num(entry.fuelGallons),
      "Price/Gal": num(entry.fuelPricePerGallon),
      "Begin Odometer Photo": photo("begin"),
      "End Odometer Photo": photo("end"),
      "Tripometer Photo": photo("trip"),
      "Receipt Photo": photo("receipt"),
      "Logged At": App.usDateTime(entry.createdAt),
      "Flags": d.flags,
      "Entry ID": entry.entryID,
    };
    const width = Math.max(...Object.values(map)) + 1;
    const row = new Array(width).fill("");
    for (const [header, value] of Object.entries(byHeader)) {
      if (map[header] !== undefined) row[map[header]] = value;
    }
    return row;
  }

  window.addEventListener("online", () => syncNow(false));

  return { syncNow, pendingCount, onChange, getStatus };
})();
