/* ============================================================
   家族紹介フォーム – app.js
   ------------------------------------------------------------
   婚活プロフィール本体（selfintroduction/app.js）のUI・LIFF連携・
   共有まわりの実装パターンを踏襲。
   共有リンクは「id（このデータ専用のランダムID）＋復号鍵
   （URLのフラグメント）」のみで構成される。内容は暗号化された
   うえで GAS 経由でスプレッドシートに保存され、復号鍵はサーバー
   に送信されない（URLの # 以降はブラウザからサーバーへ送信され
   ないため）。
   継続的に編集し続けるデータという性質上、id・鍵は端末に保存して
   使い回し、プレビュー画面の送信ボタンを押すたびに同じリンクの
   まま中身だけを最新の内容に更新する。
   ============================================================ */

/* ▼▼▼ 家族紹介用LIFFアプリのID（婚活プロフィールと同じLIFFアプリを
   使う場合はこのままでOK。別のLIFFアプリを作成した場合はここを
   書き換えてください） ▼▼▼ */
const LIFF_ID = "2010606364-4Z0ugW4X";

/* ▼▼▼ 家族紹介用に新しくデプロイしたGAS Web AppのURLをここに設定してください ▼▼▼ */
const GAS_ENDPOINT = "ここに家族紹介用GASのデプロイURLを設定してください";

const STORAGE_KEY            = "family_intro_draft_v1";
const SHARE_INFO_KEY         = "family_intro_share_v1";
const SHARE_VIEW_PENDING_KEY = "family_intro_shared_view_pending_v1";

const RELATION_LIST = ["父","母","兄","姉","弟","妹","祖父","祖母","おじ","おば","その他"];

const EDUCATION_LIST = [
  "中学校卒","高校卒","高専卒","専門学校卒","短期大学卒","大学卒","大学院卒","その他",
];

const TALK_TYPE_LIST = [
  "おしゃべりなタイプ",
  "こちらから話を振れば答えてくれるタイプ",
  "寡黙なタイプ",
];

/* ============================================================
   ユーティリティ
   ============================================================ */
