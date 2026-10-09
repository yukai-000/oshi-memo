// ============================================================
// 推しメモ帳 (端末保存版) - 画面の動き
//
// データはすべて、この端末のブラウザ (IndexedDB) に保存します。
// サーバーやログインは使いません。保存の処理は store.js にまとめています。
// ============================================================

import * as store from "./store.js?v=20261008-6"; // ?v= は更新時に変えるバージョン番号

// 初回の色の項目 (これも自由に追加・削除・編集できる)
const DEFAULT_COLOR_FIELDS = [
  { id: "hair", label: "髪の色" },
  { id: "eye", label: "目の色" },
];
// 初回の日付の項目 (デビュー日など。これも自由に追加・削除・編集できる)
const DEFAULT_DATE_FIELDS = [
  { id: "debut", label: "デビュー日" },
];
// 初回ログイン時の登録項目 (あとから画面で自由に追加・削除・編集できる)
const DEFAULT_FIELDS = [
  { id: "name", label: "名前" },
  { id: "furigana", label: "ふりがな" },          // 一覧のあいうえお順・検索に使う
  { id: "office", label: "事務所" },
  { id: "fanmark", label: "ファンマーク" },
  { id: "fanart", label: "ファンアートタグ" },
  { id: "thumbnail", label: "サムネイル" },      // サムネイル用イラストのタグなど
  { id: "voice", label: "ボイス" },
  { id: "egosearch", label: "エゴサーチ" },
];
// 以前の初期項目 (この 4 つのまま使っている人には、新しい項目を自動で足す)
const OLD_DEFAULT_IDS = "name,office,fanmark,fanart";
// 投稿テンプレートの初期値 ({項目名} の部分に登録内容が入る)
const DEFAULT_POST_TEMPLATE = "{ファンアートタグ}";
// 新しい Vtuber に最初から作るフォルダ
const DEFAULT_FOLDER = "通常衣装";
// 何日バックアップしていないと、お知らせを出すか
const BACKUP_REMIND_DAYS = 30;

// アプリ全体の状態
const state = {
  ready: false,      // 読み込みが終わったか
  lastBackupAt: 0,   // 最後にバックアップを書き出した日時 (ミリ秒)
  persisted: false,  // ブラウザに「消さないで」とお願いできたか
  fields: [],        // 登録項目 [{id, label}]
  colorFields: [],   // 色の項目 [{id, label}] (髪の色・目の色など)
  dateFields: [],    // 日付の項目 [{id, label}] (デビュー日・推し始めた日など)
  postTemplate: DEFAULT_POST_TEMPLATE, // X に投稿するときの文章の型
  vtubers: [],       // Vtuber の一覧 [{id, values, folders}]
  images: [],        // 選択中の Vtuber の画像の一覧 [{id, folder, name, thumb, ...}]
  selectedId: null,  // 選択中の Vtuber の ID
  folder: null,      // 選択中のフォルダ名
  editingId: null,   // 編集ダイアログで編集中の Vtuber (null なら新規追加)
};
const thumbUrls = new Map();    // サムネイル画像の表示用 URL (作り直さないよう保存)

// よく使う要素を短く取れるようにする
const $ = (sel) => document.querySelector(sel);

// 新しい ID を作る (英数字 32 文字)
const newId = () => {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  // randomUUID が無い古いブラウザ用: ランダムな 16 バイトを 16 進数にする
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
};

// 選択中の Vtuber を返す
const current = () => state.vtubers.find((v) => v.id === state.selectedId);

// Vtuber の見出し (一番上の項目の値) を返す
function titleOf(v) {
  const first = state.fields[0];
  return (first && v.values[first.id]) || "(名前未設定)";
}

// エラーをまとめて表示する
function fail(e) {
  console.error(e);
  toast("エラー: " + (e.code || e.message));
}

// ===== お知らせ (アップデート後に 1 回だけ表示) =====
// 新しいお知らせは、この一覧の「一番上」に足していく。
// id は前のお知らせより大きい数字にすること (見たかどうかの判定に使う)。
const NEWS = [
  {
    id: 2,
    date: "2026/10/09",
    items: [
      "「デビュー日」などの日付の項目を追加しました。「⚙ 項目・設定」の「日付の項目」で、推し始めた日なども自由に追加できます。記念日の当日は画面の上にお知らせが出ます。",
      "誕生日に「年」も入れられるようになりました (入れなくても大丈夫です)。",
      "推しごとに、項目を非表示にできるようになりました。「編集」で項目名の右の「非表示」を押してください (タグが無い推しなどに)。",
    ],
  },
  {
    id: 1,
    date: "2026/10/09",
    items: [
      "使い方マニュアルの最後に「保存する画像について」「データと通信について」「アプリの変更・公開終了について」の注意点を追加しました。",
    ],
  },
];

// 一番新しいお知らせの番号
function latestNewsId() {
  return Math.max(0, ...NEWS.map((n) => n.id));
}

