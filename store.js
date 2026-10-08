// ============================================================
// 推しメモ帳 - データの保存 (この端末のブラウザの IndexedDB に保存)
//
// 保存場所 (IndexedDB "oshi-memo"):
//   settings  … 登録項目・色の項目・投稿テンプレートなど (キー "main" の 1 件だけ)
//   vtubers   … Vtuber の情報 (名前・色・リンク・誕生日・アイコン・フォルダ名など)
//   images    … 参考画像の情報 (フォルダ・メモ・小さいサムネイル)
//   imageData … 参考画像の本体 (元の画質のまま)
//
// ※ サーバーには何も送りません。データはこの端末のこのブラウザの中だけにあります。
// ============================================================

const DB_NAME = "oshi-memo";
const DB_VERSION = 1;
let dbPromise = null;

// データベースを開く (初回は保存場所を作る)
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("settings");
      db.createObjectStore("vtubers", { keyPath: "id" });
      const images = db.createObjectStore("images", { keyPath: "id" });
      images.createIndex("vtuberId", "vtuberId"); // Vtuber ごとに画像を探せるようにする
      db.createObjectStore("imageData", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// IndexedDB の「リクエスト」を Promise に変える
const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// まとめて書き込む (途中で失敗したら全部取り消される)
async function write(storeNames, fn) {
  const db = await openDb();
  const tx = db.transaction(storeNames, "readwrite");
  const stores = Object.fromEntries(storeNames.map((n) => [n, tx.objectStore(n)]));
  fn(stores);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("保存できませんでした"));
  });
  notifyOtherTabs();
}

async function read(storeName, fn) {
  const db = await openDb();
  return done(fn(db.transaction(storeName).objectStore(storeName)));
}

// ------------------------------------------------------------
// 別のタブで開いているときにも変更を伝える
// ------------------------------------------------------------
const channel = "BroadcastChannel" in window ? new BroadcastChannel("oshi-memo") : null;
function notifyOtherTabs() {
  if (channel) channel.postMessage("changed");
}
export function onOtherTabChange(fn) {
  if (channel) channel.onmessage = fn;
}

// ------------------------------------------------------------
// 設定
// ------------------------------------------------------------
export const getSettings = () => read("settings", (s) => s.get("main"));
export async function saveSettings(patch) {
  const now = (await getSettings()) || {};
  await write(["settings"], ({ settings }) => settings.put({ ...now, ...patch }, "main"));
}

// ------------------------------------------------------------
// Vtuber
// ------------------------------------------------------------
export const listVtubers = () => read("vtubers", (s) => s.getAll());
export const getVtuber = (id) => read("vtubers", (s) => s.get(id));
export const putVtuber = (v) => write(["vtubers"], ({ vtubers }) => vtubers.put(v));

// 一部だけ書き換える (undefined を渡した項目は削除)
export async function updateVtuber(id, patch) {
  const v = await getVtuber(id);
  if (!v) return;
  const next = { ...v, ...patch };
  Object.keys(next).forEach((k) => next[k] === undefined && delete next[k]);
  await putVtuber(next);
}

// Vtuber と、その人の画像をすべて削除
export async function deleteVtuber(id) {
  const ids = (await listImages(id)).map((i) => i.id);
  await write(["vtubers", "images", "imageData"], ({ vtubers, images, imageData }) => {
    vtubers.delete(id);
    ids.forEach((i) => { images.delete(i); imageData.delete(i); });
  });
}

// ------------------------------------------------------------
// 参考画像
// ------------------------------------------------------------
export const listImages = (vtuberId) => read("images", (s) => s.index("vtuberId").getAll(vtuberId));
export const listAllImages = () => read("images", (s) => s.getAll());
export const getImageBlob = async (id) => (await read("imageData", (s) => s.get(id)))?.blob || null;

// 画像を追加 (情報と本体を一緒に保存)
export const addImage = (meta, blob) =>
  write(["images", "imageData"], ({ images, imageData }) => {
    images.put(meta);
    imageData.put({ id: meta.id, blob });
  });

// 画像の情報を一部だけ書き換える (メモ・フォルダ名など)
export async function updateImages(ids, patch) {
  const metas = await Promise.all(ids.map((id) => read("images", (s) => s.get(id))));
  await write(["images"], ({ images }) => metas.filter(Boolean).forEach((m) => images.put({ ...m, ...patch })));
}

export const deleteImages = (ids) =>
  write(["images", "imageData"], ({ images, imageData }) => ids.forEach((i) => { images.delete(i); imageData.delete(i); }));

// ------------------------------------------------------------
// 端末の保存領域
// ------------------------------------------------------------
// ブラウザに「このサイトのデータを勝手に消さないで」とお願いする
export async function requestPersist() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

// 使っている容量 (バイト)。分からないときは null
export async function usage() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { usage, quota };
}