function generateId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}
function escapeHTML(str){
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ------------------------------------------------------------
   スクショ抑止用ウォーターマーク
   ------------------------------------------------------------
   スクリーンショットの撮影自体は検知・ブロックできないため、
   「撮られても誰が・いつ見た画面かが写り込む」ようにし、
   無断転載・拡散への心理的な抑止力として機能させる。
   ------------------------------------------------------------ */
function buildWatermarkSVG(lines){
  const tileW = 240, tileH = 140;
  const lineHeight = 16;
  const startY = tileH / 2 - ((lines.length - 1) * lineHeight) / 2;

  const textEls = lines.map((line, i) => {
    const y = startY + i * lineHeight;
    return `<text x="0" y="${y}" font-size="12" font-family="sans-serif" ` +
           `fill="rgba(0,0,0,0.1)" transform="rotate(-28 ${tileW / 2} ${tileH / 2})">${escapeHTML(line)}</text>`;
  }).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${tileH}">${textEls}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function showScreenshotWatermark(viewerHash){
  const el = document.getElementById("screenshotWatermark");
  if(!el) return;
  const stamp = new Date().toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const lines = [
    "スクショ・転載禁止",
    `${viewerHash.slice(0, 8)}  ${stamp}`,
  ];
  el.style.backgroundImage = `url("${buildWatermarkSVG(lines)}")`;
  el.classList.add("show");
}

/* ============================================================
   Base64URL 変換ユーティリティ（AES鍵・暗号文の符号化に使用）
   ============================================================ */
function bufToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function base64UrlToBuf(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad    = padded.length % 4;
  const fixed  = pad ? padded + "=".repeat(4 - pad) : padded;
  const binary = atob(fixed);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/* ============================================================
   SHA-256ハッシュ（LINE UserIDのハッシュ化。生IDはサーバーに送らない）
   ============================================================ */
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ============================================================
   AES-GCM 暗号化ユーティリティ
   鍵はURLのフラグメント（#以降）＋端末のlocalStorageにのみ保持し、
   サーバーには渡さない。
   ============================================================ */
async function generateShareKey() {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const raw = await crypto.subtle.exportKey("raw", key);
  return { key, base64: bufToBase64Url(raw) };
}
async function importShareKey(base64) {
  const raw = base64UrlToBuf(base64);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
}
async function importShareKeyFull(base64) {
  const raw = base64UrlToBuf(base64);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptJSON(obj, key) {
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(JSON.stringify(obj));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc);
  const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.length);
  return bufToBase64Url(combined.buffer);
}
async function decryptJSON(base64, key) {
  const combined = new Uint8Array(base64UrlToBuf(base64));
  const iv   = combined.slice(0, 12);
  const data = combined.slice(12);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

/* crypto.randomUUID が使えない古い環境用のフォールバック */
function fallbackUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ============================================================
   共有情報（id・鍵）の端末保存
   ============================================================ */
function loadShareInfo() {
  try {
    const raw = localStorage.getItem(SHARE_INFO_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}
function saveShareInfo(info) {
  try { localStorage.setItem(SHARE_INFO_KEY, JSON.stringify(info)); } catch (_) {}
}

/* ============================================================
   データモデル
   ============================================================ */
let createdAt = null;

function createFamilyData(o={}){
  return Object.assign({
    relation:"", relationName:"", birthdate:"", age:"", hometown:"",
    education:"", schoolName:"", currentJob:"", jobHistory:"",
    personality:"", hobby:"", favoriteFood:"", talkType:"",
  }, o);
}

/* ============================================================
   カード描画
   ============================================================ */
function renderFamilyCard(data){
  const tpl  = document.getElementById("familyCardTemplate");
  const node = tpl.content.firstElementChild.cloneNode(true);

  const relSel = node.querySelector(".family-relation");
  relSel.innerHTML =
    `<option value="" disabled ${data.relation?"":"selected"}>続柄を選択</option>` +
    RELATION_LIST.map(r=>`<option value="${escapeHTML(r)}" ${r===data.relation?"selected":""}>${escapeHTML(r)}</option>`).join("");

  const otherF = node.querySelector(".other-relation-field");
  otherF.classList.toggle("hidden", data.relation !== "その他");

  const eduSel = node.querySelector(".family-education");
  eduSel.innerHTML =
    `<option value="" disabled ${data.education?"":"selected"}>選択してください</option>` +
    EDUCATION_LIST.map(e=>`<option value="${escapeHTML(e)}" ${e===data.education?"selected":""}>${escapeHTML(e)}</option>`).join("");

  const talkSel = node.querySelector(".family-talkType");
  talkSel.innerHTML =
    `<option value="" disabled ${data.talkType?"":"selected"}>選択してください</option>` +
    TALK_TYPE_LIST.map(t=>`<option value="${escapeHTML(t)}" ${t===data.talkType?"selected":""}>${escapeHTML(t)}</option>`).join("");

  const fm = {
    ".family-relationName":"relationName",
    ".family-birthdate":"birthdate",
    ".family-age":"age",
    ".family-hometown":"hometown",
    ".family-schoolName":"schoolName",
    ".family-currentJob":"currentJob",
    ".family-jobHistory":"jobHistory",
    ".family-personality":"personality",
    ".family-hobby":"hobby",
    ".family-favoriteFood":"favoriteFood",
  };
  Object.keys(fm).forEach(sel=>{
    const el = node.querySelector(sel);
    if(el) el.value = data[fm[sel]] || "";
  });

  node.dataset.id = data.id || generateId();
  return node;
}

function collectFamilyCard(node){
  const relSel  = node.querySelector(".family-relation");
  const eduSel  = node.querySelector(".family-education");
  const talkSel = node.querySelector(".family-talkType");
  return createFamilyData({
    id: node.dataset.id,
    relation: relSel.value || "",
    relationName: node.querySelector(".family-relationName").value.trim(),
    birthdate: node.querySelector(".family-birthdate").value,
    age: node.querySelector(".family-age").value.trim(),
    hometown: node.querySelector(".family-hometown").value.trim(),
    education: eduSel.value || "",
    schoolName: node.querySelector(".family-schoolName").value.trim(),
    currentJob: node.querySelector(".family-currentJob").value.trim(),
    jobHistory: node.querySelector(".family-jobHistory").value.trim(),
    personality: node.querySelector(".family-personality").value.trim(),
    hobby: node.querySelector(".family-hobby").value.trim(),
    favoriteFood: node.querySelector(".family-favoriteFood").value.trim(),
    talkType: talkSel.value || "",
  });
}

function collectAllFamilyData(){
  return Array.from(document.querySelectorAll("#familyList .family-card")).map(collectFamilyCard);
}

/* ============================================================
   並び替え・削除・追加ボタンの有効/無効更新
   ============================================================ */
function refreshFamilyMoveButtons(){
  const cards = document.querySelectorAll("#familyList .family-card");
  cards.forEach((card,i)=>{
    card.querySelector(".move-up").disabled   = (i === 0);
    card.querySelector(".move-down").disabled = (i === cards.length - 1);
  });
}

function relationDisplay(data){
  return data.relation === "その他"
    ? (data.relationName || "その他")
    : (data.relation || "続柄未設定");
}

/* ============================================================
   カード内イベント（削除・移動・その他続柄表示切替）
   ============================================================ */
function bindFamilyCardEvents(node){
  node.querySelector(".delete-card").addEventListener("click", ()=>{
    if(!confirm("このカードを削除しますか？")) return;
    node.remove();
    refreshFamilyMoveButtons();
    saveDraft();
  });

  node.querySelector(".move-up").addEventListener("click", ()=>{
    const prev = node.previousElementSibling;
    if(prev) node.parentElement.insertBefore(node, prev);
    refreshFamilyMoveButtons();
    saveDraft();
  });
  node.querySelector(".move-down").addEventListener("click", ()=>{
    const next = node.nextElementSibling;
    if(next) node.parentElement.insertBefore(next, node);
    refreshFamilyMoveButtons();
    saveDraft();
  });

  node.querySelector(".family-relation").addEventListener("change", (e)=>{
    node.querySelector(".other-relation-field").classList.toggle("hidden", e.target.value !== "その他");
    saveDraft();
  });
}

function addFamilyCard(data={}){
  const node = renderFamilyCard(createFamilyData(data));
  document.getElementById("familyList").appendChild(node);
  bindFamilyCardEvents(node);
  refreshFamilyMoveButtons();
  return node;
}

/* ============================================================
   下書き保存／復元
   ============================================================ */
function saveDraft(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      list: collectAllFamilyData(),
      createdAt,
    }));
    flashSaved();
  }catch(e){ console.warn("draft save failed", e); }
}
function flashSaved(){
  const b = document.getElementById("saveStatus"); if(!b) return;
  b.classList.add("just-saved"); setTimeout(()=>b.classList.remove("just-saved"), 400);
}
function loadDraft(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY); if(!raw) return false;
    const data = JSON.parse(raw);
    createdAt = data.createdAt || null;
    (data.list||[]).forEach(item=>addFamilyCard(item));
    return (data.list && data.list.length > 0);
  }catch(e){ console.warn("draft load failed", e); return false; }
}