// まだ見ていないお知らせがあれば表示して、「見た」ことを保存する
function showNews(seenId) {
  const unread = NEWS.filter((n) => n.id > seenId);
  if (!unread.length) return;
  $("#news-body").innerHTML = unread.map((n) =>
    `<h3>${esc(n.date)}</h3><ul class="help-list">${n.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
  ).join("");
  $("#dlg-news").showModal();
  store.saveSettings({ newsSeen: latestNewsId() }).catch(fail);
}

// ------------------------------------------------------------
// 起動・データの読み込み
// ------------------------------------------------------------
async function start() {
  try {
    // 設定 (初めて開いたときは初期の項目を作る)
    let settings = await store.getSettings();
    if (!settings) {
      settings = { fields: DEFAULT_FIELDS, colorFields: DEFAULT_COLOR_FIELDS, dateFields: DEFAULT_DATE_FIELDS, postTemplate: DEFAULT_POST_TEMPLATE, lastBackupAt: 0 };
      await store.saveSettings(settings);
    }
    // 以前の初期項目のまま (自分で項目を変えていない) なら、新しい初期項目に入れ替える
    if (settings.fields && settings.fields.map((f) => f.id).join(",") === OLD_DEFAULT_IDS) {
      settings.fields = DEFAULT_FIELDS;
      await store.saveSettings({ fields: DEFAULT_FIELDS });
    }
    applySettings(settings);
    await loadVtubers();
    state.ready = true;
    $("#loading").hidden = true;
    $("#topbar").hidden = false;
    $("#detail").hidden = false;
    render();
    // 初めて開いたときは「はじめに・注意点」を表示
    // (初めての人にはお知らせは出さず、今あるお知らせは「見た」ことにする)
    if (!settings.introSeen) {
      $("#dlg-help").showModal();
      store.saveSettings({ introSeen: true, newsSeen: latestNewsId() }).catch(fail);
    } else {
      showNews(settings.newsSeen || 0);
    }
    // ブラウザに「このサイトのデータを勝手に消さないで」とお願いする
    state.persisted = await store.requestPersist().catch(() => false);
  } catch (e) {
    $("#loading").textContent = "データを読み込めませんでした。プライベートブラウズ (シークレットモード) では使えないことがあります。";
    console.error(e);
  }
}

function applySettings(settings) {
  state.fields = settings.fields || DEFAULT_FIELDS;
  state.colorFields = settings.colorFields || DEFAULT_COLOR_FIELDS;
  state.dateFields = settings.dateFields || DEFAULT_DATE_FIELDS;
  state.postTemplate = settings.postTemplate ?? DEFAULT_POST_TEMPLATE;
  state.lastBackupAt = settings.lastBackupAt || 0;
}

// Vtuber の一覧を読み直す
async function loadVtubers() {
  state.vtubers = (await store.listVtubers()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const v = current();
  if (state.selectedId && !v) state.selectedId = null; // 選択中の人が消えていたら選択を外す
  // 選択中のフォルダが無くなっていたら最初のフォルダを開く
  if (v && !(v.folders || []).includes(state.folder)) state.folder = (v.folders || [])[0] || null;
}

// 選択中の Vtuber の画像を読み直す
async function loadImages() {
  const id = state.selectedId;
  if (!id) {
    state.images = [];
    return;
  }
  const list = await store.listImages(id);
  // 読み込み中に別の Vtuber に切り替えていたら、古い結果は使わない
  if (state.selectedId !== id) return;
  state.images = list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // 新しく追加した画像が先頭
}

// 何かを保存したあとに呼ぶ: 読み直して描き直す
async function reload() {
  applySettings((await store.getSettings()) || {});
  await loadVtubers();
  await loadImages();
  render();
}

// 別のタブで変更されたときも読み直す
store.onOtherTabChange(() => reload().catch(fail));

// ------------------------------------------------------------
// 通知とコピー
// ------------------------------------------------------------
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1800);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 古いブラウザ向けの予備の方法
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(`「${text}」をコピーしました`);
}

// 値をコピー用のチップに分ける
//  - 改行ごとに 1 つのチップ
//  - 「#タグA #タグB」のように # で始まる言葉が並んでいたら 1 つずつに分ける
function splitValue(value) {
  const parts = [];
  for (const line of value.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const words = t.split(/\s+/);
    if (words.length > 1 && words.every((w) => /^[#＃]/.test(w))) parts.push(...words);
    else parts.push(t);
  }
  return parts;
}

// 「#a1b2c3」の形かどうか
const isHex = (s) => /^#[0-9a-f]{6}$/i.test(s || "");

// HTML に文字を入れるときに記号を無害化する
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ------------------------------------------------------------
// 誕生日
// ------------------------------------------------------------
// 誕生日が登録されているか ({m: 月, d: 日})
// 日付 {y?, m, d} が正しく入っているか (年は無くても OK)
const isDate = (x) => !!x && x.m >= 1 && x.m <= 12 && x.d >= 1 && x.d <= 31 && (x.y == null || (x.y >= 1 && x.y <= 9999));
const hasBirthday = (v) => isDate(v.birthday);

// 指定した年・月の日付を作る (その月に無い日は月末にする。例: うるう年以外の 2/29 → 2/28)
function dateIn(year, month, day) {
  const last = new Date(year, month, 0).getDate(); // その月の最終日
  return new Date(year, month - 1, Math.min(day, last));
}

// 今日の日付 (時刻は 0 時にそろえる)
function todayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// この推しで非表示にしている項目の ID の一覧 (文字・色・日付の項目に共通)
const hiddenOf = (v) => new Set(Array.isArray(v.hidden) ? v.hidden : []);

// 「2021年5月3日」「10月21日」(年が無いとき) の表示
const dateLabel = (x) => (x.y ? `${x.y}年` : "") + `${x.m}月${x.d}日`;

// 次の誕生日まであと何日か、カウントダウン中 (1 か月前から当日まで) か
function birthdayInfo(v) {
  if (!hasBirthday(v)) return null;
  const today = todayDate();
  const { m, d } = v.birthday;
  let next = dateIn(today.getFullYear(), m, d);
  if (next < today) next = dateIn(today.getFullYear() + 1, m, d);
  const days = Math.round((next - today) / 86400000);
  // 1 か月前の日 (例: 3/14 生まれ → 2/14 からカウント開始)
  const start = m === 1 ? dateIn(next.getFullYear() - 1, 12, d) : dateIn(next.getFullYear(), m - 1, d);
  return { days, counting: today >= start, label: dateLabel(v.birthday) };
}

// 日付の項目 (デビュー日など) の情報
//  - isToday: 今日が記念日か
//  - years:   今日で何周年か (年が入っているときだけ)
//  - since:   その日からの経過 (例: 「5年5ヶ月」。年が入っていて、その日を過ぎているときだけ)
function dateInfo(x) {
  if (!isDate(x)) return null;
  const today = todayDate();
  // (年が未来の日付は、まだ記念日ではないので「今日」にしない)
  const isToday = dateIn(today.getFullYear(), x.m, x.d).getTime() === today.getTime() && !(x.y > today.getFullYear());
  let years = null, since = null;
  if (x.y) {
    // 経過した月数 (日にちがまだ来ていない月は数えない)
    const months = (today.getFullYear() - x.y) * 12 + (today.getMonth() + 1 - x.m) - (today.getDate() < x.d && !isToday ? 1 : 0);
    if (months >= 0) {
      const y = Math.floor(months / 12), mo = months % 12;
      since = y && mo ? `${y}年${mo}ヶ月` : y ? `${y}年` : mo ? `${mo}ヶ月` : "1ヶ月未満";
    }
    if (isToday) years = today.getFullYear() - x.y;
  }
  return { isToday, years, since, label: dateLabel(x) };
}

// 当日の表示 (例: 「🎉 今日で2周年！」。年が無い・その年の当日なら「🎉 今日！」)
const annivText = (info) => (info.years > 0 ? `🎉 今日で${info.years}周年！` : "🎉 今日！");

// 今日が記念日の項目の一覧 [{field, info}]
const todaysAnniversaries = (v) =>
  state.dateFields
    .filter((f) => !hiddenOf(v).has(f.id))
    .map((f) => ({ field: f, info: dateInfo((v.dates || {})[f.id]) }))
    .filter((x) => x.info && x.info.isToday);

// 「あと○日」「今日！」の表示
const daysLeftText = (days) => (days === 0 ? "🎉 今日！" : `あと ${days} 日`);

// 画面の一番上に出す「もうすぐ誕生日」のお知らせ
function birthdayBannerHtml() {
  // もうすぐ誕生日の人
  const bdays = state.vtubers
    .map((v) => ({ v, info: birthdayInfo(v) }))
    .filter((x) => x.info && x.info.counting)
    .sort((a, b) => a.info.days - b.info.days);
  // 今日が記念日 (デビュー日など) の人
  const annivs = state.vtubers.flatMap((v) => todaysAnniversaries(v).map((x) => ({ v, ...x })));
  if (!bdays.length && !annivs.length) return "";
  return `
    <section class="bday-banner">
      ${bdays.length ? `
      <h3>🎂 もうすぐ誕生日</h3>
      <ul>${bdays.map(({ v, info }) => `
        <li><button class="bday-item" data-select="${v.id}">
          ${avatarHtml(v, "avatar small")}
          <span class="bday-name">${esc(titleOf(v))}</span>
          <span class="bday-date">${info.label}</span>
          <span class="bday-left ${info.days === 0 ? "today" : ""}">${daysLeftText(info.days)}</span>
        </button></li>`).join("")}
      </ul>` : ""}
      ${annivs.length ? `
      <h3 class="${bdays.length ? "banner-sub" : ""}">🎉 今日は記念日</h3>
      <ul>${annivs.map(({ v, field, info }) => `
        <li><button class="bday-item" data-select="${v.id}">
          ${avatarHtml(v, "avatar small")}
          <span class="bday-name">${esc(titleOf(v))}</span>
          <span class="bday-date">${esc(field.label)}</span>
          <span class="bday-left today">${info.years > 0 ? `${info.years}周年` : "今日！"}</span>
        </button></li>`).join("")}
      </ul>` : ""}
    </section>`;
}

// ------------------------------------------------------------
// ☰ メニュー (Vtuber の一覧)
// ------------------------------------------------------------
// 検索や並べ替えのために文字をそろえる
//  - 全角英数→半角、大文字→小文字
//  - カタカナ→ひらがな (「ミライ」でも「みらい」でも見つかるように)
function normalize(s) {
  return String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// 「ふりがな」の項目を探す (項目名に ふりがな / フリガナ / よみがな / 読み などが入っているもの)
function furiganaField() {
  return state.fields.find((f) => /ふりがな|よみ|読み/.test(normalize(f.label)));
}

// あいうえお順に並べるときの読み (ふりがな → 無ければ見出しの名前)
function readingOf(v) {
  const ff = furiganaField();
  const first = state.fields[0];
  return normalize((ff && v.values[ff.id]) || (first && v.values[first.id]) || "");
}

function renderList() {
  const q = normalize($("#search").value.trim());
  const ul = $("#vtuber-list");
  ul.innerHTML = "";
  const ff = furiganaField();
  // 一覧に小さく出す項目 (見出しとふりがな以外で最初のもの。例: 事務所)
  const sub = state.fields.slice(1).find((f) => f !== ff);
  // あいうえお順に並べる (ひらがな → 英字など → 名前が空 の順)
  const group = (r) => (!r ? 2 : /^[\u3041-\u3096]/.test(r) ? 0 : 1);
  // お気に入り (★) の人は一番上にまとめる
  const list = [...state.vtubers].sort((a, b) => {
    const ra = readingOf(a), rb = readingOf(b);
    return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || group(ra) - group(rb) || ra.localeCompare(rb, "ja");
  });
  for (const v of list) {
    // 検索: どれかの項目 (名前・ふりがな・事務所など) に検索語が含まれていれば表示
    const text = normalize(Object.values(v.values || {}).join(" "));
    if (q && !text.includes(q)) continue;
    const li = document.createElement("li");
    // 左にアイコン、右に ふりがな / 名前 / 事務所
    li.innerHTML =
      avatarHtml(v, "avatar") +
      `<div class="li-text">` +
      (ff && v.values[ff.id] ? `<span class="ruby">${esc(v.values[ff.id])}</span>` : "") +
      `<span class="name">${esc(titleOf(v))}</span>` +
      (sub && v.values[sub.id] ? `<small>${esc(v.values[sub.id])}</small>` : "") +
      `</div>` +
      // 右端の印: 今日が記念日なら 🎉、誕生日のカウントダウン中なら 🎂、お気に入りなら ★
      `<span class="li-marks">${todaysAnniversaries(v).length ? "🎉" : ""}${birthdayInfo(v)?.counting ? "🎂" : ""}${v.favorite ? '<span class="fav-mark">★</span>' : ""}</span>`;
    if (v.id === state.selectedId) li.classList.add("active");
    li.onclick = () => { select(v.id); closeDrawer(); };
    ul.appendChild(li);
  }
  if (!ul.children.length) {
    ul.innerHTML = `<li class="no-hit">${state.vtubers.length ? "見つかりませんでした" : "まだ登録がありません"}</li>`;
  }
}

// メニューを開く・閉じる
function openDrawer() {
  $("#drawer").classList.add("open");
  $("#drawer-backdrop").hidden = false;
  // PC ではすぐ検索できるように入力欄にカーソルを置く (スマホはキーボードが出て邪魔なのでしない)
  if (matchMedia("(hover: hover)").matches) setTimeout(() => $("#search").focus(), 150);
}
function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#drawer-backdrop").hidden = true;
}
$("#btn-menu").onclick = openDrawer;
$("#btn-close-menu").onclick = closeDrawer;
$("#drawer-backdrop").onclick = closeDrawer;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

// ------------------------------------------------------------
// 右側の詳細を描く
// ------------------------------------------------------------
function thumbUrl(img) {
  // サムネイル (Blob) を画像として表示できる URL にする
  if (!thumbUrls.has(img.id)) thumbUrls.set(img.id, URL.createObjectURL(img.thumb));
  return thumbUrls.get(img.id);
}

function renderDetail() {
  const v = current();
  const main = $("#detail");
  if (!v) {
    main.innerHTML = backupNoticeHtml() + birthdayBannerHtml() + `
      <section class="card welcome">
        <p>左上の <b>☰</b> から推しを選んでください。</p>
        <button id="btn-welcome-menu" class="primary">☰ 一覧をひらく</button>
      </section>`;
    $("#btn-welcome-menu").onclick = openDrawer;
    bindBannerEvents();
    return;
  }
  const folders = v.folders || [];

  // 項目ごとの行 (値はチップにして押すとコピー)
  const hidden = hiddenOf(v);
  const rows = state.fields.filter((f) => !hidden.has(f.id)).map((f) => {
    const parts = splitValue(v.values[f.id] || "");
    const chips = parts.length
      ? parts.map((p) => `<button class="chip" data-copy="${esc(p)}" title="押すとコピー">${esc(p)}</button>`).join("")
      : `<span class="none">未登録</span>`;
    return `<dt>${esc(f.label)}</dt><dd>${chips}</dd>`;
  }).join("");

  // 色の行 (色見本を押すとカラーコードをコピー)
  const colorRows = state.colorFields.filter((f) => !hidden.has(f.id)).map((f) => {
    const list = ((v.colors || {})[f.id] || []).filter(isHex);
    const swatches = list.length
      ? list.map((hex) =>
          `<button class="swatch" data-copy="${hex}" title="押すとカラーコードをコピー">` +
          `<span class="swatch-color" style="background:${hex}"></span><span class="swatch-hex">${hex.toUpperCase()}</span></button>`
        ).join("")
      : `<span class="none">未登録</span>`;
    return `<dt>${esc(f.label)}</dt><dd class="swatches">${swatches}</dd>`;
  }).join("");

  // 誕生日の行 (1 か月前からカウントダウンを表示)
  const bday = birthdayInfo(v);
  const bdayRow = `<dt>誕生日</dt><dd>${bday
    ? `<span class="bday-text">${bday.label}</span>` +
      (bday.counting ? `<span class="bday-left ${bday.days === 0 ? "today" : ""}">${daysLeftText(bday.days)}</span>` : "")
    : `<span class="none">未登録</span>`}</dd>`;

  // 日付の項目の行 (経過した年月を表示。記念日の当日だけ「今日で○周年！」)
  const dateRows = state.dateFields.filter((f) => !hidden.has(f.id)).map((f) => {
    const info = dateInfo((v.dates || {})[f.id]);
    return `<dt>${esc(f.label)}</dt><dd>${info
      ? `<span class="bday-text">${info.label}</span>` +
        (info.isToday ? `<span class="bday-left today">${annivText(info)}</span>`
          : info.since ? `<span class="date-since">(${info.since})</span>` : "")
      : `<span class="none">未登録</span>`}</dd>`;
  }).join("");

  // リンクの行 (押すと新しいタブで開く)
  const links = (v.links || []).filter((l) => safeUrl(l.url));
  const linkRow = `<dt>リンク</dt><dd>${links.length
    ? links.map((l) => `<a class="link-chip" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || linkLabel(l.url))} ↗</a>`).join("")
    : `<span class="none">未登録</span>`}</dd>`;

  // フォルダのタブ (数字は画像の枚数)
  const tabs = folders.map((name) => {
    const count = state.images.filter((i) => i.folder === name).length;
    return `<button class="folder-tab ${name === state.folder ? "active" : ""}" data-folder="${esc(name)}">${esc(name)} <small>${count}</small></button>`;
  }).join("");

  // 画像の一覧 (フォルダを選んでいるときだけ)
  let imagesHtml = `<p class="empty">フォルダを選ぶか、「＋ フォルダ」で作ってください。</p>`;
  if (state.folder) {
    const thumbs = state.images.filter((i) => i.folder === state.folder).map((img) =>
      `<div class="thumb"><img src="${thumbUrl(img)}" data-open="${img.id}" alt="${esc(img.name)}" title="${esc(img.name)}">` +
      (img.memo ? `<p class="memo">${esc(img.memo)}</p>` : "") +
      `<button class="del" data-del="${img.id}" title="削除">✕</button></div>`
    ).join("");
    imagesHtml = `
      <div class="folder-tools">
        <button id="btn-upload" class="primary">画像を追加</button>
        <button id="btn-rename-folder">フォルダ名を変更</button>
        <button id="btn-delete-folder" class="danger">フォルダを削除</button>
        <input id="file-input" type="file" accept="image/*" multiple hidden>
      </div>
      <div class="dropzone" id="dropzone">ここに画像をドラッグ＆ドロップ / Ctrl+V で貼り付けでも追加できます</div>
      <div class="grid">${thumbs || '<p class="empty">まだ画像がありません</p>'}</div>`;
  }

  main.innerHTML = backupNoticeHtml() + birthdayBannerHtml() + `
    <section class="card">
      <div class="card-head">
        <h2><span class="marker">${esc(titleOf(v))}</span>
          <button id="btn-fav" class="fav-btn ${v.favorite ? "on" : ""}" title="${v.favorite ? "お気に入りから外す" : "お気に入りにする"}">${v.favorite ? "★" : "☆"}</button></h2>
        <button id="btn-post" class="post-btn" title="ファンアートタグ入りで X の投稿画面を開く">𝕏 で投稿</button>
        <button id="btn-edit">編集</button>
        <button id="btn-delete" class="danger">削除</button>
      </div>
      <div class="icon-area">
        <button id="btn-icon" class="icon-frame" title="押すとアイコンを${hasIcon(v) ? "変更" : "登録"}">
          ${hasIcon(v) ? `<img src="${esc(v.icon)}" alt="">` : `<span>＋<br>アイコン</span>`}
        </button>
        ${hasIcon(v) ? `<button id="btn-icon-remove" class="ghost">アイコンを外す</button>` : ""}
        <input id="icon-input" type="file" accept="image/*" hidden>
      </div>
      <dl class="fields">${rows}${colorRows}${bdayRow}${dateRows}${linkRow}</dl>
    </section>
    <section class="card">
      <div class="card-head"><h2>参考画像</h2><button id="btn-add-folder">＋ フォルダ</button></div>
      <div class="folders">${tabs}</div>
      ${imagesHtml}
    </section>`;

  bindDetailEvents(v);
}

// 詳細画面のボタンに動きを付ける
function bindDetailEvents(v) {
  // チップを押すとコピー
  document.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => {
    copy(b.dataset.copy);
    // 押したチップに少しの間 ✓ を表示
    b.classList.add("copied");
    setTimeout(() => b.classList.remove("copied"), 1200);
  }));
  // フォルダのタブを押すと切り替え
  document.querySelectorAll("[data-folder]").forEach((b) => (b.onclick = () => {
    state.folder = b.dataset.folder;
    renderDetail();
  }));

  $("#btn-edit").onclick = () => openVtuberDialog(v);
  // お気に入りの切り替え
  $("#btn-fav").onclick = () => store.updateVtuber(v.id, { favorite: !v.favorite }).then(reload).catch(fail);
  // X の投稿画面を開く
  $("#btn-post").onclick = () => openPost(v);
  bindBannerEvents();
  // アイコンの登録・変更・削除
  const iconInput = $("#icon-input");
  $("#btn-icon").onclick = () => iconInput.click();
  iconInput.onchange = () => iconInput.files[0] && setIcon(v, iconInput.files[0]).catch(fail);
  if ($("#btn-icon-remove")) $("#btn-icon-remove").onclick = () => {
    if (confirm("アイコンを外しますか？")) store.updateVtuber(v.id, { icon: undefined }).then(reload).catch(fail);
  };
  $("#btn-delete").onclick = () => deleteVtuber(v).catch(fail);
  $("#btn-add-folder").onclick = () => addFolder(v).catch(fail);

  if (!state.folder) return;

  // 画像の追加 (ボタン)
  const fileInput = $("#file-input");
  $("#btn-upload").onclick = () => fileInput.click();
  fileInput.onchange = () => upload(fileInput.files);

  // 画像の追加 (ドラッグ＆ドロップ)
  const dz = $("#dropzone");
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("over"); };
  dz.ondragleave = () => dz.classList.remove("over");
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("over"); upload(e.dataTransfer.files); };

  $("#btn-rename-folder").onclick = () => renameFolder(v).catch(fail);
  $("#btn-delete-folder").onclick = () => deleteFolder(v).catch(fail);

  // 画像を押すと拡大表示
  document.querySelectorAll("[data-open]").forEach((img) => (img.onclick = () => openLightbox(img.dataset.open).catch(fail)));
  // 画像の削除
  document.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => deleteImage(b.dataset.del).catch(fail)));
}

// お知らせの名前を押すとその Vtuber を開く
function bindBannerEvents() {
  document.querySelectorAll("[data-select]").forEach((b) => (b.onclick = () => select(b.dataset.select)));
  // 「バックアップする」→ 設定画面を開く
  const nb = $("#btn-notice-backup");
  if (nb) nb.onclick = () => $("#btn-fields").click();
}

// ------------------------------------------------------------
// リンク
// ------------------------------------------------------------
// http:// か https:// で始まる正しい URL だけ使う (危ないリンクを防ぐ)
function safeUrl(url) {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

// 名前が空のリンクは URL からサービス名を付ける
function linkLabel(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const known = [
    [/youtube\.com|youtu\.be/, "YouTube"], [/(^|\.)x\.com|twitter\.com/, "X"], [/twitch\.tv/, "Twitch"],
    [/booth\.pm/, "BOOTH"], [/fanbox\.cc/, "FANBOX"], [/pixiv\.net/, "pixiv"], [/tiktok\.com/, "TikTok"],
    [/instagram\.com/, "Instagram"], [/bsky\.app/, "Bluesky"], [/marshmallow-qa\.com/, "マシュマロ"],
  ];
  const hit = known.find(([re]) => re.test(host));
  return hit ? hit[1] : host;
}

// ------------------------------------------------------------
// X (旧 Twitter) に投稿
// ------------------------------------------------------------
// テンプレートの {項目名} を、その Vtuber の登録内容に置き換える
function buildPostText(v) {
  const text = state.postTemplate.replace(/\{([^{}]+)\}/g, (all, label) => {
    const f = state.fields.find((x) => x.label === label.trim());
    if (!f) return all; // 無い項目名はそのまま残す
    if (hiddenOf(v).has(f.id)) return ""; // この推しで非表示にしている項目は入れない
    return splitValue(v.values[f.id] || "").join(" ");
  });
  return text.trim();
}

// テンプレートで使っている項目のうち、この Vtuber で未登録のもの (項目名の一覧)
function missingPostFields(v) {
  return [...state.postTemplate.matchAll(/\{([^{}]+)\}/g)]
    .map((m) => m[1].trim())
    .filter((label) => {
      const f = state.fields.find((x) => x.label === label);
      return f && !hiddenOf(v).has(f.id) && !(v.values[f.id] || "").trim();
    });
}

function openPost(v) {
  // テンプレートそのものが空のとき
  if (!state.postTemplate.trim()) return toast("投稿テンプレートが空です。「⚙ 項目・設定」で設定してください");
  const text = buildPostText(v);
  const missing = missingPostFields(v);
  const names = missing.map((l) => `「${l}」`).join("");
  // 当てはめた結果が空 = 使っている項目がこの人では未登録
  if (!text) return toast(`${names}が未登録です。「編集」から登録してください`);
  // 一部だけ未登録なら、知らせてから投稿画面を開く
  if (missing.length) toast(`${names}が未登録のまま投稿画面を開きます`);
  // X の投稿画面を開く (スマホでは X アプリが開く)
  window.open("https://x.com/intent/tweet?text=" + encodeURIComponent(text), "_blank", "noopener");
}

// ------------------------------------------------------------
// Vtuber の選択・削除
// ------------------------------------------------------------
function select(id) {
  state.selectedId = id;
  const v = current();
  // 最初のフォルダ (例: 通常衣装) を自動で開く
  state.folder = v && v.folders && v.folders.length ? v.folders[0] : null;
  // 前の Vtuber のサムネイル URL を片付けてから、画像を読み込む
  thumbUrls.forEach((url) => URL.revokeObjectURL(url));
  thumbUrls.clear();
  state.images = [];
  render();
  loadImages().then(renderDetail).catch(fail);
  // 画面の一番上に戻す
  window.scrollTo({ top: 0 });
}

async function deleteVtuber(v) {
  if (!confirm(`「${titleOf(v)}」を削除しますか？\n保存した画像もすべて削除されます。`)) return;
  await store.deleteVtuber(v.id);
  select(null);
  await reload();
  toast("削除しました");
}

// ------------------------------------------------------------
// フォルダの操作
// ------------------------------------------------------------
// フォルダ名をきれいにする (前後の空白を消す)。使えないときは null
function cleanFolderName(name, folders) {
  name = (name || "").trim();
  if (!name) return null;
  if (folders.includes(name)) {
    toast("同じ名前のフォルダがすでにあります");
    return null;
  }
  return name;
}

async function addFolder(v) {
  const name = cleanFolderName(prompt("フォルダ名 (例: 通常衣装、新衣装、ラフ資料)"), v.folders || []);
  if (!name) return;
  state.folder = name;
  await store.updateVtuber(v.id, { folders: [...(v.folders || []), name] });
  await reload();
}

async function renameFolder(v) {
  const old = state.folder;
  const name = cleanFolderName(prompt("新しいフォルダ名", old), v.folders);
  if (!name) return;
  // フォルダ名の一覧と、そのフォルダの画像すべての folder を書き換える
  const ids = state.images.filter((i) => i.folder === old).map((i) => i.id);
  state.folder = name;
  await store.updateImages(ids, { folder: name });
  await store.updateVtuber(v.id, { folders: v.folders.map((f) => (f === old ? name : f)) });
  await reload();
}

async function deleteFolder(v) {
  const name = state.folder;
  if (!confirm(`フォルダ「${name}」と中の画像をすべて削除しますか？`)) return;
  const ids = state.images.filter((i) => i.folder === name).map((i) => i.id);
  const rest = v.folders.filter((f) => f !== name);
  state.folder = rest[0] || null;
  await store.deleteImages(ids);
  await store.updateVtuber(v.id, { folders: rest });
  await reload();
}

// ------------------------------------------------------------
// アイコン
// ------------------------------------------------------------
// アイコンが登録されているか (中身が JPEG の画像データかも確認)
const hasIcon = (v) => typeof v.icon === "string" && v.icon.startsWith("data:image/jpeg;base64,");

// 一覧などで使う丸いアイコン。未登録なら名前の 1 文字目を表示
function avatarHtml(v, cls) {
  if (hasIcon(v)) return `<img class="${cls}" src="${esc(v.icon)}" alt="">`;
  const first = [...titleOf(v)][0] || "?";
  return `<span class="${cls} no-icon">${esc(first)}</span>`;
}

// 画像の真ん中を正方形に切り抜いて小さい JPEG にし、Vtuber の情報と一緒に保存
// (240px 四方・20KB 前後なので、一覧を開くときも軽い)
async function setIcon(v, file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 240;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // 透明な部分は白にする
  ctx.fillRect(0, 0, 240, 240);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 240, 240);
  bitmap.close();
  await store.updateVtuber(v.id, { icon: canvas.toDataURL("image/jpeg", 0.85) });
  await reload();
  toast("アイコンを保存しました");
}

// ------------------------------------------------------------
// 画像の圧縮・保存・表示・削除
// ------------------------------------------------------------
// 一覧用の小さい画像 (長い辺 360px の JPEG) を作る
async function makeThumb(bitmap) {
  const scale = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // 透明な部分は白にする (JPEG は透明にできないため)
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
}

// 画像の拡張子 (保存・ダウンロード用)
const extOf = (type) => ({ "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" }[type] || "jpg");

let uploading = false;
async function upload(fileList) {
  const v = current();
  const folder = state.folder;
  const files = [...(fileList || [])].filter((f) => f.type.startsWith("image/"));
  if (!v || !folder || !files.length) return;
  if (uploading) return toast("保存中です。少し待ってください");
  uploading = true;
  let done = 0;
  let skipped = 0; // 開けなかった画像の数
  try {
    for (const file of files) {
      toast(`保存中… (${done + 1}/${files.length})`);
      // 元の画像はそのまま保存し、一覧用の小さい画像だけ作る
      // (このブラウザで開けない形式の画像は飛ばして、残りの画像の保存を続ける)
      const bitmap = await createImageBitmap(file).catch(() => null);
      if (!bitmap) {
        skipped++;
        continue;
      }
      const thumb = await makeThumb(bitmap);
      const { width, height } = bitmap;
      bitmap.close();
      // 貼り付けた画像は名前が "image.png" になるので日時を付ける
      const base = file.name && file.name !== "image.png" ? file.name.replace(/\.[^.]+$/, "") : `paste_${Date.now()}`;
      await store.addImage({
        id: newId(), vtuberId: v.id, folder, name: `${base}.${extOf(file.type)}`, type: file.type,
        thumb, width, height, createdAt: Date.now(),
      }, file);
      done++;
    }
    toast(`${done} 枚保存しました` + (skipped ? ` (${skipped} 枚はこのブラウザで開けない形式のため保存できませんでした)` : ""));
  } catch (e) {
    // 端末の空き容量が足りないとき
    if (e && e.name === "QuotaExceededError") e = new Error("端末の空き容量が足りません");
    fail(e);
  } finally {
    uploading = false;
    await reload();
  }
}

// Ctrl+V で画像を貼り付けたとき
document.addEventListener("paste", (e) => {
  if (document.querySelector("dialog[open]")) return; // ダイアログ入力中は無視
  const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
  if (files.length) upload(files);
});

async function deleteImage(id) {
  const img = state.images.find((i) => i.id === id);
  if (!img || !confirm(`「${img.name}」を削除しますか？`)) return;
  await store.deleteImages([id]);
  await reload();
}

// ------------------------------------------------------------
// 拡大表示 (お絵描き用の確認機能・スポイト・ひとことメモ付き)
// ------------------------------------------------------------
const lb = {
  id: null,        // 表示中の画像の ID
  url: null,       // 画像本体の表示用 URL
  canvas: null,    // スポイト用に画像を描いておくキャンバス
  scale: 1,        // ズーム倍率
  x: 0, y: 0,      // ずらした量 (ズーム中にドラッグで移動)
  flip: false,     // 左右反転
  gray: false,     // 白黒表示
  picking: false,  // スポイトモード
  picked: null,    // スポイトで拾った色
};

async function openLightbox(id) {
  const img = state.images.find((i) => i.id === id);
  Object.assign(lb, { id, canvas: null, scale: 1, x: 0, y: 0, picked: null });
  $("#lightbox-img").src = thumbUrl(img); // 読み込みが終わるまではサムネイルを表示
  $("#lightbox-download").removeAttribute("href");
  $("#lb-memo").value = img.memo || "";
  $("#lb-pick").hidden = true;
  applyView();
  $("#lightbox").hidden = false;
  const blob = await store.getImageBlob(id);
  if (!blob || $("#lightbox").hidden || lb.id !== id) return;
  if (lb.url) URL.revokeObjectURL(lb.url);
  lb.url = URL.createObjectURL(blob);
  $("#lightbox-img").src = lb.url;
  $("#lightbox-download").href = lb.url;
  $("#lightbox-download").download = img.name;
  // スポイト用に、元の大きさのままキャンバスに描いておく
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  // iPhone の Safari はキャンバスの大きさに上限 (約 1,670 万画素) があるので、超える画像は縮小して描く
  // (スポイトは画像の中の「割合」で位置を決めるので、縮小しても同じ場所の色を拾える)
  const scale = Math.min(1, Math.sqrt(16_000_000 / (bitmap.width * bitmap.height)));
  canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
  canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  if (lb.id === id) lb.canvas = canvas;
}

function closeLightbox() {
  if ($("#lightbox").hidden) return;
  // 入力中のメモがあれば、閉じる前に保存する (入力欄から離れると保存される)
  if (document.activeElement === $("#lb-memo")) $("#lb-memo").blur();
  $("#lightbox").hidden = true;
  lb.id = null;
}

// ズーム・反転・白黒を画像に反映し、ボタンの ON/OFF 表示も更新
function applyView() {
  if (lb.scale <= 1) Object.assign(lb, { scale: 1, x: 0, y: 0 }); // 等倍に戻ったら位置も戻す
  const img = $("#lightbox-img");
  img.style.transform = `translate(${lb.x}px, ${lb.y}px) scale(${lb.scale}) scaleX(${lb.flip ? -1 : 1})`;
  img.style.filter = lb.gray ? "grayscale(1)" : "";
  $("#lb-flip").classList.toggle("on", lb.flip);
  $("#lb-gray").classList.toggle("on", lb.gray);
  $("#lb-picker").classList.toggle("on", lb.picking);
  $("#lightbox").classList.toggle("picking", lb.picking);
  $("#lb-zoom-label").textContent = `${Math.round(lb.scale * 100)}%`;
}

const zoomTo = (s) => {
  lb.scale = Math.min(8, Math.max(1, s)); // 1 倍〜8 倍
  applyView();
};

$("#lb-flip").onclick = () => { lb.flip = !lb.flip; applyView(); };
$("#lb-gray").onclick = () => { lb.gray = !lb.gray; applyView(); };
$("#lb-picker").onclick = () => {
  lb.picking = !lb.picking;
  if (lb.picking) toast("色を拾いたいところを押してください");
  applyView();
};
$("#lb-zoom-in").onclick = () => zoomTo(lb.scale * 1.5);
$("#lb-zoom-out").onclick = () => zoomTo(lb.scale / 1.5);
$("#lb-zoom-label").onclick = () => zoomTo(1);
$("#lightbox-close").onclick = closeLightbox;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

// マウスホイールでズーム
$("#lb-stage").addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomTo(lb.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
}, { passive: false });

// 指・マウスの操作: ドラッグで移動、2 本指でズーム、タップでスポイト or 閉じる
const pointers = new Map();
let gesture = null;
const stage = $("#lb-stage");
const dist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

stage.addEventListener("pointerdown", (e) => {
  stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gesture = pointers.size === 2
    ? { pinch: true, startDist: dist(), startScale: lb.scale, moved: true }
    : { pinch: false, moved: false, sx: e.clientX, sy: e.clientY };
});
stage.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p || !gesture) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  if (gesture.pinch && pointers.size === 2) {
    zoomTo(gesture.startScale * (dist() / gesture.startDist));
  } else if (!gesture.pinch) {
    if (Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 6) gesture.moved = true;
    if (gesture.moved && lb.scale > 1) {
      lb.x += dx;
      lb.y += dy;
      applyView();
    }
  }
});
const endPointer = (e) => {
  if (!pointers.delete(e.pointerId)) return;
  if (gesture && !gesture.moved && pointers.size === 0 && e.type === "pointerup") {
    // 押した位置が画像の上かどうかを座標で判定する
    // (指の動きを追うため、イベントの対象はいつも stage になっている)
    const r = $("#lightbox-img").getBoundingClientRect();
    const onImage = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (onImage) {
      if (lb.picking) pickColor(e);
    } else {
      closeLightbox(); // 画像の外側を押したら閉じる
    }
  }
  if (pointers.size === 0) gesture = null;
};
stage.addEventListener("pointerup", endPointer);
stage.addEventListener("pointercancel", endPointer);

// スポイト: 押した場所の色 (まわり 3×3 ピクセルの平均) を拾う
function pickColor(e) {
  if (!lb.canvas) return toast("画像を読み込み中です。少し待ってください");
  const rect = $("#lightbox-img").getBoundingClientRect();
  let rx = (e.clientX - rect.left) / rect.width;
  const ry = (e.clientY - rect.top) / rect.height;
  if (lb.flip) rx = 1 - rx; // 反転表示中は左右を戻して計算
  const { width: cw, height: ch } = lb.canvas;
  const px = Math.floor(rx * cw), py = Math.floor(ry * ch);
  // まわり 3×3 を画像の内側に収める (端を押したときに外側の黒が混ざらないように)
  const w = Math.min(3, cw), h = Math.min(3, ch);
  const x0 = Math.min(Math.max(0, px - 1), cw - w), y0 = Math.min(Math.max(0, py - 1), ch - h);
  const data = lb.canvas.getContext("2d").getImageData(x0, y0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
  const hex = "#" + [r, g, b].map((c) => Math.round(c / n).toString(16).padStart(2, "0")).join("");
  lb.picked = hex;
  $("#lb-pick-color").style.background = hex;
  $("#lb-pick-hex").textContent = hex.toUpperCase();
  // 登録先 (色の項目) の選択肢
  $("#lb-pick-field").innerHTML = state.colorFields.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join("");
  $("#lb-pick").hidden = false;
}

$("#lb-pick-copy").onclick = () => lb.picked && copy(lb.picked);
$("#lb-pick-add").onclick = () => {
  const v = current();
  const fid = $("#lb-pick-field").value;
  if (!v || !fid || !lb.picked) return;
  const list = ((v.colors || {})[fid] || []).filter(isHex);
  if (list.includes(lb.picked)) return toast("その色はもう登録されています");
  const label = state.colorFields.find((f) => f.id === fid)?.label;
  store.updateVtuber(v.id, { colors: { ...(v.colors || {}), [fid]: [...list, lb.picked] } })
    .then(reload)
    .then(() => toast(`「${label}」に ${lb.picked.toUpperCase()} を登録しました`))
    .catch(fail);
};

// ひとことメモ (入力欄から離れたとき・Enter で保存)
$("#lb-memo").addEventListener("change", () => {
  const id = lb.id;
  if (!id) return;
  store.updateImages([id], { memo: $("#lb-memo").value.trim() })
    .then(reload)
    .then(() => toast("メモを保存しました"))
    .catch(fail);
});
$("#lb-memo").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });

// ------------------------------------------------------------
// Vtuber の追加・編集ダイアログ
// ------------------------------------------------------------
// 色の入力 1 行分 (カラーピッカー + カラーコード + 削除ボタン)
const colorRowHtml = (hex) => `
  <div class="color-row">
    <input type="color" value="${hex}">
    <input type="text" class="hex" value="${hex}" maxlength="7" spellcheck="false">
    <button type="button" class="rm" title="この色を削除">✕</button>
  </div>`;

// リンクの入力 1 行分 (名前 + URL + 削除ボタン)
const linkRowHtml = (l = {}) => `
  <div class="link-row">
    <input type="text" class="link-label" value="${esc(l.label || "")}" placeholder="名前 (例: YouTube)">
    <input type="text" inputmode="url" autocapitalize="off" class="link-url" value="${esc(l.url || "")}" placeholder="https://…" spellcheck="false">
    <button type="button" class="rm" title="このリンクを削除">✕</button>
  </div>`;

// 月・日の選択肢 (選んでいる値に印を付ける)
const options = (max, selected, unit) =>
  `<option value="">--</option>` +
  Array.from({ length: max }, (_, i) => i + 1)
    .map((n) => `<option value="${n}" ${n === selected ? "selected" : ""}>${n}${unit}</option>`).join("");

function openVtuberDialog(v) {
  // 登録項目がまだ読み込まれていないときは待ってもらう
  if (!state.fields.length) return toast("読み込み中です。少し待ってください");
  state.editingId = v ? v.id : null;
  $("#dlg-vtuber-title").textContent = v ? "推しを編集" : "推しを追加";
  // この推しで非表示にしている項目
  const hidden = v ? hiddenOf(v) : new Set();
  // 「非表示」ボタン (押すと「この推しでは表示しない」を切り替える)
  const hideBtn = (id) => `<button type="button" class="hide-toggle" data-hide-id="${esc(id)}" aria-pressed="${hidden.has(id)}">${hidden.has(id) ? "表示する" : "非表示"}</button>`;
  // 登録項目の数だけ入力欄を作る (改行で複数登録できるよう textarea にする)
  // 一番上の項目は一覧の「見出し」なので、非表示にはできない
  const texts = state.fields.map((f, i) =>
    `<div class="field-edit ${hidden.has(f.id) ? "is-hidden" : ""}">` +
    `<label>${esc(f.label)}<textarea data-field="${esc(f.id)}" rows="1">${esc((v && v.values[f.id]) || "")}</textarea></label>` +
    (i ? hideBtn(f.id) : "") + `</div>`
  ).join("") + `<p class="hint">改行すると別々にコピーできるチップになります。「#タグA #タグB」のように # 付きで並べても分かれます。</p>`;
  // カラー項目 (髪の色・目の色など)。1 つの項目に何色でも登録できる
  const colors = state.colorFields.map((f) => {
    const list = ((v && v.colors && v.colors[f.id]) || []).filter(isHex);
    return `
      <div class="color-edit field-edit ${hidden.has(f.id) ? "is-hidden" : ""}" data-color-field="${esc(f.id)}">
        <span class="color-label">${esc(f.label)}</span>${hideBtn(f.id)}
        <div class="color-list">${list.map(colorRowHtml).join("")}</div>
        <button type="button" class="add-color">＋ 色を追加</button>
      </div>`;
  }).join("");
  // 誕生日と日付の項目 (年は入れなくても OK、月と日を選ぶ)
  const dateEdit = (label, x, attr, hideId) => `
    <div class="color-edit field-edit ${hideId && hidden.has(hideId) ? "is-hidden" : ""}" ${attr}>
      <span class="color-label">${esc(label)}</span>${hideId ? hideBtn(hideId) : ""}
      <div class="bday-edit">
        <input type="text" class="date-y" inputmode="numeric" maxlength="4" placeholder="年 (なくてもOK)" value="${isDate(x) && x.y ? x.y : ""}">
        <select class="date-m">${options(12, isDate(x) ? x.m : 0, "月")}</select>
        <select class="date-d">${options(31, isDate(x) ? x.d : 0, "日")}</select>
      </div>
    </div>`;
  const birthday = dateEdit("誕生日", v && v.birthday, 'id="bday-edit"');
  const dates = state.dateFields.map((f) => dateEdit(f.label, v && v.dates && v.dates[f.id], `data-date-field="${esc(f.id)}"`, f.id)).join("");
  // リンク (いくつでも登録できる)
  const links = `
    <div class="color-edit">
      <span class="color-label">リンク</span>
      <div class="link-list">${((v && v.links) || []).map(linkRowHtml).join("")}</div>
      <button type="button" class="add-link">＋ リンクを追加</button>
    </div>`;
  $("#vtuber-inputs").innerHTML = texts + colors + birthday + dates + links;
  document.querySelectorAll("#vtuber-inputs textarea").forEach(fitTextarea);
  $("#dlg-vtuber").returnValue = "";
  $("#dlg-vtuber").showModal();
}

// 入力欄の高さを行数に合わせる (改行した分だけ広がる)
function fitTextarea(t) {
  t.rows = Math.max(1, t.value.split("\n").length);
}

// 入力されたカラーコードを「#a1b2c3」の形にそろえる (「a1b2c3」「#abc」も OK)。ダメなら null
function normalizeHex(s) {
  let t = (s || "").trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t)) t = t.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(t) ? "#" + t : null;
}

