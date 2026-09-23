// 试映排期台 · 本地存档
// 预置数据与 localStorage 读写，不含规则与页面逻辑。
(function () {
  const STORAGE_KEY = "zfl17-screening-desk";

  const defaultState = {
    projectionists: [
      { id: "proj-linlan", name: "林岚" },
      { id: "proj-zhoumu", name: "周牧" },
      { id: "proj-chenyizhou", name: "陈一舟" }
    ],
    halls: [
      { id: "hall-one", name: "一号厅", capacity: 120 },
      { id: "hall-two", name: "二号厅", capacity: 90 }
    ],
    segments: [
      { id: "seg-a001", code: "A-001", duration: 18, repaired: true, note: "开场街景，节奏平稳。" },
      { id: "seg-a006", code: "A-006", duration: 9, repaired: false, note: "人物近景左侧划痕，修复中。" },
      { id: "seg-a012", code: "A-012", duration: 14, repaired: true, note: "接片已重新压平。" },
      { id: "seg-a015", code: "A-015", duration: 22, repaired: true, note: "夜戏段落，注意音量。" },
      { id: "seg-a021", code: "A-021", duration: 11, repaired: false, note: "齿孔破损，等待补片。" },
      { id: "seg-a030", code: "A-030", duration: 16, repaired: true, note: "结尾字幕段。" }
    ],
    screenings: []
  };

  function load() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return structuredClone(defaultState);
    try {
      return { ...structuredClone(defaultState), ...JSON.parse(saved) };
    } catch {
      return structuredClone(defaultState);
    }
  }

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  window.ScreeningStore = { STORAGE_KEY, load, save };
})();
