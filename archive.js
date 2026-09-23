/*
 * 试映排期台 —— 存档
 * localStorage 读写与数据归一化、排期单 TXT 导出、JSON 存档导入导出。
 * 不碰 DOM 渲染，只通过浏览器存储/下载能力工作。
 */
(function (global) {
  "use strict";

  const storageKey = "zfl17-screening-desk-v1";

  function isId(value, list) {
    return list.some((item) => item.id === value);
  }

  /* 读取后逐项归一化：坏数据不影响整档，外键失效的场次直接摘掉 */
  function normalize(input) {
    const base = global.Rules.createDefaultState();
    let raw = input;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = null;
      }
    }
    if (!raw || typeof raw !== "object") return base;

    const projectionists = Array.isArray(raw.projectionists)
      ? raw.projectionists
          .filter((item) => item && item.id && item.name)
          .map((item) => ({ id: String(item.id), name: String(item.name) }))
      : base.projectionists;

    const halls = Array.isArray(raw.halls)
      ? raw.halls
          .filter((item) => item && item.id && item.name)
          .map((item) => ({
            id: String(item.id),
            name: String(item.name),
            capacity: Math.max(1, Math.round(Number(item.capacity) || 0))
          }))
      : base.halls;

    const segments = Array.isArray(raw.segments)
      ? raw.segments
          .filter((item) => item && item.id && item.code)
          .map((item) => {
            const duration = Math.round(Number(item.duration));
            return {
              id: String(item.id),
              code: String(item.code),
              duration: Number.isFinite(duration) && duration >= 1 ? duration : 1,
              shift: String(item.shift || "正常"),
              damage: String(item.damage || "完好"),
              repaired: item.repaired === true,
              note: String(item.note || ""),
              thumb: String(item.thumb || "")
            };
          })
      : base.segments;

    const screenings = Array.isArray(raw.screenings)
      ? raw.screenings
          .filter(
            (item) =>
              item &&
              item.id &&
              global.Rules.toDate(item.start) &&
              isId(item.segmentId, segments) &&
              isId(item.hallId, halls) &&
              isId(item.projectionistId, projectionists) &&
              (item.status === "scheduled" || item.status === "completed")
          )
          .map((item) => ({
            id: String(item.id),
            segmentId: String(item.segmentId),
            segmentCode: String(item.segmentCode || segments.find((s) => s.id === item.segmentId)?.code || ""),
            hallId: String(item.hallId),
            projectionistId: String(item.projectionistId),
            start: global.Rules.toDate(item.start).toISOString(),
            duration: Math.max(1, Math.round(Number(item.duration) || 1)),
            status: item.status
          }))
      : [];

    return {
      version: 1,
      reelTitle: String(raw.reelTitle ?? base.reelTitle),
      projectionists,
      halls,
      segments,
      screenings
    };
  }

  function load() {
    let saved = null;
    try {
      saved = global.localStorage.getItem(storageKey);
    } catch {
      saved = null;
    }
    return normalize(saved);
  }

  function save(state) {
    try {
      global.localStorage.setItem(storageKey, JSON.stringify(state));
      return true;
    } catch {
      // 存储不可用（隐私模式 / 缩略图撑满配额）时页面仍可继续使用
      return false;
    }
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type: type || "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportScheduleTxt(state) {
    const groups = global.Rules.sortedScreenings(state);
    const stats = global.Rules.computeStats(state);
    const lines = [
      `胶片卷：${state.reelTitle || "未命名胶片卷"}`,
      `导出台数：待映 ${stats.scheduledCount} 场 / 已完成 ${stats.completedCount} 场`,
      `待映总时长：${global.Rules.formatDuration(stats.scheduledSeconds)}`,
      ""
    ];

    lines.push("【待映场次】");
    if (groups.scheduled.length) {
      groups.scheduled.forEach((sc, index) => {
        const hall = state.halls.find((item) => item.id === sc.hallId);
        const op = state.projectionists.find((item) => item.id === sc.projectionistId);
        lines.push(
          `${index + 1}. ${global.Rules.formatStart(sc.start)} ｜ ${sc.segmentCode} ｜ ${
            hall ? hall.name : "未知影厅"
          } ｜ 放映员：${op ? op.name : "未登记"} ｜ ${global.Rules.formatDuration(sc.duration)}`
        );
      });
    } else {
      lines.push("（暂无）");
    }

    lines.push("", "【已完成场次】");
    if (groups.completed.length) {
      groups.completed.forEach((sc, index) => {
        const hall = state.halls.find((item) => item.id === sc.hallId);
        const op = state.projectionists.find((item) => item.id === sc.projectionistId);
        lines.push(
          `${index + 1}. ${global.Rules.formatStart(sc.start)} ｜ ${sc.segmentCode} ｜ ${
            hall ? hall.name : "未知影厅"
          } ｜ 放映员：${op ? op.name : "未登记"} ｜ ${global.Rules.formatDuration(sc.duration)} ｜ 已完成`
        );
      });
    } else {
      lines.push("（暂无）");
    }

    lines.push("", "【厅容量】");
    stats.halls.forEach((hall) => {
      lines.push(`${hall.name}：待映 ${global.Rules.formatDuration(hall.used)} / 容量 ${global.Rules.formatDuration(hall.capacity)}`);
    });

    download(`${state.reelTitle || "screening"}-排期单.txt`, lines.join("\n"));
  }

  function exportJson(state) {
    download(
      `${state.reelTitle || "screening"}-存档.json`,
      JSON.stringify(state, null, 2),
      "application/json;charset=utf-8"
    );
  }

  function readJsonFile(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve({ ok: true, state: normalize(reader.result) });
        } catch {
          resolve({ ok: false, error: "文件不是有效的存档" });
        }
      };
      reader.onerror = () => resolve({ ok: false, error: "读取文件失败" });
      reader.readAsText(file);
    });
  }

  global.Archive = {
    storageKey,
    load,
    save,
    normalize,
    exportScheduleTxt,
    exportJson,
    readJsonFile
  };
})(window);
