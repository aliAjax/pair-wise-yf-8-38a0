// 试映排期台 · 页面
// 只负责渲染与交互；规则走 Screening（ScreeningRules），存档走 ScreeningStore。
const Rules = window.ScreeningRules;
const Store = window.ScreeningStore;

let state = Store.load();
let batch = []; // 待存批次：只在内存里，点“保存排期”时整批校验

const els = {
  statScheduled: document.querySelector("#statScheduled"),
  statPending: document.querySelector("#statPending"),
  statDone: document.querySelector("#statDone"),
  statUnrepaired: document.querySelector("#statUnrepaired"),
  segmentList: document.querySelector("#segmentList"),
  scheduleForm: document.querySelector("#scheduleForm"),
  segmentSelect: document.querySelector("#segmentSelect"),
  hallSelect: document.querySelector("#hallSelect"),
  projectionistSelect: document.querySelector("#projectionistSelect"),
  dateInput: document.querySelector("#dateInput"),
  startInput: document.querySelector("#startInput"),
  endHint: document.querySelector("#endHint"),
  saveBatchBtn: document.querySelector("#saveBatchBtn"),
  clearBatchBtn: document.querySelector("#clearBatchBtn"),
  batchErrors: document.querySelector("#batchErrors"),
  batchList: document.querySelector("#batchList"),
  scheduleList: document.querySelector("#scheduleList"),
  scheduleCount: document.querySelector("#scheduleCount"),
  reminderList: document.querySelector("#reminderList"),
  hallLoads: document.querySelector("#hallLoads"),
  notice: document.querySelector("#notice")
};

function todayStr() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatDate(dateStr) {
  const [, month, day] = String(dateStr || "").split("-");
  return month && day ? `${Number(month)}月${Number(day)}日` : dateStr;
}

function findSegment(id) {
  return state.segments.find((item) => item.id === id);
}

function findHall(id) {
  return state.halls.find((item) => item.id === id);
}

function findProjectionist(id) {
  return state.projectionists.find((item) => item.id === id);
}

function showNotice(text, isError) {
  els.notice.textContent = text;
  els.notice.classList.toggle("error", Boolean(isError));
  els.notice.hidden = false;
}

function renderStats() {
  const stats = Rules.computeStats(state);
  els.statScheduled.textContent = stats.scheduled;
  els.statPending.textContent = stats.pending;
  els.statDone.textContent = stats.done;
  els.statUnrepaired.textContent = stats.unrepaired;
}

function renderSelects() {
  const keep = {
    segment: els.segmentSelect.value,
    hall: els.hallSelect.value,
    projectionist: els.projectionistSelect.value
  };
  els.segmentSelect.innerHTML = state.segments
    .map((seg) => `<option value="${seg.id}">${escapeHtml(seg.code)}｜${seg.duration}分钟${seg.repaired ? "" : "｜未修复"}</option>`)
    .join("");
  els.hallSelect.innerHTML = state.halls
    .map((hall) => `<option value="${hall.id}">${escapeHtml(hall.name)}｜容量${hall.capacity}分钟</option>`)
    .join("");
  els.projectionistSelect.innerHTML = state.projectionists
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join("");
  if (state.segments.some((s) => s.id === keep.segment)) els.segmentSelect.value = keep.segment;
  if (state.halls.some((h) => h.id === keep.hall)) els.hallSelect.value = keep.hall;
  if (state.projectionists.some((p) => p.id === keep.projectionist)) els.projectionistSelect.value = keep.projectionist;
}

function renderSegments() {
  els.segmentList.innerHTML = state.segments
    .map(
      (seg) => `
        <article class="segment-card ${seg.repaired ? "" : "unrepaired"}">
          <div class="segment-title">
            <strong>${escapeHtml(seg.code)}</strong>
            <span class="tag ${seg.repaired ? "ok" : "damage"}">${seg.repaired ? "已修复" : "未修复"}</span>
          </div>
          <p class="segment-note">${escapeHtml(seg.note || "")}</p>
          <div class="segment-edit">
            <label>
              时长(分钟)
              <input type="number" min="1" value="${seg.duration}" data-duration="${seg.id}" />
            </label>
            <label class="repair-toggle">
              <input type="checkbox" ${seg.repaired ? "checked" : ""} data-repaired="${seg.id}" />
              已修复
            </label>
          </div>
        </article>
      `
    )
    .join("");
}