// カラー入力欄の操作 (中身が作り直されても動くよう、親要素でまとめて受け取る)
$("#vtuber-inputs").addEventListener("click", (e) => {
  // 「非表示」⇔「表示する」の切り替え (保存を押すまで反映しない)
  const hb = e.target.closest(".hide-toggle");
  if (hb) {
    const on = hb.getAttribute("aria-pressed") !== "true";
    hb.setAttribute("aria-pressed", on);
    hb.textContent = on ? "表示する" : "非表示";
    hb.closest(".field-edit").classList.toggle("is-hidden", on);
    return;
  }
  if (e.target.classList.contains("add-color")) {
    e.target.previousElementSibling.insertAdjacentHTML("beforeend", colorRowHtml("#cccccc"));
  } else if (e.target.classList.contains("add-link")) {
    e.target.previousElementSibling.insertAdjacentHTML("beforeend", linkRowHtml());
    e.target.previousElementSibling.lastElementChild.querySelector(".link-url").focus();
  } else if (e.target.classList.contains("rm")) {
    e.target.closest(".color-row, .link-row").remove();
  }
});
$("#vtuber-inputs").addEventListener("input", (e) => {
  if (e.target.tagName === "TEXTAREA") return fitTextarea(e.target);
  const row = e.target.closest(".color-row");
  if (!row) return;
  const [picker, text] = row.querySelectorAll("input");
  if (e.target === picker) text.value = picker.value;      // ピッカー → コード
  else {
    const hex = normalizeHex(text.value);                  // コード → ピッカー
    if (hex) picker.value = hex;
  }
});