/* ============================================================
   共有データの収集
   ============================================================ */
function collectShareData(){
  return {
    list: collectAllFamilyData(),
    createdAt: createdAt || "",
  };
}
function getFormBaseURL(){ return location.href.split("?")[0].split("#")[0]; }

/* ------------------------------------------------------------
   LINEユーザーIDの取得
   liff.getProfile() はLINEサーバーへの追加API呼び出しが必要で、
   ログイン直後などタイミングによって不安定になりやすい。
   ログイン時に発行されるIDトークンをその場でデコードするだけなら
   通信が発生せず、ユーザーID（sub）を安定して取得できる。
   ------------------------------------------------------------ */
function getLineUserId() {
  const idToken = liff.getDecodedIDToken();
  if (!idToken || !idToken.sub) {
    throw new Error("ID token is not available (sub claim missing)");
  }
  return idToken.sub;
}

/* ============================================================
   共有の公開／更新（GAS連携）
   ------------------------------------------------------------
   ・端末に保存済みのid・鍵があれば使い回そうとする（＝同じ共有
     リンクのまま中身だけ最新化される）。無ければ新規に発行する。
   ・ただし、その保存済みリンクをすでに誰かが開いていた場合は、
     サーバー側が新しいidを発行して返してくる。その場合はここで
     新しいidを採用し、以後はそのidを使い回す（鍵は変えない）。
   ・戻り値: 発行された共有URL
   ============================================================ */
