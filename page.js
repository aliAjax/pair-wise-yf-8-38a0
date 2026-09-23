/*
 * 试映排期台 —— 页面
 * DOM 渲染与交互全部在这里；业务判定调用 Rules，持久化调用 Archive。
 */
(function () {
  "use strict";

  const Rules = window.Rules;
  const Archive = window.Archive;
  const esc = Rules.escapeHtml;
  const fallbackThumbs = ["#d49b35", "#347d89", "#b54d48", "#4d7656", "#6d6378"];

  let state = Archive.load();
  let draggedId = null;
  // 待提交的排片行（只存在于内存，未通过校验绝不写入 state）
  let draftRows = [];

  const els = {
    reelTitle: document.querySelector("#reelTitle"),
    colorFilter: document.querySelector("#colorFilter"),
    searchInput: document.querySelector("#searchInput"),
    exportBtn: document.querySelector("#exportBtn"),
    exportJsonBtn: document.querySelector("#exportJsonBtn"),
    importJsonBtn: document.querySelector("#importJsonBtn"),
    importFile: document.querySelector("#importFile"),
    segmentForm: document.querySelector("#segmentForm"),
    codeInput: document.querySelector("#codeInput"),
    durationInput: document.querySelector("#durationInput"),
    shiftInput: document.querySelector("#shiftInput"),
    damageInput: document.querySelector("#damageInput"),
    repairedInput: document.querySelector("#repairedInput"),
    thumbInput: document.querySelector("#thumbInput"),
    noteInput: document.querySelector("#noteInput"),
    segmentList: document.querySelector("#segmentList"),
    batchRows: document.querySelector("#batchRows"),
    addRowBtn: document.querySelector("#addRowBtn"),
    clearRowsBtn: document.querySelector("#clearRowsBtn"),
    planBtn: document.querySelector("#planBtn"),
    batchResult: document.querySelector("#batchResult"),
    hallFilter: document.querySelector("#hallFilter"),
    scheduleTable: document.querySelector("#scheduleTable"),
    hallStats: document.querySelector("#hallStats"),
    warningList: document.querySelector("#warningList"),
    statScheduled: document.querySelector("#statScheduled"),
    statPending: document.querySelector("#statPending"),
    statCompleted: document.querySelector("#statCompleted"),
    statScheduledSeconds: document.querySelector("#statScheduledSeconds")
  };

  /* ---------- 片段 ---------- */

  function getFilteredSegments() {
    const color = els.colorFilter.value;
    const keyword = els.searchInput.value.trim();
    return state.segments.filter((item) => {
      const matchesColor = color === "all" || item.shift === color;
      const matchesKeyword = !keyword || `${item.code}${item.note}${item.damage}`.includes(keyword);
      return matchesColor && matchesKeyword;
    });
  }

  function segmentTags(item) {
    const ready = Rules.isSchedulable(item);
    return `
      <div class="tag-row">
        <span class="tag">${esc(item.shift)}</span>
        <span class="tag ${item.damage === "完好" ? "ok" : "damage"}">${esc(item.damage)}</span>
        ${item.damage !== "完好" ? `<span class="tag ${item.repaired ? "ok" : "damage"}">${item.repaired ? "已修复" : "未修复"}</span>` : ""}
        <span class="tag ${ready ? "ok" : "damage"}">${ready ? "可排片" : "禁排"}</span>
      </div>
    `;
  }

  function renderSegmentList() {
    const segments = getFilteredSegments();
    els.segmentList.innerHTML =
      segments
        .map((item) => {
          const realIndex = state.segments.findIndex((segment) => segment.id === item.id);
          return `
            <article class="segment-card" draggable="true" data-id="${item.id}">
              <div class="thumb thumb-small">
                ${
                  item.thumb
                    ? `<img src="${esc(item.thumb)}" alt="${esc(item.code)}缩略图" />`
                    : `<div class="film-placeholder" style="background:${fallbackThumbs[realIndex % fallbackThumbs.length]}">${esc(item.code)}</div>`
                }
              </div>
              <div class="segment-main">
                <div class="segment-title">
                  <strong>${realIndex + 1}. ${esc(item.code)}</strong>
                  <label class="inline-duration">
                    时长(秒)
                    <input type="number" min="1" value="${item.duration}" data-duration="${item.id}" />
                  </label>
                </div>
                ${segmentTags(item)}
                <p class="segment-note">${esc(item.note || "没有备注。")}</p>
              </div>
              <div class="segment-actions">
                ${
                  item.damage !== "完好"
                    ? `<button type="button" class="${item.repaired ? "repair-done" : "repair-btn"}" data-repair="${item.id}">${item.repaired ? "撤销修复" : "标记修复"}</button>`
                    : ""
                }
                <button type="button" title="上移" data-move-up="${item.id}">↑</button>
                <button type="button" title="下移" data-move-down="${item.id}">↓</button>
                <button type="button" title="删除" data-delete="${item.id}">×</button>
              </div>
            </article>
          `;
        })
        .join("") || `<p class="empty">没有符合筛选的片段。</p>`;
  }

  /* ---------- 批量排片行 ---------- */

  function makeDraftRow() {
    return {
      segmentId: "",
      hallId: state.halls[0]?.id || "",
      projectionistId: state.projectionists[0]?.id || "",
      start: Rules.nextSlotValue(new Date())
    };
  }

  function segmentOptions(selected) {
    return state.segments
      .map((item) => {
        const ready = Rules.isSchedulable(item);
        return `<option value="${item.id}" ${item.id === selected ? "selected" : ""} ${ready ? "" : "disabled"}>
          ${esc(item.code)}（${Rules.formatDuration(item.duration)}${ready ? "" : "·未修复"}）
        </option>`;
      })
      .join("");
  }

  function hallOptions(selected) {
    return state.halls
      .map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${esc(item.name)}（容量 ${Rules.formatDuration(item.capacity)}）</option>`)
      .join("");
  }

  function operatorOptions(selected) {
    return state.projectionists
      .map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${esc(item.name)}</option>`)
      .join("");
  }

  function rowEndHint(row) {
    const segment = state.segments.find((item) => item.id === row.segmentId);
    const start = Rules.toDate(row.start);
    if (!segment || !start) return "";
    const endMs = start.getTime() + segment.duration * 1000;
    return `${Rules.formatClock(start.getTime())} → ${Rules.formatClock(endMs)}（${Rules.formatDuration(segment.duration)}）`;
  }

  function renderBatchRows() {
    els.batchRows.innerHTML = draftRows
      .map(
        (row, index) => `
          <div class="batch-row" data-row="${index}">
            <select data-field="segmentId">
              <option value="">选片段…</option>
              ${segmentOptions(row.segmentId)}
            </select>
            <select data-field="hallId">${hallOptions(row.hallId)}</select>
            <select data-field="projectionistId">${operatorOptions(row.projectionistId)}</select>
            <div class="slot-cell">
              <input type="datetime-local" data-field="start" value="${esc(row.start)}" />
              <span class="slot-hint">${esc(rowEndHint(row))}</span>
            </div>
            <button type="button" class="row-remove" title="删除该行" data-remove-row="${index}">×</button>
          </div>
        `
      )
      .join("");
  }

  function renderBatchResult(notice) {
    if (!notice) {
      els.batchResult.innerHTML = "";
      return;
    }
    if (notice.type === "ok") {
      els.batchResult.innerHTML = `<div class="notice ok"><strong>整批排期已保存：</strong>${esc(notice.text)}</div>`;
    } else {
      els.batchResult.innerHTML = `
        <div class="notice fail">
          <strong>整批未保存，原排期未动。共 ${notice.errors.length} 处问题：</strong>
          <ul>${notice.errors.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
        </div>
      `;
    }
  }

  function submitBatch() {
    if (!draftRows.length) {
      renderBatchResult({ type: "fail", errors: ["请先添加至少一排片行。"] });
      return;
    }

    const result = Rules.planBatch(draftRows, state);
    if (!result.ok) {
      // 关键：失败分支不触碰 state、不存档
      renderBatchResult({ type: "fail", errors: result.errors });
      return;
    }

    Rules.commitBatch(state, result.planned);
    draftRows = [makeDraftRow()];
    persistAndRenderAll({
      type: "ok",
      text: `本次 ${result.planned.length} 场全部入表。`
    });
  }

  /* ---------- 排期表 ---------- */

  function fillHallFilter() {
    const current = els.hallFilter.value || "all";
    els.hallFilter.innerHTML =
      `<option value="all">全部</option>` +
      state.halls.map((hall) => `<option value="${hall.id}">${esc(hall.name)}</option>`).join("");
    els.hallFilter.value = current === "all" || state.halls.some((h) => h.id === current) ? current : "all";
  }

  function renderScheduleTable() {
    const groups = Rules.sortedScreenings(state);
    const hallFilter = els.hallFilter.value;

    const renderRow = (sc) => {
      const hall = state.halls.find((item) => item.id === sc.hallId);
      const op = state.projectionists.find((item) => item.id === sc.projectionistId);
      const start = Rules.toDate(sc.start);
      const endMs = start ? start.getTime() + sc.duration * 1000 : 0;
      return `
        <div class="schedule-row ${sc.status === "completed" ? "done" : ""}">
          <div class="sc-time">
            <strong>${start ? Rules.formatClock(start.getTime()) : "--:--"}</strong>
            <span>→ ${Rules.formatClock(endMs)}</span>
            <span class="sc-duration">${Rules.formatDuration(sc.duration)}</span>
          </div>
          <div class="sc-code">${esc(sc.segmentCode || "片段")}</div>
          <div class="sc-hall">${esc(hall ? hall.name : "未知影厅")}</div>
          <div class="sc-op">${esc(op ? op.name : "未登记")}</div>
          <div class="sc-actions">
            ${
              sc.status === "scheduled"
                ? `
                  <button type="button" class="complete-btn" data-complete="${sc.id}">完成</button>
                  <button type="button" title="撤档" data-cancel="${sc.id}">撤</button>
                `
                : `<span class="done-tag">已完成</span>`
            }
          </div>
        </div>
      `;
    };

    const blocks = [];
    const future = groups.scheduled.filter((sc) => !hallFilter || hallFilter === "all" || sc.hallId === hallFilter);
    if (future.length) {
      const byDay = new Map();
      future.forEach((sc) => {
        const day = Rules.formatDay(sc.start);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(sc);
      });
      byDay.forEach((list, day) => {
        blocks.push(`<div class="day-group"><h3>${esc(day)}</h3>${list.map(renderRow).join("")}</div>`);
      });
    }

    const completed = groups.completed.filter((sc) => !hallFilter || hallFilter === "all" || sc.hallId === hallFilter);
    if (completed.length) {
      blocks.push(`
        <div class="day-group completed-group">
          <h3>已完成（长期保留）</h3>
          ${completed.map(renderRow).join("")}
        </div>
      `);
    }

    els.scheduleTable.innerHTML = blocks.join("") || `<p class="empty">还没有排期，先在上方批量排片。</p>`;
  }

  /* ---------- 统计与提醒 ---------- */

  function renderStatsAndReminders() {
    const stats = Rules.computeStats(state);
    els.statScheduled.textContent = stats.scheduledCount;
    els.statPending.textContent = stats.pendingCount;
    els.statCompleted.textContent = stats.completedCount;
    els.statScheduledSeconds.textContent = Rules.formatDuration(stats.scheduledSeconds);

    els.hallStats.innerHTML = stats.halls
      .map((hall) => {
        const over = hall.used > hall.capacity;
        const near = !over && hall.ratio >= 0.8;
        const pct = Math.min(100, Math.round(hall.ratio * 100));
        return `
          <div class="hall-stat ${over ? "over" : near ? "near" : ""}">
            <div class="hall-stat-head">
              <strong>${esc(hall.name)}</strong>
              <span>${Rules.formatDuration(hall.used)} / ${Rules.formatDuration(hall.capacity)}</span>
            </div>
            <div class="capacity-bar"><i style="width:${pct}%"></i></div>
          </div>
        `;
      })
      .join("");

    const reminders = Rules.buildReminders(state, new Date());
    els.warningList.innerHTML =
      reminders
        .map(
          (item) => `
            <div class="warning-item ${item.level}">
              <span>${esc(item.text)}</span>
            </div>
          `
        )
        .join("") || `<p class="empty">全部场次与片段状态正常，没有提醒。</p>`;
  }

  /* ---------- 总渲染与持久化 ---------- */

  function persistAndRenderAll(notice) {
    Archive.save(state);
    els.reelTitle.value = state.reelTitle;
    fillHallFilter();
    renderSegmentList();
    renderBatchRows();
    renderBatchResult(notice);
    renderScheduleTable();
    renderStatsAndReminders();
  }

  /* ---------- 表单与文件 ---------- */

  function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
      if (!file) {
        resolve("");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  }

  async function addSegment(event) {
    event.preventDefault();
    const thumb = await readFileAsDataUrl(els.thumbInput.files[0]);
    state.segments.push(
      Rules.createSegment({
        code: els.codeInput.value.trim(),
        duration: Number(els.durationInput.value),
        shift: els.shiftInput.value,
        damage: els.damageInput.value,
        repaired: els.repairedInput.checked,
        note: els.noteInput.value.trim(),
        thumb
      })
    );
    els.segmentForm.reset();
    els.durationInput.value = 12;
    persistAndRenderAll();
  }

  /* ---------- 事件 ---------- */

  els.reelTitle.addEventListener("input", () => {
    state.reelTitle = els.reelTitle.value;
    Archive.save(state);
  });
  els.colorFilter.addEventListener("change", renderSegmentList);
  els.searchInput.addEventListener("input", renderSegmentList);
  els.hallFilter.addEventListener("change", renderScheduleTable);

  els.segmentForm.addEventListener("submit", addSegment);

  els.segmentList.addEventListener("click", (event) => {
    const up = event.target.closest("[data-move-up]");
    const down = event.target.closest("[data-move-down]");
    const remove = event.target.closest("[data-delete]");
    const repair = event.target.closest("[data-repair]");

    if (up) {
      Rules.moveSegment(state, up.dataset.moveUp, -1);
      persistAndRenderAll();
    }
    if (down) {
      Rules.moveSegment(state, down.dataset.moveDown, 1);
      persistAndRenderAll();
    }
    if (repair) {
      const segment = state.segments.find((item) => item.id === repair.dataset.repair);
      if (!segment) return;
      const result = Rules.patchSegment(state, segment.id, { repaired: !segment.repaired });
      if (result.affectsSchedule && result.dropped.length) {
        persistAndRenderAll({
          type: "fail",
          errors: [
            `片段 ${segment.code} 修复状态变化，${result.dropped.length} 场未来场次已退回待排；已完成场次保留。`
          ]
        });
      } else {
        persistAndRenderAll();
      }
    }
    if (remove) {
      const result = Rules.removeSegment(state, remove.dataset.delete);
      if (!result.ok) {
        renderBatchResult({ type: "fail", errors: [result.reason] });
        return;
      }
      persistAndRenderAll();
    }
  });

  els.segmentList.addEventListener("change", (event) => {
    const input = event.target.closest("[data-duration]");
    if (!input) return;
    const id = input.dataset.duration;
    const result = Rules.patchSegment(state, id, { duration: Number(input.value) });
    if (!result.changed) {
      persistAndRenderAll();
      return;
    }
    if (result.affectsSchedule && result.dropped.length) {
      const segment = state.segments.find((item) => item.id === id);
      persistAndRenderAll({
        type: "fail",
        errors: [
          `片段 ${segment ? segment.code : ""} 时长变化，${result.dropped.length} 场未来场次已退回待排；已完成场次保留原时长。`
        ]
      });
    } else {
      persistAndRenderAll();
    }
  });

  els.segmentList.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-id]");
    if (!card) return;
    draggedId = card.dataset.id;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
  });

  els.segmentList.addEventListener("dragend", (event) => {
    event.target.closest("[data-id]")?.classList.remove("dragging");
    draggedId = null;
  });

  els.segmentList.addEventListener("dragover", (event) => {
    const card = event.target.closest("[data-id]");
    if (!card || !draggedId || card.dataset.id === draggedId) return;
    event.preventDefault();
    if (Rules.reorderSegments(state, draggedId, card.dataset.id)) persistAndRenderAll();
  });

  els.addRowBtn.addEventListener("click", () => {
    draftRows.push(makeDraftRow());
    renderBatchRows();
  });
  els.clearRowsBtn.addEventListener("click", () => {
    draftRows = [];
    renderBatchRows();
    renderBatchResult();
  });
  els.planBtn.addEventListener("click", submitBatch);

  els.batchRows.addEventListener("change", (event) => {
    const rowEl = event.target.closest("[data-row]");
    const field = event.target.dataset.field;
    if (!rowEl || !field) return;
    const index = Number(rowEl.dataset.row);
    if (!draftRows[index]) return;
    draftRows[index][field] = event.target.value;
    // 只重绘行尾的结束时间提示，避免输入框焦点跳动
    const hint = rowEl.querySelector(".slot-hint");
    if (hint) hint.textContent = rowEndHint(draftRows[index]);
  });

  els.batchRows.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-remove-row]");
    if (!btn) return;
    draftRows.splice(Number(btn.dataset.removeRow), 1);
    renderBatchRows();
  });

  els.scheduleTable.addEventListener("click", (event) => {
    const complete = event.target.closest("[data-complete]");
    const cancel = event.target.closest("[data-cancel]");
    if (complete) {
      Rules.completeScreening(state, complete.dataset.complete);
      persistAndRenderAll();
    }
    if (cancel) {
      Rules.cancelScreening(state, cancel.dataset.cancel);
      persistAndRenderAll();
    }
  });

  els.exportBtn.addEventListener("click", () => Archive.exportScheduleTxt(state));
  els.exportJsonBtn.addEventListener("click", () => Archive.exportJson(state));
  els.importJsonBtn.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", async () => {
    const file = els.importFile.files[0];
    if (!file) return;
    const result = await Archive.readJsonFile(file);
    els.importFile.value = "";
    if (!result.ok) {
      renderBatchResult({ type: "fail", errors: [result.error] });
      return;
    }
    state = result.state;
    draftRows = [];
    persistAndRenderAll({ type: "ok", text: "存档已导入并刷新到页面。" });
  });

  // 每分钟刷新一次“即将开场 / 已过结束时间”等提醒
  setInterval(renderStatsAndReminders, 60 * 1000);

  // 启动：预置一行排片行，其余全部从存档恢复
  draftRows = [makeDraftRow()];
  persistAndRenderAll();
})();
