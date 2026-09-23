/*
 * 试映排期台 —— 业务规则
 * 纯数据逻辑，不碰 DOM、不碰存档：预置数据、排片校验、场次退档、统计与提醒。
 */
(function (global) {
  "use strict";

  const WEEK_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const CAPACITY_WARN_RATIO = 0.8;
  const SOON_SOON_MS = 30 * 60 * 1000;

  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  /* ---------- 预置数据：三名放映员、两个影厅、六个片段 ---------- */

  function createDefaultState() {
    return {
      version: 1,
      reelTitle: "春日试映A卷",
      projectionists: [
        { id: "p1", name: "周若兰" },
        { id: "p2", name: "吴柏年" },
        { id: "p3", name: "郑海音" }
      ],
      halls: [
        { id: "h1", name: "一号厅", capacity: 240 },
        { id: "h2", name: "二号厅", capacity: 360 }
      ],
      segments: [
        {
          id: "s1",
          code: "A-001",
          duration: 45,
          shift: "正常",
          damage: "完好",
          repaired: false,
          note: "开场街景，节奏平稳，适合打头阵。",
          thumb: ""
        },
        {
          id: "s2",
          code: "A-006",
          duration: 30,
          shift: "偏红",
          damage: "轻微划痕",
          repaired: false,
          note: "人物近景左侧有划痕，修复前不上片。",
          thumb: ""
        },
        {
          id: "s3",
          code: "A-012",
          duration: 60,
          shift: "褪色",
          damage: "接片松动",
          repaired: true,
          note: "接片已重新压平，可以排片。",
          thumb: ""
        },
        {
          id: "s4",
          code: "B-003",
          duration: 90,
          shift: "偏青",
          damage: "完好",
          repaired: false,
          note: "雨夜外景，灯光层次重，留意亮度。",
          thumb: ""
        },
        {
          id: "s5",
          code: "B-007",
          duration: 20,
          shift: "正常",
          damage: "完好",
          repaired: false,
          note: "片尾字幕短段。",
          thumb: ""
        },
        {
          id: "s6",
          code: "B-010",
          duration: 40,
          shift: "偏黄",
          damage: "齿孔破损",
          repaired: false,
          note: "齿孔待补，暂挂停映。",
          thumb: ""
        }
      ],
      screenings: []
    };
  }

  /* ---------- 基础判定 ---------- */

  function isSchedulable(segment) {
    return !!segment && (segment.damage === "完好" || segment.repaired === true);
  }

  function toDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    // 左闭右开：首尾相接的连续时段不算冲突
    return aStart < bEnd && bStart < aEnd;
  }

  /* ---------- 批量排片：先出结论，不动原排期 ---------- */

  function planBatch(rows, state) {
    const errors = [];
    const planned = [];

    rows.forEach((row, index) => {
      const prefix = `第 ${index + 1} 行`;
      const segment = state.segments.find((item) => item.id === row.segmentId) || null;
      const hall = state.halls.find((item) => item.id === row.hallId) || null;
      const projectionist = state.projectionists.find((item) => item.id === row.projectionistId) || null;
      const start = toDate(row.start);

      if (!segment) errors.push(`${prefix}：请选择片段`);
      if (!hall) errors.push(`${prefix}：请选择影厅`);
      if (!projectionist) errors.push(`${prefix}：请选择放映员`);
      if (!start) errors.push(`${prefix}：请选择连续时段的开场时间`);
      if (segment && !isSchedulable(segment)) {
        errors.push(`${prefix}：片段 ${segment.code} 尚未修复，不能参与排片`);
      }

      if (segment && hall && projectionist && start) {
        planned.push({
          rowIndex: index,
          segment,
          hall,
          projectionist,
          startMs: start.getTime(),
          endMs: start.getTime() + segment.duration * 1000,
          duration: segment.duration
        });
      }
    });

    const candidates = planned.map((item) => ({
      source: "batch",
      label: `第 ${item.rowIndex + 1} 行 ${item.segment.code}`,
      segmentCode: item.segment.code,
      hallId: item.hall.id,
      hallName: item.hall.name,
      projectionistId: item.projectionist.id,
      projectionistName: item.projectionist.name,
      startMs: item.startMs,
      endMs: item.endMs
    }));

    const occupied = state.screenings.map((screening) => {
      const hall = state.halls.find((item) => item.id === screening.hallId);
      const op = state.projectionists.find((item) => item.id === screening.projectionistId);
      const startMs = new Date(screening.start).getTime();
      return {
        source: "schedule",
        label: `原排期 ${screening.segmentCode || "片段"}`,
        segmentCode: screening.segmentCode,
        hallId: screening.hallId,
        hallName: hall ? hall.name : "已撤影厅",
        projectionistId: screening.projectionistId,
        projectionistName: op ? op.name : "未登记放映员",
        startMs,
        endMs: startMs + screening.duration * 1000
      };
    });

    const pushConflict = (a, b, scope) => {
      if (!overlaps(a.startMs, a.endMs, b.startMs, b.endMs)) return;
      const reasons = [];
      if (a.projectionistId && a.projectionistId === b.projectionistId) {
        reasons.push(`放映员 ${a.projectionistName} 时段冲突`);
      }
      if (a.hallId === b.hallId) {
        reasons.push(`影厅 ${a.hallName} 时段冲突`);
      }
      if (reasons.length) errors.push(`${a.label} 与 ${b.label}${reasons.join("、")}（${scope}）`);
    };

    // 本批内部两两核对
    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        pushConflict(candidates[i], candidates[j], "本批内");
      }
      // 本批与原排期逐条核对
      occupied.forEach((item) => pushConflict(candidates[i], item, "与现有排期"));
    }

    // 厅容量：只统计待映场次，已完成的历史场次不占未来容量
    state.halls.forEach((hall) => {
      const used = state.screenings
        .filter((screening) => screening.status === "scheduled" && screening.hallId === hall.id)
        .reduce((sum, screening) => sum + screening.duration, 0);
      const adding = candidates
        .filter((item) => item.hallId === hall.id)
        .reduce((sum, item) => sum + (item.endMs - item.startMs) / 1000, 0);
      if (used + adding > hall.capacity) {
        errors.push(
          `影厅 ${hall.name} 待映总时长 ${formatDuration(used + adding)} 超过厅容量 ${formatDuration(hall.capacity)}（已排 ${formatDuration(used)}）`
        );
      }
    });

    return { ok: errors.length === 0, errors: Array.from(new Set(errors)), planned };
  }

  /* 校验通过后才调用：整批落盘 */
  function commitBatch(state, planned) {
    const additions = planned.map((item) => ({
      id: uid(),
      segmentId: item.segment.id,
      segmentCode: item.segment.code,
      hallId: item.hall.id,
      projectionistId: item.projectionist.id,
      start: new Date(item.startMs).toISOString(),
      duration: item.duration,
      status: "scheduled"
    }));
    state.screenings.push(...additions);
    return additions;
  }

  /* ---------- 片段维护：修复状态或时长变化，未来场次退档 ---------- */

  function patchSegment(state, segmentId, patch) {
    const segment = state.segments.find((item) => item.id === segmentId);
    if (!segment) return { changed: false, dropped: [] };

    const before = { code: segment.code, duration: segment.duration, schedulable: isSchedulable(segment) };

    if (patch.duration !== undefined) {
      const next = Math.round(Number(patch.duration));
      if (Number.isFinite(next) && next >= 1) segment.duration = next;
    }
    if (patch.repaired !== undefined) segment.repaired = !!patch.repaired;
    if (patch.damage !== undefined) segment.damage = String(patch.damage);
    if (patch.shift !== undefined) segment.shift = String(patch.shift);
    if (patch.note !== undefined) segment.note = String(patch.note);
    if (patch.code !== undefined) segment.code = String(patch.code);
    if (patch.thumb !== undefined) segment.thumb = String(patch.thumb);

    // 待映场次编号跟随片段；已完成场次保留放映当时的记录
    if (segment.code !== before.code) {
      state.screenings.forEach((sc) => {
        if (sc.segmentId === segmentId && sc.status === "scheduled") sc.segmentCode = segment.code;
      });
    }

    const after = { duration: segment.duration, schedulable: isSchedulable(segment) };
    const affectsSchedule = before.duration !== after.duration || before.schedulable !== after.schedulable;

    // 仅未来（待映）场次退回待排；已完成场次一律保留
    const dropped = affectsSchedule
      ? state.screenings.filter((sc) => sc.segmentId === segmentId && sc.status === "scheduled")
      : [];
    if (dropped.length) {
      const droppedIds = new Set(dropped.map((item) => item.id));
      state.screenings = state.screenings.filter((item) => !droppedIds.has(item.id));
    }

    return { changed: true, affectsSchedule, dropped, segment };
  }

  function createSegment(data) {
    const duration = Math.round(Number(data.duration));
    return {
      id: uid(),
      code: String(data.code || "未命名片段").slice(0, 40),
      duration: Number.isFinite(duration) && duration >= 1 ? duration : 1,
      shift: String(data.shift || "正常"),
      damage: String(data.damage || "完好"),
      repaired: !!data.repaired,
      note: String(data.note || ""),
      thumb: String(data.thumb || "")
    };
  }

  function moveSegment(state, id, direction) {
    const index = state.segments.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.segments.length) return false;
    const [item] = state.segments.splice(index, 1);
    state.segments.splice(target, 0, item);
    return true;
  }

  function reorderSegments(state, fromId, toId) {
    const from = state.segments.findIndex((item) => item.id === fromId);
    const to = state.segments.findIndex((item) => item.id === toId);
    if (from < 0 || to < 0 || from === to) return false;
    const [item] = state.segments.splice(from, 1);
    state.segments.splice(to, 0, item);
    return true;
  }

  function removeSegment(state, id) {
    const linked = state.screenings.filter((item) => item.segmentId === id);
    if (linked.length) {
      const completed = linked.filter((item) => item.status === "completed").length;
      return {
        ok: false,
        reason: completed
          ? `该片段有 ${completed} 场已完成记录，按规矩必须长期保留，不能删除`
          : `该片段还有 ${linked.length} 场排期，请先撤档再删除`
      };
    }
    state.segments = state.segments.filter((item) => item.id !== id);
    return { ok: true };
  }

  /* ---------- 场次状态 ---------- */

  function completeScreening(state, id) {
    const screening = state.screenings.find((item) => item.id === id);
    if (!screening || screening.status !== "scheduled") return false;
    screening.status = "completed";
    return true;
  }

  function cancelScreening(state, id) {
    const before = state.screenings.length;
    state.screenings = state.screenings.filter(
      (item) => !(item.id === id && item.status === "scheduled")
    );
    return state.screenings.length !== before;
  }

  function sortedScreenings(state) {
    const byStart = (a, b) => new Date(a.start) - new Date(b.start) || a.id.localeCompare(b.id);
    return {
      scheduled: state.screenings.filter((item) => item.status === "scheduled").sort(byStart),
      completed: state.screenings.filter((item) => item.status === "completed").sort(byStart)
    };
  }

  /* ---------- 统计与提醒（全部由排期推导，保证同步） ---------- */

  function computeStats(state) {
    const groups = sortedScreenings(state);
    const scheduledSeconds = groups.scheduled.reduce((sum, item) => sum + item.duration, 0);
    const pendingSegments = state.segments
      .filter(isSchedulable)
      .filter((segment) => !groups.scheduled.some((sc) => sc.segmentId === segment.id));
    const blockedSegments = state.segments.filter((segment) => !isSchedulable(segment));

    const halls = state.halls.map((hall) => {
      const used = groups.scheduled
        .filter((sc) => sc.hallId === hall.id)
        .reduce((sum, sc) => sum + sc.duration, 0);
      return {
        id: hall.id,
        name: hall.name,
        capacity: hall.capacity,
        used,
        ratio: hall.capacity > 0 ? used / hall.capacity : 0
      };
    });

    return {
      scheduledCount: groups.scheduled.length,
      completedCount: groups.completed.length,
      pendingCount: pendingSegments.length,
      blockedCount: blockedSegments.length,
      scheduledSeconds,
      halls,
      pendingSegments,
      blockedSegments
    };
  }

  function buildReminders(state, now) {
    const moment = now instanceof Date ? now.getTime() : Number(now) || Date.now();
    const stats = computeStats(state);
    const reminders = [];

    stats.blockedSegments.forEach((segment) => {
      reminders.push({
        level: "danger",
        text: `片段 ${segment.code}（${segment.damage}）未修复，暂不能排片`
      });
    });

    stats.pendingSegments.forEach((segment) => {
      reminders.push({
        level: "info",
        text: `片段 ${segment.code} 待排：已可放映，但还没有待映场次`
      });
    });

    stats.halls.forEach((hall) => {
      if (hall.used > hall.capacity) {
        reminders.push({
          level: "danger",
          text: `影厅 ${hall.name} 已超容量：${formatDuration(hall.used)} / ${formatDuration(hall.capacity)}`
        });
      } else if (hall.ratio >= CAPACITY_WARN_RATIO) {
        reminders.push({
          level: "warn",
          text: `影厅 ${hall.name} 容量接近上限：${formatDuration(hall.used)} / ${formatDuration(hall.capacity)}`
        });
      }
    });

    sortedScreenings(state).scheduled.forEach((screening) => {
      const startMs = new Date(screening.start).getTime();
      const endMs = startMs + screening.duration * 1000;
      if (moment >= endMs) {
        reminders.push({
          level: "danger",
          text: `${screening.segmentCode}（${hallName(state, screening)}）已过结束时间，请补记完成`
        });
      } else if (moment >= startMs) {
        reminders.push({
          level: "warn",
          text: `${screening.segmentCode}（${hallName(state, screening)}）正在放映，结束 ${formatClock(endMs)}`
        });
      } else if (startMs - moment <= SOON_SOON_MS) {
        reminders.push({
          level: "info",
          text: `${screening.segmentCode}（${hallName(state, screening)}）30 分钟内开场：${formatClock(startMs)}`
        });
      }
    });

    return reminders;
  }

  function hallName(state, screening) {
    const hall = state.halls.find((item) => item.id === screening.hallId);
    return hall ? hall.name : "未分配影厅";
  }

  /* ---------- 格式化与时间工具 ---------- */

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(rest)}`;
    return `${minutes}:${pad2(rest)}`;
  }

  function formatClock(ms) {
    const date = toDate(ms);
    return date ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` : "--:--";
  }

  function formatStart(iso) {
    const date = toDate(iso);
    if (!date) return "时间无效";
    return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEK_LABELS[date.getDay()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function formatDay(iso) {
    const date = toDate(iso);
    return date ? `${date.getMonth() + 1}月${date.getDate()}日 ${WEEK_LABELS[date.getDay()]}` : "";
  }

  function toInputValue(ms) {
    const date = toDate(ms) || new Date();
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  // 下一个整半点，作为新排片行的默认开场
  function nextSlotValue(now) {
    const date = now instanceof Date ? new Date(now.getTime()) : new Date();
    date.setSeconds(0, 0);
    const minutes = date.getMinutes();
    date.setMinutes(minutes <= 30 ? 30 : 60);
    return toInputValue(date.getTime());
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  global.Rules = {
    uid,
    createDefaultState,
    isSchedulable,
    planBatch,
    commitBatch,
    createSegment,
    patchSegment,
    moveSegment,
    reorderSegments,
    removeSegment,
    completeScreening,
    cancelScreening,
    sortedScreenings,
    computeStats,
    buildReminders,
    formatDuration,
    formatClock,
    formatStart,
    formatDay,
    toDate,
    toInputValue,
    nextSlotValue,
    escapeHtml
  };
})(window);