async function publishAndShare(shareName){
  if(!createdAt){ createdAt = new Date().toISOString(); saveDraft(); }

  const shareData = collectShareData();

  let shareInfo = loadShareInfo();
  let cryptoKey;
  if(shareInfo){
    cryptoKey = await importShareKeyFull(shareInfo.key);
  }else{
    const generated = await generateShareKey();
    cryptoKey = generated.key;
    shareInfo = { id: (crypto.randomUUID ? crypto.randomUUID() : fallbackUUID()), key: generated.base64 };
  }

  const cipherText = await encryptJSON(shareData, cryptoKey);

  const userId    = getLineUserId();
  const ownerHash = await sha256Hex(userId);

  const resp = await fetch(GAS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // preflight回避のため text/plain を使用
    body: JSON.stringify({ action: "share", id: shareInfo.id, cipherText, ownerHash }),
  });

  if(!resp.ok){
    // GAS側(doPost)まで届く前にGoogleのゲートウェイ等で弾かれているケース。
    // ここで実際のレスポンス本文をログに出しておくと原因特定に役立つ。
    const bodyText = await resp.text().catch(()=>"(本文を取得できませんでした)");
    console.error(`share request failed: HTTP ${resp.status} ${resp.statusText}`, bodyText);
    throw new Error(`http_${resp.status}`);
  }

  const result = await resp.json();
  if(!result.ok) throw new Error(result.reason || "share_failed");

  // サーバーが新しいidを発行した場合（＝保存済みリンクがすでに誰かに
  // 開かれていたため新しい行になった場合）はそちらを採用する。
  // 鍵は変更しない（同じ鍵をそのまま使い回す）。
  shareInfo = { id: result.id, key: shareInfo.key };
  saveShareInfo(shareInfo);

  const shareURL = `${getFormBaseURL()}?id=${shareInfo.id}#${shareInfo.key}`;
  const name = (shareName||"").trim();
  const previewMsg = name
    ? `${name}さんのご家族紹介が届きました。\n回答をみる→${shareURL}`
    : `ご家族紹介が届きました。\n回答をみる→${shareURL}`;

  return { shareURL, previewMsg, flexMessage: buildShareFlexMessage(name, shareURL) };
}

/* ============================================================
   フォーム要素を隠す（公開ビュー／状態表示に切り替える共通処理）
   ============================================================ */
function showPublicState(title, text, isLoading = false){
  document.getElementById("app").style.display = "none";
  const pv = document.getElementById("publicView");
  pv.style.display = "block";
  pv.innerHTML = `
    <div class="state-card">
      ${isLoading ? `
        <div class="state-spinner">
          <img src="https://developers.line.biz/media/line-mini-app/LINE_spinner_light.svg" class="spinner-light" alt="読み込み中">
          <img src="https://developers.line.biz/media/line-mini-app/LINE_spinner_dark.svg" class="spinner-dark" alt="読み込み中">
        </div>
      ` : ""}
      <p class="state-title">${escapeHTML(title)}</p>
      <p class="state-text">${escapeHTML(text)}</p>
    </div>
  `;
}

/* ============================================================
   共有リンクを開いたときの処理
   ・URLの ?id=... がスプレッドシート上のレコードを指す
   ・URLの #以降 が復号鍵（サーバーには送信されない）
   ・閲覧にはLINEログインが必須（viewerHashによるアクセス制御のため）
   ============================================================ */