$("#dlg-vtuber").addEventListener("close", () => {
  if ($("#dlg-vtuber").returnValue !== "ok") return;
  // 入力内容を集める (削除した項目の値は消さずに残しておく)
  const v = state.editingId ? current() : null;
  const values = { ...(v ? v.values : {}) };
  document.querySelectorAll("#vtuber-inputs [data-field]").forEach((t) => (values[t.dataset.field] = t.value.trim()));
  const colors = { ...((v && v.colors) || {}) };
  document.querySelectorAll("#vtuber-inputs [data-color-field]").forEach((box) => {
    colors[box.dataset.colorField] = [...box.querySelectorAll(".hex")]
      .map((t) => normalizeHex(t.value))
      .filter(Boolean);
  });
  // 日付の入力欄 1 つ分を読む (月と日が両方選ばれているときだけ。年は 4 桁の数字のときだけ)
  const readDate = (box) => {
    const m = +box.querySelector(".date-m").value, d = +box.querySelector(".date-d").value;
    const y = box.querySelector(".date-y").value.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    if (!m || !d) return null;
    return /^\d{4}$/.test(y) && +y >= 1 ? { y: +y, m, d } : { m, d };
  };
  const birthday = readDate($("#bday-edit"));
  const dates = { ...((v && v.dates) || {}) }; // 削除した項目の値は消さずに残しておく
  document.querySelectorAll("#vtuber-inputs [data-date-field]").forEach((box) => {
    const x = readDate(box);
    if (x) dates[box.dataset.dateField] = x;
    else delete dates[box.dataset.dateField];
  });
  // この推しで非表示にする項目 (削除した項目の分は残しておく)
  const shown = new Set([...document.querySelectorAll("#vtuber-inputs .hide-toggle")].map((b) => b.dataset.hideId));
  const hidden = [
    ...[...((v && v.hidden) || [])].filter((id) => !shown.has(id)),
    ...[...document.querySelectorAll('#vtuber-inputs .hide-toggle[aria-pressed="true"]')].map((b) => b.dataset.hideId),
  ];
  // リンク (URL が正しいものだけ保存。「https://」を付け忘れても補う)
  const links = [...document.querySelectorAll("#vtuber-inputs .link-row")]
    .map((r) => {
      let url = r.querySelector(".link-url").value.trim();
      if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
      return { label: r.querySelector(".link-label").value.trim(), url };
    })
    .filter((l) => safeUrl(l.url));

  if (v) {
    store.updateVtuber(v.id, { values, colors, birthday, dates, links, hidden }).then(reload).catch(fail);
  } else {
    const id = newId();
    // 書き込みはまず端末に反映されるので、すぐに選択できる
    store.putVtuber({ id, values, colors, birthday, dates, links, hidden, folders: [DEFAULT_FOLDER], createdAt: Date.now() })
      .then(loadVtubers)
      .then(() => select(id))
      .catch(fail);
  }
});

