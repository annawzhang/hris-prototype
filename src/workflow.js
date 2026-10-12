// 入 / 转 / 调 / 离 审批引擎、组织编制计算与 OA 同步。纯函数为主，便于测试。
(function (root) {
  const TYPES = {
    onboard: { name: "入职", oa: "HR_ENTRY" },
    confirm: { name: "转正", oa: "HR_REGULAR" },
    move: { name: "调岗", oa: "HR_TRANSFER" },
    exit: { name: "离职", oa: "HR_LEAVE" },
  };
  const IT = { id: "IT", name: "IT 资产组", title: "资产交接" };
  const SENIOR = /^(P[789]|M\d)$/;

  // ---------- 组织 ----------
  const byId = (list, id) => list.find((x) => x.id === id);
  const active = (state) => state.people.filter((p) => p.status !== "离职");
  const headcount = (state, deptId) => active(state).filter((p) => p.dept === deptId).length;
  const buOf = (state, deptId) => {
    let node = byId(state.org, deptId);
    while (node && node.parent && node.parent !== "G") node = byId(state.org, node.parent);
    return node;
  };
  const hrbp = (state) => active(state).find((p) => p.title === "HRBP");
  const person = (state, id) => (id === "IT" ? IT : byId(state.people, id));

  function managerOf(state, empId) {
    const emp = byId(state.people, empId);
    const dept = byId(state.org, emp.dept);
    if (dept.head !== empId) return dept.head;
    return byId(state.org, dept.parent).head;
  }

  // ---------- 审批链 ----------
  function buildChain(state, type, form) {
    const steps = [];
    const add = (approver, label) => {
      const prev = steps.find((s) => s.approver === approver);
      if (prev) { if (!prev.label.includes(label)) prev.label += " · " + label; return; }
      steps.push({ approver, label });
    };
    const deptHead = (d) => byId(state.org, d).head;
    const buHead = (d) => buOf(state, d).head;
    const overBudget = (d) => headcount(state, d) >= (byId(state.org, d).budget || Infinity);

    if (type === "onboard") {
      add(hrbp(state).id, "HRBP 初审");
      add(deptHead(form.dept), "用人部门确认");
      if (overBudget(form.dept)) add(buHead(form.dept), "超编审批");
      if (SENIOR.test(form.grade)) add(buHead(form.dept), "高职级审批");
    } else if (type === "confirm") {
      add(managerOf(state, form.employee), "直属上级评估");
      add(hrbp(state).id, "HRBP 确认");
    } else if (type === "move") {
      add(deptHead(form.from), "调出部门同意");
      add(deptHead(form.to), "调入部门接收");
      if (buOf(state, form.from).id !== buOf(state, form.to).id) {
        add(buHead(form.from), "调出事业部同意");
        add(buHead(form.to), "调入事业部接收");
      }
      if (overBudget(form.to)) add(buHead(form.to), "超编审批");
      add(hrbp(state).id, "HRBP 办理");
    } else if (type === "exit") {
      add(managerOf(state, form.employee), "直属上级确认");
      add(hrbp(state).id, "HRBP 面谈");
      add("IT", "资产交接");
    }
    return steps;
  }

  function validate(state, type, form) {
    const errors = [];
    const need = { onboard: ["name", "dept", "title", "grade", "start"], confirm: ["employee"],
      move: ["employee", "from", "to"], exit: ["employee", "last_day"] }[type];
    if (!need) return ["未知流程类型"];
    need.forEach((k) => { if (!form[k]) errors.push(`缺少字段：${k}`); });
    if (errors.length) return errors;
    if (type !== "onboard") {
      const emp = byId(state.people, form.employee);
      if (!emp || emp.status === "离职") errors.push("员工不存在或已离职");
      else if (type === "confirm" && emp.status !== "试用") errors.push("只有试用期员工可以发起转正");
      else if (type === "move" && emp.dept !== form.from) errors.push("调出部门与员工当前部门不一致");
    }
    if (type === "move" && form.from === form.to) errors.push("调入部门不能与调出部门相同");
    const open = state.requests.find((r) => r.status === "pending" && r.form.employee && r.form.employee === form.employee);
    if (open) errors.push(`该员工已有进行中的流程 ${open.id}`);
    return errors;
  }

  // ---------- 状态机 ----------
  function stamp(req, by, action, at, comment) {
    req.history.push({ at, by, action, ...(comment ? { comment } : {}) });
  }

  function submit(state, type, form, applicant, at) {
    const errors = validate(state, type, form);
    if (errors.length) throw new Error(errors.join("；"));
    const n = state.requests.reduce((m, r) => Math.max(m, +r.id.slice(2)), 1000) + 1;
    const req = { id: "R-" + n, type, applicant, created: at.slice(0, 10), status: "pending", step: 0, form: { ...form },
      chain: buildChain(state, type, form), history: [] };
    stamp(req, applicant, "submit", at);
    state.requests.unshift(req);
    return req;
  }

  function current(req) { return req.status === "pending" ? req.chain[req.step] : null; }

  function assertTurn(req, by) {
    if (req.status !== "pending") throw new Error(`流程已${STATUS[req.status]}，不能再操作`);
    if (current(req).approver !== by) throw new Error("当前不是你的审批节点");
  }

  function approve(state, req, by, at, comment) {
    assertTurn(req, by);
    stamp(req, by, "approve", at, comment);
    req.step += 1;
    if (req.step >= req.chain.length) {
      req.status = "approved";
      req.finished = at;
      applyEffect(state, req);
    }
    return req;
  }

  function reject(state, req, by, at, comment) {
    assertTurn(req, by);
    if (!comment) throw new Error("驳回必须填写原因");
    stamp(req, by, "reject", at, comment);
    req.status = "rejected";
    req.finished = at;
    return req;
  }

  function sendBack(state, req, by, at, comment) {
    assertTurn(req, by);
    if (req.step === 0) throw new Error("已是第一个节点，不能退回");
    stamp(req, by, "return", at, comment);
    req.step -= 1;
    return req;
  }

  function withdraw(state, req, by, at) {
    if (req.status !== "pending") throw new Error("只有进行中的流程可以撤回");
    if (req.applicant !== by) throw new Error("只有申请人可以撤回");
    stamp(req, by, "withdraw", at);
    req.status = "withdrawn";
    req.finished = at;
    return req;
  }

  function applyEffect(state, req) {
    const f = req.form;
    if (req.type === "onboard") {
      const n = state.people.reduce((m, p) => Math.max(m, +p.id.slice(1) || 0), 0) + 1;
      const id = "E" + String(n).padStart(2, "0");
      state.people.push({ id, name: f.name, dept: f.dept, title: f.title, grade: f.grade, status: "试用" });
      req.effect = `${f.name} 加入 ${byId(state.org, f.dept).name}（${id}）`;
    } else if (req.type === "confirm") {
      byId(state.people, f.employee).status = "正式";
      req.effect = `${byId(state.people, f.employee).name} 转为正式员工`;
    } else if (req.type === "move") {
      byId(state.people, f.employee).dept = f.to;
      req.effect = `${byId(state.people, f.employee).name} 调入 ${byId(state.org, f.to).name}`;
    } else if (req.type === "exit") {
      byId(state.people, f.employee).status = "离职";
      req.effect = `${byId(state.people, f.employee).name} 已离职，账号与资产已回收`;
    }
  }

  const STATUS = { pending: "审批中", approved: "通过", rejected: "驳回", withdrawn: "撤回" };

  // ---------- 看板 ----------
  function hours(a, b) { return (new Date(b.replace(" ", "T")) - new Date(a.replace(" ", "T"))) / 36e5; }

  function dashboard(state) {
    const depts = state.org.filter((d) => d.budget);
    const budget = depts.reduce((s, d) => s + d.budget, 0);
    const staffed = depts.reduce((s, d) => s + headcount(state, d.id), 0);
    const done = state.requests.filter((r) => r.status === "approved");
    const durations = done.map((r) => hours(r.history[0].at, r.finished));
    const pendingBy = {};
    state.requests.filter((r) => r.status === "pending").forEach((r) => {
      const name = person(state, current(r).approver).name;
      pendingBy[name] = (pendingBy[name] || 0) + 1;
    });
    const byType = {};
    Object.keys(TYPES).forEach((t) => { byType[t] = done.filter((r) => r.type === t).length; });
    return {
      active: active(state).length,
      budget, staffed, usage: staffed / budget,
      probation: active(state).filter((p) => p.status === "试用").length,
      pending: state.requests.filter((r) => r.status === "pending").length,
      avgHours: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
      byType, pendingBy,
      depts: depts.map((d) => ({ id: d.id, name: d.name, bu: buOf(state, d.id).name, budget: d.budget, count: headcount(state, d.id) })),
    };
  }

  // ---------- OA 集成 ----------
  const LEVEL = { P4: "L04", P5: "L05", P6: "L06", P7: "L07", P8: "L08", P9: "L09", M2: "M02", M4: "M04", M5: "M05" };
  const FIELD_MAP = [
    { from: "id", to: "fd_biz_id", label: "业务单号", required: true },
    { from: "type", to: "fd_flow_code", label: "流程编码", map: (v) => TYPES[v].oa, required: true },
    { from: "applicant", to: "fd_applicant", label: "申请人工号", map: (v) => "XH" + v.slice(1).padStart(6, "0"), required: true },
    { from: "form.name", to: "fd_emp_name", label: "员工姓名", types: ["onboard"], required: true },
    { from: "form.employee", to: "fd_emp_no", label: "员工工号", types: ["confirm", "move", "exit"], map: (v) => "XH" + v.slice(1).padStart(6, "0"), required: true },
    { from: "form.dept", to: "fd_dept_code", label: "部门编码", types: ["onboard"], map: (v) => "ORG-" + v, required: true },
    { from: "form.from", to: "fd_from_dept", label: "调出部门", types: ["move"], map: (v) => "ORG-" + v, required: true },
    { from: "form.to", to: "fd_to_dept", label: "调入部门", types: ["move"], map: (v) => "ORG-" + v, required: true },
    { from: "form.grade", to: "fd_level", label: "职级", types: ["onboard"], map: (v) => LEVEL[v], required: true },
    { from: "form.start", to: "fd_entry_date", label: "入职日期", types: ["onboard"], map: (v) => v.replaceAll("-", ""), required: true },
    { from: "form.last_day", to: "fd_leave_date", label: "最后工作日", types: ["exit"], map: (v) => v.replaceAll("-", ""), required: true },
    { from: "form.reason", to: "fd_remark", label: "说明", types: ["move", "exit"] },
  ];

  function get(obj, path) { return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }

  function buildOAPayload(req) {
    const payload = {};
    const errors = [];
    FIELD_MAP.forEach((f) => {
      if (f.types && !f.types.includes(req.type)) return;
      const raw = get(req, f.from);
      const value = raw == null || raw === "" ? raw : f.map ? f.map(raw) : raw;
      if (f.required && (value == null || value === "")) errors.push(`${f.label}（${f.to}）为空或无法映射`);
      else if (value != null) payload[f.to] = value;
    });
    return { payload, errors };
  }

  // 模拟 OA 接口：按单号决定前几次调用失败，便于复现重试
  function mockOA(failPlan = {}) {
    const calls = {};
    const received = new Set();
    return function transport(payload) {
      const id = payload.fd_biz_id;
      calls[id] = (calls[id] || 0) + 1;
      if (calls[id] <= (failPlan[id] || 0)) return { ok: false, code: 502, message: "网关超时" };
      if (received.has(id)) return { ok: true, code: 200, oaId: "OA-" + id.slice(2), duplicate: true };
      received.add(id);
      return { ok: true, code: 200, oaId: "OA-" + id.slice(2) };
    };
  }

  function syncToOA(req, transport, log, opts = {}) {
    const maxAttempts = opts.maxAttempts || 3;
    const at = opts.at || "";
    if (req.oaId) { log({ at, id: req.id, level: "info", msg: `已同步（${req.oaId}），幂等跳过` }); return { ok: true, skipped: true }; }
    const { payload, errors } = buildOAPayload(req);
    if (errors.length) { log({ at, id: req.id, level: "error", msg: "字段校验失败：" + errors.join("；") }); return { ok: false, errors }; }
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = transport(payload);
      if (res.ok) {
        req.oaId = res.oaId;
        log({ at, id: req.id, level: "ok", msg: `第 ${attempt} 次调用成功 → ${res.oaId}`, payload });
        return { ok: true, attempts: attempt };
      }
      const wait = 2 ** (attempt - 1);
      log({ at, id: req.id, level: "warn", msg: `第 ${attempt} 次调用失败：${res.code} ${res.message}` + (attempt < maxAttempts ? `，${wait} 秒后重试` : "") });
    }
    log({ at, id: req.id, level: "error", msg: `重试 ${maxAttempts} 次仍失败，进入人工补偿队列` });
    return { ok: false, attempts: maxAttempts };
  }

  function initState() {
    const people = HRData.buildEmployees();
    const state = { org: HRData.ORG.map((d) => ({ ...d })), people, requests: [], oaLog: [] };
    const seeds = HRData.seedRequests(people.find((p) => p.title === "HRBP").id);
    seeds.forEach((r) => {
      r.chain = buildChain(state, r.type, r.form);
      state.requests.push(r);
    });
    return state;
  }

  root.HR = { TYPES, STATUS, FIELD_MAP, IT, headcount, buOf, hrbp, person, managerOf, buildChain, validate, submit,
    current, approve, reject, sendBack, withdraw, dashboard, buildOAPayload, mockOA, syncToOA, initState, active };
})(typeof window !== "undefined" ? window : globalThis);