async function handleSharedView(id, keyBase64){
  showPublicState("読み込み中…", "内容を確認しています。少々お待ちください。", true);

  if(!keyBase64){
    showPublicState(
      "リンクが不完全です",
      "共有リンクが途中で切れているか、正しくコピーされていない可能性があります。共有した相手にもう一度リンクを送ってもらってください。"
    );
    return;
  }

  try{
    await liff.init({ liffId: LIFF_ID });
  }catch(e){
    console.error("LIFF init failed", e);
    showPublicState("エラー", "LIFFの初期化に失敗しました。時間をおいて再度お試しください。");
    return;
  }

  if(!liff.isLoggedIn()){ liff.login(); return; }

  // ここまで来ればリダイレクトは発生しないはずなので、一時保存していた
  // 復元用の情報は不要になる（消し忘れて別のリンクに誤って使われるのを防ぐ）
  try{ sessionStorage.removeItem(SHARE_VIEW_PENDING_KEY); }catch(_){}

  let key;
  try{
    key = await importShareKey(keyBase64);
  }catch(e){
    console.error("key import error", e);
    showPublicState("リンクが正しくありません", "共有リンクが壊れている可能性があります。");
    return;
  }

  let viewerHash;
  try{
    const userId = getLineUserId();
    viewerHash = await sha256Hex(userId);
  }catch(e){
    console.error("get user id error", e);
    showPublicState(
      "エラー",
      "LINEアカウント情報の確認に失敗しました。時間をおいてもう一度お試しください。" +
      "（詳細: " + (e && e.message ? e.message : String(e)) + "）"
    );
    return;
  }

  let result;
  try{
    const url = `${GAS_ENDPOINT}?action=view&id=${encodeURIComponent(id)}&viewerHash=${encodeURIComponent(viewerHash)}`;
    const resp = await fetch(url, { method: "GET" });
    result = await resp.json();
  }catch(e){
    console.error("fetch view error", e);
    showPublicState("通信エラー", "内容を取得できませんでした。通信環境を確認してもう一度お試しください。");
    return;
  }

  if(!result.ok){
    if(result.reason === "forbidden"){
      showPublicState(
        "閲覧できません",
        "このリンクは最初に開いた方専用です。転送されたリンクは、その方以外は閲覧できない仕組みになっています。"
      );
    }else if(result.reason === "partner_locked"){
      showPublicState(
        "閲覧できません",
        "このリンクは現在のお相手専用です。"
      );
    }else if(result.reason === "revoked" || result.reason === "expired" || result.reason === "deleted"){
      showPublicState("リンクが無効です", "このリンクはすでに無効になっています。最新の共有リンクを送ってもらってください。");
    }else if(result.reason === "not_found"){
      showPublicState("リンクが見つかりません", "このリンクは存在しないか、削除された可能性があります。");
    }else{
      showPublicState("エラー", "内容を取得できませんでした。時間をおいて再度お試しください。");
    }
    return;
  }

  let data;
  try{
    data = await decryptJSON(result.cipherText, key);
  }catch(e){
    console.error("decrypt error", e);
    showPublicState("復号に失敗しました", "リンクの一部が正しくない可能性があります。共有した相手にもう一度リンクを送ってもらってください。");
    return;
  }

  renderPublicView(data);
  showScreenshotWatermark(viewerHash);
}

/* ============================================================
   表示用 HTML ビルダー
   ============================================================ */
function decoFlourishSVG(){
  return `<svg viewBox="0 0 160 28" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 14 C32 3,50 25,76 13 S122 1,154 14" fill="none" stroke="#f4b8c5" stroke-width="2" stroke-linecap="round"/>
    <circle cx="24" cy="9" r="2.6" fill="#f48ca0"/><circle cx="58" cy="19" r="2.6" fill="#f48ca0"/>
    <circle cx="96" cy="8" r="2.6" fill="#f48ca0"/><circle cx="132" cy="18" r="2.6" fill="#f48ca0"/>
  </svg>`;
}