$("#btn-add-vtuber").onclick = () => { closeDrawer(); openVtuberDialog(null); };

// ------------------------------------------------------------
// 登録項目の編集ダイアログ (テキスト項目とカラー項目の 2 種類)
// ------------------------------------------------------------
// ダイアログ内で編集中の項目 (保存を押すまで反映しない)
const drafts = { fields: [], colorFields: [], dateFields: [] };
// どの一覧をどの <ul> に表示するか
const ROW_LISTS = { fields: "#field-rows", colorFields: "#color-field-rows", dateFields: "#date-field-rows" };

function renderRows(key) {
  const list = drafts[key];
  const ul = $(ROW_LISTS[key]);
  ul.innerHTML = list.map((f, i) => `
    <li>
      <input type="text" value="${esc(f.label)}" data-i="${i}">
      <button type="button" data-up="${i}" title="上へ">↑</button>
      <button type="button" data-down="${i}" title="下へ">↓</button>
      <button type="button" data-remove="${i}" class="danger" title="削除">✕</button>
    </li>`).join("");
  // 入力した文字をすぐ drafts に反映
  ul.querySelectorAll("input").forEach((inp) => (inp.oninput = () => (list[inp.dataset.i].label = inp.value)));
  // 並べ替え
  ul.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => move(key, +b.dataset.up, -1)));
  ul.querySelectorAll("[data-down]").forEach((b) => (b.onclick = () => move(key, +b.dataset.down, 1)));
  // 削除
  ul.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = () => {
    const f = list[+b.dataset.remove];
    if (!confirm(`項目「${f.label}」を削除しますか？`)) return;
    list.splice(+b.dataset.remove, 1);
    renderRows(key);
  }));
}

