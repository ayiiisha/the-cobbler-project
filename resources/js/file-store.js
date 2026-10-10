/* =========================================================
   file-store.js — uploaded files, kept in this browser
   ---------------------------------------------------------
   Projects are saved in localStorage, which only holds a few
   megabytes. Uploaded files (images, PDFs, video…) are too big
   for that, so they live in the browser's IndexedDB instead.
   Project data only stores each file's id and details.

     await FileStore.put(id, file)   save a file
     await FileStore.get(id)         read it back (a Blob, or undefined)
     await FileStore.remove(id)      delete it
     await FileStore.keys()          every file id

   Note: project backups (.json) don't include these files, but
   files shared with collaborators (share.js) do.
   ========================================================= */
(() => {

  /* ---------- Settings ---------- */
  const DB_NAME = "cobbler-files";
  const STORE = "files";


  /* ---------- Open the database (once) ---------- */
  let opening = null;

  function openDB() {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error("this browser can't store files"));
          return;
        }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("file storage is blocked"));
      });
      opening.catch(() => { opening = null; });   // allow another try later
    }
    return opening;
  }


  /* ---------- Run one read or write ---------- */
  async function run(mode, action) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("file storage failed"));
    });
  }


  /* ---------- The FileStore API ---------- */
  window.FileStore = {
    newId:  () => "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    put:    (id, blob) => run("readwrite", store => store.put(blob, id)),
    get:    (id) => run("readonly", store => store.get(id)),
    remove: (id) => run("readwrite", store => store.delete(id)),
    keys:   () => run("readonly", store => store.getAllKeys()),
  };
})();
