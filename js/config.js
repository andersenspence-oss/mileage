// ====================================================================
// EVERYTHING you might ever need to edit lives in this one file.
// After editing on GitHub, both phones pick up the change the next
// time the app is opened (may take one extra open to refresh).
// ====================================================================
window.CONFIG = {

  // Names offered on first launch; written to "Who's Phone / Driver".
  profiles: ["Spence", "Carey"],

  // Business/personal categories. Anything NOT in nonBusinessCategories
  // gets the mileage deduction math.
  categories: [
    "Personal",
    "Running Wild Utah",
    "Whiplash Center of Utah",
    "Family Health and Rehab",
    "PI Warriors",
    "Misc. Business"
  ],
  nonBusinessCategories: ["Personal"],

  // IRS standard business mileage rates, looked up by trip date.
  // Add a row when the IRS announces a new rate. Dollars per mile.
  rates: [
    { start: "2024-01-01", end: "2024-12-31", ratePerMile: 0.67 },
    { start: "2025-01-01", end: "2025-12-31", ratePerMile: 0.70 },
    { start: "2026-01-01", end: "2026-06-30", ratePerMile: 0.725 },
    { start: "2026-07-01", end: "2026-12-31", ratePerMile: 0.76 }
  ],

  // The Google Sheet every entry syncs into (the long ID from its URL).
  spreadsheetId: "1OJe97Zg2fBljQtX23R3E6MU7sVVIHWkPrNW5sYeYdKE",

  // From Google Cloud -> Credentials -> OAuth client (Web application).
  // See README step 2.
  googleClientId: "312332218243-3q5a4710p7t78aj3k1k381g825fv18a0.apps.googleusercontent.com",

  // Google Drive folder where full-resolution photo backups are kept.
  driveFolderName: "Mileage Tracker Photos",

  // Vehicles pre-loaded on first launch (more can be added in Settings).
  seedVehicles: [
    { nickname: "Kia Sorento", makeModel: "Kia Sorento", plate: "" },
    { nickname: "Lexus ES350", makeModel: "Lexus ES350 F Sport", plate: "" }
  ]
};