function move(key, i, d) {
  const list = drafts[key];
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  renderRows(key);
}

function addRow(key) {
  drafts[key].push({ id: newId(), label: "" });
  renderRows(key);
  document.querySelector(`${ROW_LISTS[key]} li:last-child input`).focus();
}

$("#btn-fields").onclick = () => {
  // コピーを作って編集
  drafts.fields = state.fields.map((f) => ({ ...f }));
  drafts.colorFields = state.colorFields.map((f) => ({ ...f }));
  renderRows("fields");
  renderRows("colorFields");
  drafts.dateFields = state.dateFields.map((f) => ({ ...f }));
  renderRows("dateFields");
  $("#post-template").value = state.postTemplate;
  renderStorageInfo();
  $("#dlg-fields").returnValue = "";
  $("#dlg-fields").showModal();
};

$("#btn-add-field").onclick = () => addRow("fields");
$("#btn-add-color-field").onclick = () => addRow("colorFields");
$("#btn-add-date-field").onclick = () => addRow("dateFields");

$("#dlg-fields").addEventListener("close", () => {
  if ($("#dlg-fields").returnValue !== "ok") return;
  // 空の項目名は保存しない
  const clean = (list) => list.map((f) => ({ id: f.id, label: f.label.trim() })).filter((f) => f.label);
  const fields = clean(drafts.fields);
  // 文字の項目が 1 つも無いと名前を登録できないので、保存しない
  if (!fields.length) return toast("文字の項目は 1 つ以上必要です。保存しませんでした");
  store.saveSettings({
    fields,
    colorFields: clean(drafts.colorFields),
    dateFields: clean(drafts.dateFields),
    postTemplate: $("#post-template").value.trim(),
  }).then(reload).catch(fail);
  toast("設定を保存しました");
});