function formatDateLabel(iso){
  if(!iso) return "";
  const d = new Date(iso);
  if(isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
}

function fieldRow(label, value){
  if(!value) return "";
  return `<div class="field-row"><span class="field-row-label">${escapeHTML(label)}</span><span class="field-row-value">${escapeHTML(value).replace(/\n/g,"<br>")}</span></div>`;
}

function buildFamilyListHTML(list){
  if(!list || list.length === 0){
    return `<div class="family-preview-empty">まだ家族カードが登録されていません。<br>「入力」タブから追加してください。</div>`;
  }
  return `<div class="family-preview-list">` + list.map(d=>{
    const birthAge = [d.birthdate ? d.birthdate.replace(/-/g,"/") : "", d.age ? `${d.age}歳` : ""].filter(Boolean).join("　");
    const eduLine  = [d.education, d.schoolName].filter(Boolean).join("　");
    return `
      <div class="family-preview-card">
        <div class="family-preview-heading">
          <span class="family-relation-badge">${escapeHTML(relationDisplay(d))}</span>
        </div>
        ${fieldRow("生年月日・年齢", birthAge)}
        ${fieldRow("出身", d.hometown)}
        ${fieldRow("最終学歴", eduLine)}
        ${fieldRow("現職", d.currentJob)}
        ${fieldRow("職歴", d.jobHistory)}
        ${fieldRow("性格", d.personality)}
        ${fieldRow("趣味", d.hobby)}
        ${fieldRow("好きな食べ物", d.favoriteFood)}
        ${fieldRow("話すタイプ", d.talkType)}
      </div>`;
  }).join("") + `</div>`;
}

/* ============================================================
   プレビュー・公開ビュー 共通の描画
   ============================================================ */
function renderFamilyContent(container, list, opts={}){
  const { showViewerCTA=false } = opts;
  const dateLabel = formatDateLabel(createdAt||"");

  container.innerHTML = `
    <div class="family-view-header">
      <div class="family-view-header-deco">${decoFlourishSVG()}</div>
      <p class="family-view-title">家族紹介</p>
      <p class="family-view-sub">FAMILY INTRODUCTION</p>
      ${dateLabel ? `<p class="family-view-date">作成日：${escapeHTML(dateLabel)}</p>` : ""}
    </div>
    ${buildFamilyListHTML(list)}
    ${showViewerCTA ? `
    <div class="cta-card">
      <p class="cta-title">あなたも家族紹介を作ってみませんか？</p>
      <p class="cta-text">ご家族お一人おひとりの人柄を、まとめてお相手に届けられます。</p>
      <button type="button" class="btn-primary cta-btn" id="ctaCreateBtn">私も作成する</button>
    </div>` : ""}
  `;

  if(showViewerCTA){
    const btn = container.querySelector("#ctaCreateBtn");
    if(btn) btn.addEventListener("click", ()=>{ location.href = getFormBaseURL(); });
  }
}

function renderFamilyPreview(){
  renderFamilyContent(document.getElementById("previewContent"), collectAllFamilyData(), { showViewerCTA:false });
}

function renderPublicView(shared){
  document.getElementById("app").style.display = "none";
  const pv = document.getElementById("publicView");
  pv.style.display = "block";
  createdAt = shared.createdAt || null;
  renderFamilyContent(pv, shared.list||[], { showViewerCTA:true });
}

/* ============================================================
   タブ切替
   ============================================================ */
function switchTab(tab){
  ["input","preview","settings"].forEach(t=>{
    document.getElementById(`tab-${t}`).classList.toggle("hidden", t !== tab);
  });
  document.querySelectorAll(".nav-btn").forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  const titles = { preview:"プレビュー", settings:"設定" };
  document.getElementById("appBarTitle").textContent = titles[tab] || "家族紹介";

  if(tab === "preview"){
    if(!createdAt){ createdAt = new Date().toISOString(); saveDraft(); }
    renderFamilyPreview();
  }
}

/* ============================================================
   イベント登録
   ============================================================ */
function bindEvents(){
  document.getElementById("addFamilyBtn").addEventListener("click", ()=>{
    addFamilyCard();
    saveDraft();
  });

  let saveTimer = null;
  document.getElementById("tab-input").addEventListener("input", ()=>{
    clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 500);
  });
  document.getElementById("tab-input").addEventListener("change", ()=>{
    clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 500);
  });

  document.querySelectorAll(".nav-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>switchTab(btn.dataset.tab));
  });
  document.getElementById("backToInputBtn").addEventListener("click", ()=>switchTab("input"));

  /* ----- 送信ボタン（プレビュー画面上部） ----- */
  document.getElementById("sendBtn").addEventListener("click", ()=>{
    const modal = document.getElementById("shareModal");
    document.getElementById("shareName").value = "";
    modal.classList.remove("hidden");
    modal.classList.add("show");
  });

  /* ----- 共有モーダル：共有する ----- */
  document.getElementById("shareBtn").addEventListener("click", async()=>{
    const shareBtn = document.getElementById("shareBtn");
    const shareName = document.getElementById("shareName").value;

    shareBtn.disabled = true;
    const originalLabel = shareBtn.textContent;
    shareBtn.textContent = "送信中…";

    try{
      const { flexMessage, previewMsg, shareURL } = await publishAndShare(shareName);

      const modal = document.getElementById("shareModal");
      modal.classList.remove("show");
      modal.classList.add("hidden");

      const lineURL = `https://line.me/R/msg/text/?${encodeURIComponent(previewMsg)}`;
      await shareToOthers(flexMessage, previewMsg, lineURL);
    }catch(e){
      console.error("share error", e);
      alert("送信に失敗しました。通信環境を確認してもう一度お試しください。");
    }finally{
      shareBtn.disabled = false;
      shareBtn.textContent = originalLabel;
    }
  });

  /* ----- モーダル外クリックで閉じる ----- */
  document.getElementById("shareModal").addEventListener("click", (e)=>{
    if(e.target === e.currentTarget){
      e.currentTarget.classList.remove("show");
      e.currentTarget.classList.add("hidden");
    }
  });

  document.getElementById("resetFamilyBtn").addEventListener("click", ()=>{
    if(!confirm("入力内容を削除して最初から作成しますか？この操作は取り消せません。")) return;
    try{ localStorage.removeItem(STORAGE_KEY); }catch(_){}
    try{ localStorage.removeItem(SHARE_INFO_KEY); }catch(_){}
    location.href = getFormBaseURL();
  });
}

