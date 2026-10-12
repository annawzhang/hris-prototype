// 虚构组织与人员。所有姓名为随机拼接。
(function (root) {
  const ORG = [
    { id: "G", name: "星衡集团", parent: null, head: "E01" },
    { id: "BU1", name: "显示事业部", parent: "G", head: "E02" },
    { id: "BU2", name: "家电事业部", parent: "G", head: "E03" },
    { id: "BU3", name: "职能中心", parent: "G", head: "E04" },
    { id: "D11", name: "面板研发部", parent: "BU1", head: "E05", budget: 9 },
    { id: "D12", name: "显示制造部", parent: "BU1", head: "E06", budget: 8 },
    { id: "D21", name: "冰箱产品部", parent: "BU2", head: "E07", budget: 7 },
    { id: "D22", name: "空调渠道部", parent: "BU2", head: "E08", budget: 6 },
    { id: "D31", name: "人力资源部", parent: "BU3", head: "E09", budget: 6 },
    { id: "D32", name: "财务部", parent: "BU3", head: "E10", budget: 5 },
  ];

  const SURNAMES = "王李张刘陈杨黄赵周吴徐孙马朱胡郭何林罗高".split("");
  const GIVEN = ["一鸣", "思远", "嘉怡", "子涵", "浩然", "雨桐", "俊杰", "欣妍", "博文", "梓萱", "宇航", "若曦", "泽宇", "静怡", "晨阳", "可欣"];
  const TITLES = { D11: "研发工程师", D12: "工艺工程师", D21: "产品经理", D22: "渠道经理", D31: "HRBP", D32: "财务分析师" };

  function seeded(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  function buildEmployees() {
    const rnd = seeded(20251201);
    const name = () => SURNAMES[Math.floor(rnd() * SURNAMES.length)] + GIVEN[Math.floor(rnd() * GIVEN.length)];
    const people = [
      { id: "E01", name: "沈集团", dept: "G", title: "总裁", grade: "M5", status: "正式" },
      { id: "E02", name: "顾显示", dept: "BU1", title: "事业部总经理", grade: "M4", status: "正式" },
      { id: "E03", name: "陆家电", dept: "BU2", title: "事业部总经理", grade: "M4", status: "正式" },
      { id: "E04", name: "秦职能", dept: "BU3", title: "职能中心负责人", grade: "M4", status: "正式" },
    ];
    const heads = { D11: "E05", D12: "E06", D21: "E07", D22: "E08", D31: "E09", D32: "E10" };
    Object.entries(heads).forEach(([dept, id]) => {
      people.push({ id, name: name(), dept, title: "部门负责人", grade: "M2", status: "正式" });
    });
    const fill = { D11: 8, D12: 6, D21: 7, D22: 4, D31: 4, D32: 4 };
    let n = 11;
    Object.entries(fill).forEach(([dept, count]) => {
      for (let i = 1; i < count; i++) {
        const grade = "P" + (4 + Math.floor(rnd() * 4));
        people.push({ id: "E" + String(n++).padStart(2, "0"), name: name(), dept, title: TITLES[dept], grade,
          status: rnd() < 0.15 ? "试用" : "正式" });
      }
    });
    return people;
  }

  function seedRequests(hrbp) {
    return [
      { id: "R-1001", type: "onboard", applicant: "E09", created: "2026-10-08", status: "pending", step: 1,
        form: { name: "林知夏", dept: "D21", title: "产品经理", grade: "P6", start: "2026-11-01" },
        history: [{ at: "2026-10-08 10:12", by: "E09", action: "submit" }, { at: "2026-10-08 15:40", by: hrbp, action: "approve" }] },
      { id: "R-1002", type: "move", applicant: "E15", created: "2026-10-09", status: "pending", step: 0,
        form: { employee: "E15", from: "D11", to: "D22", reason: "渠道侧需要懂面板技术的人" },
        history: [{ at: "2026-10-09 09:30", by: "E15", action: "submit" }] },
      { id: "R-1003", type: "exit", applicant: "E20", created: "2026-10-10", status: "pending", step: 0,
        form: { employee: "E20", last_day: "2026-10-31", reason: "个人发展" },
        history: [{ at: "2026-10-10 11:05", by: "E20", action: "submit" }] },
    ];
  }

  root.HRData = { ORG, buildEmployees, seedRequests };
})(typeof window !== "undefined" ? window : globalThis);