// ------------------------------------------------------------
// バックアップ (書き出し・読み込み)
//  - 「文字だけ」: .json ファイル (軽い)
//  - 「画像も含めて」: .zip ファイル (別の端末へのお引っ越しにも使える)
// ------------------------------------------------------------
// Vtuber 1 人分のうち、バックアップに入れる項目
const BACKUP_KEYS = ["values", "colors", "links", "birthday", "dates", "hidden", "favorite", "folders", "icon", "createdAt"];

// 文字の部分 (設定と Vtuber の情報) をまとめる
function backupData() {
  return {
    app: "oshi-memo",           // 推しメモ帳のバックアップであることの印
    version: 1,
    exportedAt: new Date().toISOString(),
    fields: state.fields,
    colorFields: state.colorFields,
    dateFields: state.dateFields,
    postTemplate: state.postTemplate,
    vtubers: state.vtubers.map((v) => {
      const out = { id: v.id };
      BACKUP_KEYS.forEach((k) => v[k] !== undefined && (out[k] = v[k]));
      return out;
    }),
  };
}

// ファイルとしてダウンロードさせる
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const today = () => new Date().toISOString().slice(0, 10);

// 書き出した日時を覚えておく (バックアップのお知らせに使う)
async function markBackedUp() {
  await store.saveSettings({ lastBackupAt: Date.now() });
  state.lastBackupAt = Date.now();
  renderDetail(); // バックアップのお知らせを消す
  renderStorageInfo();
}