function renderBatch() {
  els.batchList.innerHTML =
    batch
      .map((item, index) => {
        const seg = findSegment(item.segmentId);
        const hall = findHall(item.hallId);
        const proj = findProjectionist(item.projectionistId);
        const end = seg ? Rules.toTimeStr(Rules.toMinutes(item.start) + Number(seg.duration)) : "?";
        return `
          <div class="batch-row">
            <span>「${escapeHtml(seg ? seg.code : "?")}」${formatDate(item.date)} ${item.start}–${end} · ${escapeHtml(hall ? hall.name : "?")} · ${escapeHtml(proj ? proj.name : "?")}</span>
            <button type="button" title="移出批次" data-batch-remove="${index}">×</button>
          </div>
        `;
      })
      .join("") || `<p class="empty">批次为空。用上方表单加入场次，点“保存排期”整批校验入库。</p>`;
}

function renderBatchErrors(errors) {
  if (!errors.length) {
    els.batchErrors.hidden = true;
    els.batchErrors.innerHTML = "";
    return;
  }
  els.batchErrors.hidden = false;
  els.batchErrors.innerHTML = `<strong>整批未保存，原排期未改动：</strong><ul>${errors
    .map((err) => `<li>${escapeHtml(err)}</li>`)
    .join("")}</ul>`;
}

function renderSchedule() {
  const sorted = [...state.screenings].sort(
    (a, b) => a.date.localeCompare(b.date) || Rules.toMinutes(a.start) - Rules.toMinutes(b.start)
  );
  els.scheduleCount.textContent = sorted.length ? `共 ${sorted.length} 场` : "";
  els.scheduleList.innerHTML =
    sorted
      .map((s) => {
        const seg = findSegment(s.segmentId);
        const hall = findHall(s.hallId);
        const proj = findProjectionist(s.projectionistId);
        const end = Rules.toTimeStr(Rules.endOf(s));
        const actions =
          s.status === "scheduled"
            ? `<button type="button" data-done="${s.id}">标记完成</button><button type="button" data-delete="${s.id}">删除</button>`
            : s.status === "pending"
              ? `<button type="button" data-reschedule="${s.id}">重新排定</button><button type="button" data-delete="${s.id}">删除</button>`
              : "";
        return `
          <article class="schedule-row ${s.status}">
            <span class="tag status-${s.status}">${Rules.STATUS_LABELS[s.status]}</span>
            <div class="schedule-main">
              <strong>「${escapeHtml(seg ? seg.code : "未知片段")}」</strong>
              <span>${formatDate(s.date)} ${s.start}–${end} · ${escapeHtml(hall ? hall.name : "?")} · ${escapeHtml(proj ? proj.name : "?")}</span>
            </div>
            <div class="schedule-actions">${actions}</div>
          </article>
        `;
      })
      .join("") || `<p class="empty">还没有排期。</p>`;
}

function renderReminders() {
  const reminders = Rules.buildReminders(state);
  els.reminderList.innerHTML =
    reminders
      .map((item) => `<div class="warning-item ${item.type}"><span>${escapeHtml(item.text)}</span></div>`)
      .join("") || `<p class="empty">暂无提醒。</p>`;
}

function renderLoads() {
  const loads = Rules.hallLoads(state);
  els.hallLoads.innerHTML =
    loads
      .map((load) => {
        const percent = load.capacity > 0 ? Math.min(100, Math.round((load.minutes / load.capacity) * 100)) : 0;
        return `
          <div class="load-item">
            <div class="load-head">
              <strong>${escapeHtml(load.hall.name)}</strong>
              <span>${formatDate(load.date)} · ${load.minutes}/${load.capacity} 分钟</span>
            </div>
            <div class="load-bar"><span style="width:${percent}%"></span></div>
          </div>
        `;
      })
      .join("") || `<p class="empty">还没有占用影厅的场次。</p>`;
}

function updateEndHint() {
  const seg = findSegment(els.segmentSelect.value);
  const startMin = Rules.toMinutes(els.startInput.value);
  if (!seg || Number.isNaN(startMin)) {
    els.endHint.textContent = "";
    return;
  }
  els.endHint.textContent = `连续时段 ${els.startInput.value}–${Rules.toTimeStr(startMin + Number(seg.duration))}（${seg.duration} 分钟）`;
}