/* ============================================================
   共有：シェアターゲットピッカー用 Flexメッセージ
   長い共有URLはボタン(uriアクション)の中に格納するため、
   相手に見える本文には長いリンクが表示されない。
   ※ uriアクションのURLは1000文字以内という制限があるため、
     超える場合は liff.shareTargetPicker 側でエラーになり、
     呼び出し元で従来のURLスキーム方式にフォールバックする。
   ※ hero画像のURLは、LINEのサーバーから読み込める公開HTTPS URL
     である必要がある（ローカルパスや相対パスは不可）。
     画像は1MB以下を推奨。PNGの透過部分はそのまま送ると
     反映されない場合があるため、白背景に合成したJPEGを使用する。
   ============================================================ */
const SHARETARGETPICKER_IMAGE_URL = "https://marriagesketch.github.io/-familyintroduction-/sharetargetpicker.jpg";

function buildShareFlexMessage(name, shareURL){
  const nameLine = name ? `${name}さんのご家族紹介が届きました` : "ご家族紹介が届きました";

  return {
    type: "flex",
    altText: `家族紹介 - ${nameLine}`,
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: SHARETARGETPICKER_IMAGE_URL,
        size: "full",
        aspectRatio: "3:2",
        aspectMode: "cover"
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "20px",
        contents: [
          { type: "text", text: "家族紹介", size: "xs", weight: "bold", color: "#d96c7d" },
          { type: "text", text: nameLine, size: "lg", weight: "bold", wrap: true, margin: "sm" },
          { type: "text", text: "ボタンから内容を確認できます。", size: "sm", color: "#888888", wrap: true, margin: "md" }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "20px",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: "#f48ca0",
            action: { type: "uri", label: "回答をみる", uri: shareURL }
          }
        ]
      }
    }
  };
}

/* ------------------------------------------------------------
   共有先を選んで送信する
   1. シェアターゲットピッカーが使える場合、まずFlexメッセージ
      （カード形式）での送信を試みる
   2. Flexが失敗した場合（URLが長すぎる等）は、同じ複数選択画面の
      ままテキストメッセージとして再送信を試みる
      （テキストメッセージにはFlexボタンのuriのような1000文字の
      制限が無いため、Flexで失敗したケースでも通りやすい）
   3. それでも失敗した場合、または端末がシェアターゲットピッカー
      自体に対応していない場合は、従来のURLスキーム方式（送信先を
      選択画面を開いてテキストメッセージを送る）にフォールバック
   ------------------------------------------------------------ */
