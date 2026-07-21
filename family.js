/* ============================================================
   家族紹介フォーム – family.js
   自分史カード（app.js）の構成（テンプレート複製・▲▼並び替え・
   削除・自動保存）を参考に、家族紹介用として作成。
   ============================================================ */

const FAMILY_STORAGE_KEY = "family_intro_draft_v1";

const RELATION_LIST = ["父","母","兄","姉","弟","妹","祖父","祖母","おじ","おば","その他"];

const EDUCATION_LIST = [
  "中学校卒","高校卒","高専卒","専門学校卒","短期大学卒","大学卒","大学院卒","その他",
];

const TALK_TYPE_LIST = [
  "おしゃべりなタイプ",
  "こちらから話を振れば答えてくれるタイプ",
  "寡黙なタイプ",
];

const FAMILY_FIELD_ORDER = [
  "relation","relationName","birthdate","age","hometown",
  "education","schoolName","currentJob","jobHistory",
  "personality","hobby","favoriteFood","talkType",
];

/* ---- ユーティリティ ---- */
function generateId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}
function escapeHTML(str){
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function calcAgeFromBirthdate(birthdateStr){
  if(!birthdateStr) return "";
  const bd = new Date(birthdateStr);
  if(isNaN(bd.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - bd.getFullYear();
  const m = today.getMonth() - bd.getMonth();
  if(m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
  return age >= 0 ? String(age) : "";
}

/* ============================================================
   データモデル
   ============================================================ */
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
  const relSel = node.querySelector(".family-relation");
  const eduSel = node.querySelector(".family-education");
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
   カード内イベント（削除・移動・生年月日→年齢）
   ============================================================ */
function bindFamilyCardEvents(node){
  node.querySelector(".delete-card").addEventListener("click", ()=>{
    if(!confirm("このカードを削除しますか？")) return;
    node.remove();
    refreshFamilyMoveButtons();
    scheduleSaveFamilyDraft();
    if(document.getElementById("tab-preview") && !document.getElementById("tab-preview").classList.contains("hidden")){
      renderFamilyPreview();
    }
  });

  node.querySelector(".move-up").addEventListener("click", ()=>{
    const prev = node.previousElementSibling;
    if(prev) node.parentElement.insertBefore(node, prev);
    refreshFamilyMoveButtons();
    scheduleSaveFamilyDraft();
  });
  node.querySelector(".move-down").addEventListener("click", ()=>{
    const next = node.nextElementSibling;
    if(next) node.parentElement.insertBefore(next, node);
    refreshFamilyMoveButtons();
    scheduleSaveFamilyDraft();
  });

  node.querySelector(".family-relation").addEventListener("change", (e)=>{
    node.querySelector(".other-relation-field").classList.toggle("hidden", e.target.value !== "その他");
    scheduleSaveFamilyDraft();
  });

  node.querySelector(".family-birthdate").addEventListener("change", (e)=>{
    const ageEl = node.querySelector(".family-age");
    const calced = calcAgeFromBirthdate(e.target.value);
    if(calced !== "") ageEl.value = calced;
    scheduleSaveFamilyDraft();
  });

  node.querySelectorAll("input, textarea, select").forEach(el=>{
    el.addEventListener("input", scheduleSaveFamilyDraft);
    el.addEventListener("change", scheduleSaveFamilyDraft);
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
   自動保存（下書き）
   ============================================================ */
let familySaveTimer = null;
function scheduleSaveFamilyDraft(){
  const statusEl = document.getElementById("saveStatus");
  if(statusEl) statusEl.classList.remove("just-saved");
  clearTimeout(familySaveTimer);
  familySaveTimer = setTimeout(()=>{
    saveFamilyDraft();
    if(statusEl){
      statusEl.classList.add("just-saved");
    }
  }, 400);
}

function saveFamilyDraft(){
  try{
    const data = collectAllFamilyData();
    localStorage.setItem(FAMILY_STORAGE_KEY, JSON.stringify(data));
  }catch(_){/* 保存領域が使えない環境は無視 */}
}

function loadFamilyDraft(){
  let list = [];
  try{
    const raw = localStorage.getItem(FAMILY_STORAGE_KEY);
    if(raw) list = JSON.parse(raw);
  }catch(_){ list = []; }

  if(Array.isArray(list) && list.length){
    list.forEach(item=>addFamilyCard(item));
    return true;
  }
  return false;
}

/* ============================================================
   プレビュー描画
   ============================================================ */
function fieldRow(label, value){
  if(!value) return "";
  return `<div class="field-row"><span class="field-row-label">${escapeHTML(label)}</span><span class="field-row-value">${escapeHTML(value).replace(/\n/g,"<br>")}</span></div>`;
}

function renderFamilyPreview(){
  const wrap = document.getElementById("familyPreview");
  const list = collectAllFamilyData();

  if(list.length === 0){
    wrap.innerHTML = `<div class="family-preview-empty">まだ家族カードが登録されていません。<br>「入力」タブから追加してください。</div>`;
    return;
  }

  wrap.innerHTML = `<div class="family-preview-list">` + list.map(d=>{
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
   タブ切替
   ============================================================ */
function switchFamilyTab(tab){
  document.querySelectorAll(".sub-switch-btn").forEach(b=>b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("tab-input").classList.toggle("hidden", tab !== "input");
  document.getElementById("tab-preview").classList.toggle("hidden", tab !== "preview");
  if(tab === "preview") renderFamilyPreview();
}

/* ============================================================
   初期化
   ============================================================ */
(function(){
  document.querySelectorAll(".sub-switch-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>switchFamilyTab(btn.dataset.tab));
  });

  document.getElementById("addFamilyBtn").addEventListener("click", ()=>{
    addFamilyCard();
    scheduleSaveFamilyDraft();
  });

  document.getElementById("resetFamilyBtn").addEventListener("click", ()=>{
    if(!confirm("入力内容をすべて削除しますか？この操作は取り消せません。")) return;
    document.getElementById("familyList").innerHTML = "";
    try{ localStorage.removeItem(FAMILY_STORAGE_KEY); }catch(_){}
    renderFamilyPreview();
  });

  const hadDraft = loadFamilyDraft();
  if(!hadDraft){
    addFamilyCard({ relation:"父" });
    addFamilyCard({ relation:"母" });
  }
})();