function renderAll() {
  Store.save(state);
  renderStats();
  renderSelects();
  renderSegments();
  renderBatch();
  renderSchedule();
  renderReminders();
  renderLoads();
  updateEndHint();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 片段修复状态或时长变化 → 未来场次退回待排，已完成保留
els.segmentList.addEventListener("change", (event) => {
  const durationInput = event.target.closest("[data-duration]");
  const repairInput = event.target.closest("[data-repaired]");
  const target = durationInput || repairInput;
  if (!target) return;
  const id = target.dataset.duration || target.dataset.repaired;
  const seg = findSegment(id);
  if (!seg) return;

  let changeText = "";
  if (durationInput) {
    const value = Math.max(1, Number(durationInput.value) || 1);
    if (value === seg.duration) return;
    seg.duration = value;
    changeText = `片段 ${seg.code} 时长改为 ${value} 分钟`;
  } else {
    if (repairInput.checked === seg.repaired) return;
    seg.repaired = repairInput.checked;
    changeText = `片段 ${seg.code} ${seg.repaired ? "标记为已修复" : "标记为未修复"}`;
  }
  const reverted = Rules.revertFutureScreenings(state, seg.id);
  renderAll();
  showNotice(reverted ? `${changeText}，${reverted} 场未来场次退回待排。` : `${changeText}。`);
});

els.scheduleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  batch.push({
    segmentId: els.segmentSelect.value,
    hallId: els.hallSelect.value,
    projectionistId: els.projectionistSelect.value,
    date: els.dateInput.value,
    start: els.startInput.value
  });
  renderBatchErrors([]);
  renderBatch();
});

els.saveBatchBtn.addEventListener("click", () => {
  const result = Rules.validateBatch(state, batch);
  if (!result.ok) {
    renderBatchErrors(result.errors);
    showNotice("整批未保存，原排期未改动。", true);
    return;
  }
  for (const item of batch) {
    const seg = findSegment(item.segmentId);
    state.screenings.push({
      id: crypto.randomUUID(),
      ...item,
      duration: Number(seg.duration),
      status: "scheduled"
    });
  }
  const count = batch.length;
  batch = [];
  renderBatchErrors([]);
  renderAll();
  showNotice(`已保存 ${count} 场排期。`);
});

els.clearBatchBtn.addEventListener("click", () => {
  batch = [];
  renderBatchErrors([]);
  renderBatch();
});

els.batchList.addEventListener("click", (event) => {
  const removeBtn = event.target.closest("[data-batch-remove]");
  if (!removeBtn) return;
  batch.splice(Number(removeBtn.dataset.batchRemove), 1);
  renderBatch();
});

els.scheduleList.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-done],[data-reschedule],[data-delete]");
  if (!btn) return;
  const id = btn.dataset.done || btn.dataset.reschedule || btn.dataset.delete;
  const doneBtn = btn.dataset.done ? btn : null;
  const rescheduleBtn = btn.dataset.reschedule ? btn : null;
  const deleteBtn = btn.dataset.delete ? btn : null;
  const screening = state.screenings.find((s) => s.id === id);
  if (!screening) return;

  if (doneBtn) {
    screening.status = "done";
    renderAll();
    showNotice("场次已标记完成。");
    return;
  }
  if (deleteBtn) {
    state.screenings = state.screenings.filter((s) => s.id !== id);
    renderAll();
    showNotice("场次已删除。");
    return;
  }
  if (rescheduleBtn) {
    const draft = {
      segmentId: screening.segmentId,
      hallId: screening.hallId,
      projectionistId: screening.projectionistId,
      date: screening.date,
      start: screening.start
    };
    const result = Rules.validateBatch(state, [draft]);
    if (!result.ok) {
      showNotice(`无法重新排定：${result.errors.join(" ")}`, true);
      return;
    }
    const seg = findSegment(screening.segmentId);
    screening.duration = Number(seg.duration);
    screening.status = "scheduled";
    renderAll();
    showNotice("场次已重新排定。");
  }
});

els.segmentSelect.addEventListener("change", updateEndHint);
els.startInput.addEventListener("input", updateEndHint);
els.notice.addEventListener("click", () => {
  els.notice.hidden = true;
});

els.dateInput.value = todayStr();
renderAll();