async function shareToOthers(flexMessage, textPreviewMsg, fallbackLineSchemeURL){
  if(liff.isApiAvailable("shareTargetPicker")){
    try{
      await liff.shareTargetPicker([flexMessage], { isMultiple: true });
      return;
    }catch(e){
      console.warn("shareTargetPicker (flex) failed, retrying as text:", e);
    }

    try{
      await liff.shareTargetPicker(
        [{ type: "text", text: textPreviewMsg }],
        { isMultiple: true }
      );
      return;
    }catch(e){
      console.warn("shareTargetPicker (text) failed, falling back to URL scheme:", e);
    }
  }

  if(liff.isInClient()){ window.location.href = fallbackLineSchemeURL; }
  else{ window.open(fallbackLineSchemeURL, "_blank"); }
}

/* ============================================================
   友だち追加チェック
   ※ LIFF初期化・ログイン済みの状態で呼び出すこと（liff.init は呼ばない）
   ============================================================ */
async function checkFriendship(){
  try{
    const friendship = await liff.getFriendship();
    if(!friendship.friendFlag){
      try{
        await liff.requestFriendship();
      }catch(error){
        console.warn("友だち追加リクエスト失敗（ユーザーがキャンセルした可能性があります）:", error);
      }
    }
  }catch(error){
    console.warn("友だち確認をスキップ:", error);
  }
}

/* ============================================================
   メイン処理
   ============================================================ */
(async()=>{
  const params = new URLSearchParams(location.search);
  let sharedId  = params.get("id");
  let keyBase64 = location.hash ? location.hash.slice(1) : "";

  // liff.init()/liff.login() が内部でリダイレクト（ログイン・友だち追加など）
  // を行うと、URLのクエリ(id)やフラグメント(復号鍵)が失われることがある。
  // そのため、リダイレクト前に一度sessionStorageへ保存しておき、リダイレクト
  // 後に情報が欠けていたらそこから補完する。
  let pending = null;
  try{ pending = JSON.parse(sessionStorage.getItem(SHARE_VIEW_PENDING_KEY) || "null"); }catch(_){}

  if(sharedId && keyBase64){
    try{ sessionStorage.setItem(SHARE_VIEW_PENDING_KEY, JSON.stringify({ id: sharedId, key: keyBase64 })); }catch(_){}
  }else if(pending && (!sharedId || pending.id === sharedId)){
    if(!sharedId)  sharedId  = pending.id;
    if(!keyBase64) keyBase64 = pending.key;
  }

  if(sharedId){ await handleSharedView(sharedId, keyBase64); return; }

  try{ await liff.init({ liffId: LIFF_ID }); }
  catch(e){ console.error("LIFF init failed", e); alert("LIFFの初期化に失敗しました。"); return; }

  if(!liff.isLoggedIn()){ liff.login(); return; }

  /* LIFF初期化・ログイン後に友だち確認（未追加ならダイアログで追加を促す）
     liff.getFriendship() / requestFriendship() はLINEサーバーへの通信を
     伴うため、ここをawaitすると電波が悪い時に画面表示自体が止まって
     しまう。必須の処理ではないので、裏側で実行させて画面構築は
     先に進める（fire-and-forget）。 */
  checkFriendship();

  const hadDraft = loadDraft();

  bindEvents();

  const startBtn  = document.getElementById("startBtn");
  const resumeBtn = document.getElementById("resumeBtn");
  if(hadDraft){ resumeBtn.classList.remove("hidden"); startBtn.textContent = "新しく作成する"; }

  function goToMain(){
    document.getElementById("screen-top").classList.add("hidden");
    document.getElementById("screen-main").classList.remove("hidden");
    switchTab("input");
  }

  startBtn.addEventListener("click", ()=>{
    if(hadDraft && !confirm("これまでの下書きを削除して、新しく作成しますか？")) return;
    if(hadDraft){
      document.getElementById("familyList").innerHTML = "";
      createdAt = null;
      try{ localStorage.removeItem(STORAGE_KEY); }catch(_){}
      try{ localStorage.removeItem(SHARE_INFO_KEY); }catch(_){}
    }
    goToMain();
  });
  resumeBtn.addEventListener("click", goToMain);
})();