// 文字だけ
$("#btn-export").onclick = async () => {
  const data = backupData();
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `oshimemo-${today()}.json`);
  await markBackedUp();
  toast(`${data.vtubers.length} 人分を書き出しました (画像なし)`);
};

// 画像も含めて (zip)
$("#btn-export-zip").onclick = async () => {
  try {
    toast("書き出し中… (画像が多いと時間がかかります)");
    const data = backupData();
    const zip = new JSZip();
    const images = await store.listAllImages();
    // 画像の情報 (サムネイルは読み込み時に作り直すので入れない)
    data.images = images.map(({ thumb, ...meta }) => meta);
    zip.file("data.json", JSON.stringify(data, null, 2));
    for (const img of images) {
      const blob = await store.getImageBlob(img.id);
      if (blob) zip.file(`images/${img.id}`, blob);
    }
    // 画像はもともと圧縮されているので、zip では圧縮しない (速い)
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    downloadBlob(blob, `oshimemo-${today()}-full.zip`);
    await markBackedUp();
    toast(`${data.vtubers.length} 人・画像 ${images.length} 枚を書き出しました`);
  } catch (e) {
    fail(e);
  }
};

$("#btn-import").onclick = () => $("#import-input").click();
$("#import-input").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // 同じファイルをもう一度選べるようにする
  if (!file) return;
  try {
    // zip なら中の data.json と画像を、json ならそのまま読む
    const isZip = /\.zip$/i.test(file.name) || file.type.includes("zip");
    const zip = isZip ? await JSZip.loadAsync(file) : null;
    const text = zip ? await zip.file("data.json")?.async("string") : await file.text();
    const data = JSON.parse(text || "{}");
    if (data.app !== "oshi-memo" || !Array.isArray(data.vtubers)) return toast("推しメモ帳のバックアップファイルではありません");
    const imageCount = Array.isArray(data.images) ? data.images.length : 0;
    if (!confirm(`${data.vtubers.length} 人分${imageCount ? `・画像 ${imageCount} 枚` : ""}のデータを読み込みますか？\n同じ推しのデータは、バックアップの内容で上書きされます。`)) return;

    // 項目・テンプレート
    const settings = {};
    if (Array.isArray(data.fields)) settings.fields = data.fields;
    if (Array.isArray(data.colorFields)) settings.colorFields = data.colorFields;
    if (Array.isArray(data.dateFields)) settings.dateFields = data.dateFields;
    if (typeof data.postTemplate === "string") settings.postTemplate = data.postTemplate;
    await store.saveSettings(settings);

    // Vtuber (ID が正しいものだけ)
    const validId = (id) => typeof id === "string" && /^[A-Za-z0-9]{1,40}$/.test(id);
    for (const v of data.vtubers) {
      if (!validId(v.id)) continue;
      const now = (await store.getVtuber(v.id)) || { id: v.id, createdAt: Date.now() };
      const out = { ...now };
      BACKUP_KEYS.forEach((k) => v[k] !== undefined && (out[k] = v[k]));
      await store.putVtuber(out);
    }

    // 画像 (zip のときだけ)
    let restored = 0;
    if (zip && imageCount) {
      for (const meta of data.images) {
        if (!validId(meta.id) || !validId(meta.vtuberId)) continue;
        const entry = zip.file(`images/${meta.id}`);
        if (!entry) continue;
        toast(`画像を読み込み中… (${restored + 1}/${imageCount})`);
        const blob = new Blob([await entry.async("arraybuffer")], { type: meta.type || "image/jpeg" });
        const bitmap = await createImageBitmap(blob);
        const thumb = await makeThumb(bitmap);
        bitmap.close();
        await store.addImage({ ...meta, thumb }, blob);
        restored++;
      }
    }
    $("#dlg-fields").close("cancel"); // 古い内容のまま保存されないよう、保存せずに閉じる
    await reload();
    toast(`読み込みました${restored ? ` (画像 ${restored} 枚)` : ""}`);
  } catch (err) {
    fail(err);
  }
};

// ------------------------------------------------------------
// 端末保存についてのお知らせ
// ------------------------------------------------------------
// 画面の上に出すお知らせ (バックアップをしばらくしていないとき)
function backupNoticeHtml() {
  if (!state.vtubers.length) return "";
  const days = state.lastBackupAt ? Math.floor((Date.now() - state.lastBackupAt) / 86400000) : null;
  if (days !== null && days < BACKUP_REMIND_DAYS) return "";
  // 一度もバックアップしていないときは、最初の登録から 7 日たったら知らせる
  const firstAt = Math.min(...state.vtubers.map((v) => v.createdAt || Date.now()));
  if (days === null && Date.now() - firstAt < 7 * 86400000) return "";
  return `
    <section class="notice">
      <p>💾 ${days === null ? "まだバックアップをしていません。" : `最後のバックアップから ${days} 日たちました。`}
        データはこの端末の中だけにあるので、ときどき書き出しておくと安心です。</p>
      <button id="btn-notice-backup">バックアップする</button>
    </section>`;
}

// 設定画面の「保存について」の欄
async function renderStorageInfo() {
  const u = await store.usage().catch(() => null);
  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  $("#storage-info").innerHTML = `
    <li>使っている容量: ${u ? `約 ${mb(u.usage)} MB (使える目安 ${mb(u.quota)} MB)` : "不明"}</li>
    <li>ブラウザによる自動削除の防止: ${state.persisted ? "✅ ON" : "⚠ OFF (ホーム画面に追加すると ON になりやすくなります)"}</li>
    <li>最後のバックアップ: ${state.lastBackupAt ? new Date(state.lastBackupAt).toLocaleDateString("ja-JP") : "まだありません"}</li>`;
}

// ------------------------------------------------------------
// 画面全体を描き直す
// ------------------------------------------------------------
function render() {
  if (!state.ready) return;
  renderList();
  renderDetail();
}

$("#search").oninput = renderList;
// 右上の「？ 注意点」
$("#btn-help").onclick = () => $("#dlg-help").showModal();

start();
