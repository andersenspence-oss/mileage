// IndexedDB wrapper — local-first storage so logging always works offline.
// Stores: entries (the log), photos (image blobs), vehicles, yearRecords.
window.DB = (() => {
  let db = null;

  function open() {
    if (db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("mileage-db", 1);
      request.onupgradeneeded = (e) => {
        const d = e.target.result;
        d.createObjectStore("entries", { keyPath: "entryID" });
        d.createObjectStore("photos", { keyPath: "id" });
        d.createObjectStore("vehicles", { keyPath: "id" });
        d.createObjectStore("yearRecords", { keyPath: "id" });
      };
      request.onsuccess = () => { db = request.result; resolve(); };
      request.onerror = () => reject(request.error);
    });
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function store(name, mode) {
    return db.transaction(name, mode || "readonly").objectStore(name);
  }

  return {
    open,
    put: (name, value) => wrap(store(name, "readwrite").put(value)),
    get: (name, key) => wrap(store(name).get(key)),
    del: (name, key) => wrap(store(name, "readwrite").delete(key)),
    all: (name) => wrap(store(name).getAll()),
  };
})();
