// 试映排期台 · 排期规则
// 纯函数：不碰页面、不读写存档，只负责校验与统计。
(function () {
  const STATUS_LABELS = {
    pending: "待排",
    scheduled: "已排定",
    done: "已完成"
  };

  // 只有这两种状态占用影厅与放映员时段；待排场次不占位
  const OCCUPYING_STATUS = ["scheduled", "done"];

  function toMinutes(timeStr) {
    const parts = String(timeStr || "").split(":");
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (parts.length < 2 || Number.isNaN(hours) || Number.isNaN(minutes)) return NaN;
    return hours * 60 + minutes;
  }

  function toTimeStr(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  // 一场放映的连续时段：开始时刻 + 时长，中间不留空
  function endOf(screening) {
    return toMinutes(screening.start) + Number(screening.duration);
  }

  function describe(state, screening) {
    const segment = state.segments.find((item) => item.id === screening.segmentId);
    const hall = state.halls.find((item) => item.id === screening.hallId);
    const code = segment ? segment.code : "未知片段";
    const hallName = hall ? hall.name : "未知影厅";
    return `「${code}」${screening.date} ${screening.start}–${toTimeStr(endOf(screening))} ${hallName}`;
  }

  // 校验整批排期：任何一条不满足规则，整批都不保存，原排期不动
  function validateBatch(state, batch) {
    const errors = [];
    if (!batch.length) {
      errors.push("待存批次为空，请先加入至少一场。");
      return { ok: false, errors };
    }

    const entries = batch.map((item, index) => {
      const no = `第${index + 1}场`;
      const segment = state.segments.find((s) => s.id === item.segmentId);
      const hall = state.halls.find((h) => h.id === item.hallId);
      const projectionist = state.projectionists.find((p) => p.id === item.projectionistId);
      const startMin = toMinutes(item.start);
      if (!segment) errors.push(`${no}：片段不存在。`);
      if (!hall) errors.push(`${no}：影厅不存在。`);
      if (!projectionist) errors.push(`${no}：放映员不存在。`);
      if (!item.date) errors.push(`${no}：缺少放映日期。`);
      if (Number.isNaN(startMin)) errors.push(`${no}：开始时间无效。`);
      if (segment && !segment.repaired) errors.push(`${no}：片段 ${segment.code} 尚未修复，不能排期。`);
      const duration = segment ? Number(segment.duration) : 0;
      const endMin = Number.isNaN(startMin) ? NaN : startMin + duration;
      if (!Number.isNaN(endMin) && endMin > 24 * 60) errors.push(`${no}：时段跨日，请拆到第二天。`);
      return { ...item, no, segment, hall, projectionist, startMin, endMin, duration };
    });

    // 与已占位的场次（已排定 / 已完成）比对：同一放映员或同一影厅时段不能重叠
    const occupying = state.screenings.filter((s) => OCCUPYING_STATUS.includes(s.status));
    for (const entry of entries) {
      if (!entry.segment || Number.isNaN(entry.startMin)) continue;
      for (const existing of occupying) {
        if (existing.date !== entry.date) continue;
        const existStart = toMinutes(existing.start);
        const existEnd = existStart + Number(existing.duration);
        if (!overlaps(entry.startMin, entry.endMin, existStart, existEnd)) continue;
        if (existing.hallId === entry.hallId) {
          errors.push(`${entry.no}：与${describe(state, existing)}的影厅时段冲突。`);
        }
        if (existing.projectionistId === entry.projectionistId) {
          errors.push(`${entry.no}：放映员与${describe(state, existing)}撞档。`);
        }
      }
    }

    // 批次内部互相冲突
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = entries[i];
        const b = entries[j];
        if (a.date !== b.date || Number.isNaN(a.startMin) || Number.isNaN(b.startMin)) continue;
        if (!overlaps(a.startMin, a.endMin, b.startMin, b.endMin)) continue;
        if (a.hallId === b.hallId) errors.push(`${a.no}与${b.no}：同一影厅时段重叠。`);
        if (a.projectionistId === b.projectionistId) errors.push(`${a.no}与${b.no}：同一放映员时段重叠。`);
      }
    }

    // 厅容量：同一影厅同一天的总时长不能超过厅容量
    const hallDates = new Set(entries.filter((e) => e.hall && e.date).map((e) => `${e.hallId}|${e.date}`));
    for (const key of hallDates) {
      const [hallId, date] = key.split("|");
      const hall = state.halls.find((h) => h.id === hallId);
      const existingMinutes = occupying
        .filter((s) => s.hallId === hallId && s.date === date)
        .reduce((sum, s) => sum + Number(s.duration), 0);
      const batchMinutes = entries
        .filter((e) => e.hallId === hallId && e.date === date)
        .reduce((sum, e) => sum + e.duration, 0);
      const total = existingMinutes + batchMinutes;
      if (total > hall.capacity) {
        errors.push(`${hall.name} ${date} 总时长 ${total} 分钟，超过厅容量 ${hall.capacity} 分钟。`);
      }
    }

    return { ok: errors.length === 0, errors };
  }

  // 片段修复状态或时长变化后，相关未来场次（已排定）退回待排；已完成场次保留
  function revertFutureScreenings(state, segmentId) {
    let count = 0;
    for (const screening of state.screenings) {
      if (screening.segmentId === segmentId && screening.status === "scheduled") {
        screening.status = "pending";
        count += 1;
      }
    }
    return count;
  }

  function computeStats(state) {
    return {
      scheduled: state.screenings.filter((s) => s.status === "scheduled").length,
      pending: state.screenings.filter((s) => s.status === "pending").length,
      done: state.screenings.filter((s) => s.status === "done").length,
      unrepaired: state.segments.filter((s) => !s.repaired).length
    };
  }

  // 每个影厅每天已占用的分钟数（已排定 + 已完成）
  function hallLoads(state) {
    const map = new Map();
    for (const s of state.screenings) {
      if (!OCCUPYING_STATUS.includes(s.status)) continue;
      const key = `${s.hallId}|${s.date}`;
      map.set(key, (map.get(key) || 0) + Number(s.duration));
    }
    return [...map.entries()]
      .map(([key, minutes]) => {
        const [hallId, date] = key.split("|");
        const hall = state.halls.find((h) => h.id === hallId);
        return { hall, date, minutes, capacity: hall ? hall.capacity : 0 };
      })
      .filter((item) => item.hall)
      .sort((a, b) => a.date.localeCompare(b.date) || a.hall.name.localeCompare(b.hall.name));
  }

  function buildReminders(state) {
    const reminders = [];
    for (const s of state.screenings.filter((item) => item.status === "pending")) {
      reminders.push({ type: "pending", text: `${describe(state, s)} 待重新排定。` });
    }
    for (const seg of state.segments.filter((item) => !item.repaired)) {
      reminders.push({ type: "repair", text: `片段 ${seg.code} 尚未修复，修复前不能排期。` });
    }
    for (const load of hallLoads(state)) {
      if (load.capacity > 0 && load.minutes >= load.capacity * 0.8) {
        reminders.push({
          type: "capacity",
          text: `${load.hall.name} ${load.date} 已占 ${load.minutes}/${load.capacity} 分钟，接近厅容量。`
        });
      }
    }
    return reminders;
  }

  window.ScreeningRules = {
    STATUS_LABELS,
    OCCUPYING_STATUS,
    toMinutes,
    toTimeStr,
    overlaps,
    endOf,
    describe,
    validateBatch,
    revertFutureScreenings,
    computeStats,
    hallLoads,
    buildReminders
  };
})();
