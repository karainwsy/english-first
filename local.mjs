const open = new Promise((resolve,reject) => {
  const req = indexedDB.open("english-first-media", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("media");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
export async function localGet(key) {
  const db = await open;
  return new Promise((resolve,reject) => {
    const req = db.transaction("media").objectStore("media").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function localSet(key,value) {
  const db = await open;
  return new Promise((resolve,reject) => {
    const t = db.transaction("media","readwrite"), s = t.objectStore("media");
    value == null ? s.delete(key) : s.put(value,key);
    t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
}
