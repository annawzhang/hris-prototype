(function () {
  const KEY = "hris-prototype-v1";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ACTIONS = { submit: "提交", approve: "通过", reject: "驳回", return: "退回上一步", withdraw: "撤回" };

  let state = load();
  let me = defaultIdentity();
  let filter = "mine-todo";
  let selected = null;
  let toast = "";

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && saved.people) return saved;
    } catch (e) { /* 本地数据损坏时重新初始化 */ }
    return HR.initState();
  }
  function defaultIdentity() {
    const first = state.requests.find((r) => r.status === "pending");
    return first ? HR.current(first).approver : HR.hrbp(state).id;
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
  function now() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const nameOf = (id) => (HR.person(state, id) || { name: id }).name;
  const deptName = (id) => (state.org.find((d) => d.id === id) || { name: id }).name;

  // ---------- 身份 ----------
  function renderIdentity() {
    const ids = new Set();
    state.org.forEach((d) => ids.add(d.head));
    ids.add(HR.hrbp(state).id);
    state.requests.forEach((r) => ids.add(r.applicant));
    ids.add("IT");
    const opts = [...ids].map((id) => {
      const p = HR.person(state, id);
      return `<option value="${id}" ${id === me ? "selected" : ""}>${esc(p.name)} · ${esc(p.title)}${p.dept ? " · " + esc(deptName(p.dept)) : ""}</option>`;
    });
    $("#identity").innerHTML = opts.join("");
  }

  // ---------- 审批中心 ----------
  function visible() {
    return state.requests.filter((r) => {
      if (filter === "mine-todo") return r.status === "pending" && HR.current(r).approver === me;
      if (filter === "mine") return r.applicant === me;
      return true;
    });
  }

  function summary(r) {
    const f = r.form;
    if (r.type === "onboard") return `${f.name} → ${deptName(f.dept)} · ${f.grade}`;
    if (r.type === "move") return `${nameOf(f.employee)}：${deptName(f.from)} → ${deptName(f.to)}`;
    return `${nameOf(f.employee)}`;
  }

  function renderList() {
    const list = visible();
    if (!list.some((r) => r.id === selected)) selected = list[0] ? list[0].id : null;
    $("#req-list").innerHTML = list.length ? list.map((r) => `
      <li data-id="${r.id}" class="${r.id === selected ? "sel" : ""}">
        <div class="t"><span>${HR.TYPES[r.type].name} · ${esc(summary(r))}</span><span class="pill p-${r.status}">${HR.STATUS[r.status]}</span></div>
        <div class="s">${r.id} · ${esc(nameOf(r.applicant))} 发起 · ${r.created}${r.status === "pending" ? " · 待 " + esc(nameOf(HR.current(r).approver)) : ""}</div>
      </li>`).join("") : `<li class="empty">${filter === "mine-todo" ? "没有待你审批的流程。可在右上角切换身份，或点「全部」查看。" : "暂无流程"}</li>`;
  }

  function chainHtml(r) {
    return `<div class="chain">${r.chain.map((s, i) => {
      let cls = "";
      if (r.status === "approved" || i < r.step) cls = "done";
      else if (r.status === "pending" && i === r.step) cls = "cur";
      else if (r.status === "rejected" && i === r.step) cls = "stop";
      return `<div class="node ${cls}"><div class="dot">${cls === "done" ? "✓" : cls === "stop" ? "✕" : i + 1}</div>
        <div>${esc(nameOf(s.approver))}</div><div class="lbl">${esc(s.label)}</div></div>`;
    }).join("")}</div>`;
  }

  function fieldsHtml(r) {
    const f = r.form;
    const rows = [];
    if (r.type === "onboard") rows.push(["姓名", f.name], ["部门", deptName(f.dept)], ["岗位", f.title], ["职级", f.grade], ["入职日期", f.start],
      ["部门编制", `${HR.headcount(state, f.dept)} / ${state.org.find((d) => d.id === f.dept).budget}`]);
    else {
      const p = state.people.find((x) => x.id === f.employee);
      rows.push(["员工", `${p.name}（${p.id}）`], ["当前部门", deptName(p.dept)], ["职级", p.grade]);
      if (r.type === "move") rows.push(["调出", deptName(f.from)], ["调入", deptName(f.to)], ["调入部门编制", `${HR.headcount(state, f.to)} / ${state.org.find((d) => d.id === f.to).budget}`]);
      if (r.type === "exit") rows.push(["最后工作日", f.last_day]);
      if (f.reason) rows.push(["说明", f.reason]);
    }
    return `<div class="fields">${rows.map(([k, v]) => `<div><b>${k}</b>${esc(v)}</div>`).join("")}</div>`;
  }

  function renderDetail() {
    const r = state.requests.find((x) => x.id === selected);
    if (!r) { $("#detail").innerHTML = `<div class="empty">选择左侧的流程查看详情</div>`; return; }
    const cur = HR.current(r);
    const myTurn = cur && cur.approver === me;
    const canWithdraw = r.status === "pending" && r.applicant === me;
    let actions = "";
    if (r.status === "pending") {
      actions = `<div class="actions">
        <input id="comment" placeholder="审批意见（驳回必填）" />
        <button data-act="approve" ${myTurn ? "" : "disabled"}>通过</button>
        <button data-act="return" class="ghost" ${myTurn && r.step > 0 ? "" : "disabled"}>退回上一步</button>
        <button data-act="reject" class="danger" ${myTurn ? "" : "disabled"}>驳回</button>
        <button data-act="withdraw" class="ghost" ${canWithdraw ? "" : "disabled"}>撤回</button>
      </div>
      ${myTurn ? "" : `<div class="hint" style="margin-top:6px">当前节点由 <b>${esc(nameOf(cur.approver))}</b> 审批。 <a data-switch="${cur.approver}">切换为该身份</a></div>`}`;
    }
    $("#detail").innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div><h1>${HR.TYPES[r.type].name}申请 · ${esc(summary(r))}</h1>
        <div class="sub">${r.id} · ${esc(nameOf(r.applicant))} 发起于 ${r.created}</div></div>
        <span class="pill p-${r.status}">${HR.STATUS[r.status]}</span>
      </div>
      ${fieldsHtml(r)}
      ${chainHtml(r)}
      ${actions}
      ${toast ? `<div class="toast">${esc(toast)}</div>` : ""}
      ${r.effect ? `<div class="effect">已生效：${esc(r.effect)}</div>` : ""}
      <ul class="timeline">${r.history.map((h) => `<li><span>${h.at}</span><span>${esc(nameOf(h.by))}</span><span>${ACTIONS[h.action]}${h.comment ? "：" + esc(h.comment) : ""}</span></li>`).join("")}</ul>`;
    toast = "";
  }

  function act(kind) {
    const r = state.requests.find((x) => x.id === selected);
    const comment = ($("#comment") || {}).value || "";
    try {
      if (kind === "approve") HR.approve(state, r, me, now(), comment);
      if (kind === "reject") HR.reject(state, r, me, now(), comment);
      if (kind === "return") HR.sendBack(state, r, me, now(), comment);
      if (kind === "withdraw") HR.withdraw(state, r, me, now());
      save();
    } catch (e) { toast = e.message; }
    if (filter === "mine-todo" && r.status === "pending" && HR.current(r).approver !== me) filter = "all";
    if (r.status !== "pending") filter = "all";
    selected = r.id;
    renderAll();
  }

  // ---------- 发起申请 ----------
  const FIELD_DEFS = {
    onboard: [["name", "姓名", "text"], ["dept", "部门", "dept"], ["title", "岗位", "text"], ["grade", "职级", "grade"], ["start", "入职日期", "date"]],
    confirm: [["employee", "员工", "probation"]],
    move: [["employee", "员工", "employee"], ["to", "调入部门", "dept"], ["reason", "说明", "text"]],
    exit: [["employee", "员工", "employee"], ["last_day", "最后工作日", "date"], ["reason", "说明", "text"]],
  };

  function input(kind, key) {
    const depts = state.org.filter((d) => d.budget);
    const staff = HR.active(state).filter((p) => !["G", "BU1", "BU2", "BU3"].includes(p.dept));
    if (kind === "dept") return `<select name="${key}">${depts.map((d) => `<option value="${d.id}">${esc(d.name)}（${HR.headcount(state, d.id)}/${d.budget}）</option>`).join("")}</select>`;
    if (kind === "grade") return `<select name="${key}">${["P4", "P5", "P6", "P7", "P8"].map((g) => `<option>${g}</option>`).join("")}</select>`;
    if (kind === "employee" || kind === "probation") {
      const list = kind === "probation" ? staff.filter((p) => p.status === "试用") : staff;
      return `<select name="${key}">${list.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(deptName(p.dept))} · ${p.grade}${p.status === "试用" ? " · 试用" : ""}</option>`).join("")}</select>`;
    }
    return `<input name="${key}" type="${kind}" ${kind === "date" ? 'value="2026-11-02"' : ""} />`;
  }

  function readForm() {
    const type = $("#new-type").value;
    const form = {};
    $("#new-fields").querySelectorAll("[name]").forEach((el) => { form[el.name] = el.value.trim(); });
    if (type === "move") form.from = (state.people.find((p) => p.id === form.employee) || {}).dept;
    return { type, form };
  }

  function previewChain() {
    const { type, form } = readForm();
    const errors = HR.validate(state, type, form);
    let chain = [];
    try { if (!errors.some((e) => e.startsWith("缺少"))) chain = HR.buildChain(state, type, form); } catch (e) { /* 字段未填完 */ }
    $("#new-chain").innerHTML = chain.map((s) => `<li>${esc(nameOf(s.approver))} · ${esc(s.label)}</li>`).join("") || "<li class='muted'>填写完整后显示</li>";
    $("#new-errors").textContent = errors.join("；");
    $("#new-submit").disabled = errors.length > 0;
  }

  function openNew() {
    $("#new-type").innerHTML = Object.entries(HR.TYPES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join("");
    renderNewFields();
    $("#new-dialog").showModal();
  }
  function renderNewFields() {
    const type = $("#new-type").value;
    $("#new-fields").innerHTML = FIELD_DEFS[type].map(([key, label, kind]) => `<label>${label}${input(kind, key)}</label>`).join("");
    if (type === "onboard") { $("#new-fields [name=name]").value = "周以宁"; $("#new-fields [name=title]").value = "产品经理"; }
    if (type === "move") $("#new-fields [name=reason]").value = "业务调整";
    if (type === "exit") $("#new-fields [name=reason]").value = "个人原因";
    previewChain();
  }

  // ---------- 组织编制 ----------
  let orgSel = "D21";
  function bar(count, budget) {
    const ratio = count / budget;
    return `<span class="bar"><i class="${ratio > 1 ? "over" : ratio >= 1 ? "full" : ""}" style="width:${Math.min(100, ratio * 100)}%"></i></span><span class="cnt">${count} / ${budget}</span>`;
  }
  function renderOrg() {
    const children = (pid) => state.org.filter((d) => d.parent === pid);
    const node = (d) => {
      const kids = children(d.id);
      const total = kids.length ? kids.reduce((s, k) => s + HR.headcount(state, k.id), 0) : HR.headcount(state, d.id);
      const budget = kids.length ? kids.reduce((s, k) => s + (k.budget || 0), 0) : d.budget;
      return `<li class="${d.parent === "G" ? "bu" : ""}"><div class="n ${d.id === orgSel ? "sel" : ""}" data-dept="${d.id}">
        <span class="nm">${esc(d.name)}</span>${budget ? bar(total, budget) : `<span class="cnt">${HR.active(state).length} 人</span>`}</div>
        ${kids.length ? `<ul>${kids.map(node).join("")}</ul>` : ""}</li>`;
    };
    $("#tree").innerHTML = `<div class="tree"><ul>${children(null).map(node).join("")}</ul></div>
      <p class="muted">橙色 = 编制已满，红色 = 超编。编制已满的部门入职或调入，会自动在审批链中加入事业部负责人的「超编审批」。</p>`;
    const d = state.org.find((x) => x.id === orgSel);
    const ids = [d.id, ...state.org.filter((x) => x.parent === d.id).map((x) => x.id)];
    const members = HR.active(state).filter((p) => ids.includes(p.dept));
    const head = HR.person(state, d.head);
    $("#members").innerHTML = `<h2>${esc(d.name)}</h2>
      <div class="muted">负责人：${esc(head.name)} · ${esc(head.title)}${d.budget ? ` · 编制 ${HR.headcount(state, d.id)} / ${d.budget}` : ""}</div>
      <table style="margin-top:10px"><thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>岗位</th><th>职级</th><th>状态</th><th>汇报给</th></tr></thead><tbody>
      ${members.map((p) => `<tr><td>${p.id}</td><td>${esc(p.name)}</td><td>${esc(deptName(p.dept))}</td><td>${esc(p.title)}</td><td>${p.grade}</td><td>${p.status}</td><td>${p.dept === "G" ? "—" : esc(nameOf(HR.managerOf(state, p.id)))}</td></tr>`).join("")}
      </tbody></table>`;
  }

  // ---------- 看板 ----------
  function renderDashboard() {
    const m = HR.dashboard(state);
    const pct = (v) => `${Math.round(v * 100)}%`;
    $("#dashboard").innerHTML = `
      <div class="kpis">
        <div class="card kpi"><div class="label">在职人数</div><div class="value">${m.active}</div><div class="sub">其中试用期 ${m.probation} 人</div></div>
        <div class="card kpi"><div class="label">编制使用率</div><div class="value">${pct(m.usage)}</div><div class="sub">${m.staffed} / ${m.budget}（部门级）</div></div>
        <div class="card kpi"><div class="label">进行中流程</div><div class="value">${m.pending}</div><div class="sub">${Object.entries(m.pendingBy).map(([k, v]) => `${esc(k)} ${v}`).join(" · ") || "无积压"}</div></div>
        <div class="card kpi"><div class="label">平均审批时长</div><div class="value">${m.avgHours == null ? "—" : m.avgHours.toFixed(1) + " h"}</div><div class="sub">已通过 ${Object.values(m.byType).reduce((a, b) => a + b, 0)} 单 · ${Object.entries(m.byType).map(([k, v]) => `${HR.TYPES[k].name} ${v}`).join(" · ")}</div></div>
      </div>
      <div class="two">
        <div class="card"><h2>部门编制</h2><table><thead><tr><th>部门</th><th>事业部</th><th style="width:45%">在编 / 编制</th><th>空缺</th></tr></thead><tbody>
          ${m.depts.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.bu)}</td><td><div style="display:flex;gap:8px;align-items:center">${bar(d.count, d.budget)}</div></td><td>${d.budget - d.count}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="card"><h2>口径说明</h2><ul class="muted" style="padding-left:18px;margin:0">
          <li>在职人数不含已离职；编制只统计部门级，事业部与集团负责人不占部门编制。</li>
          <li>审批时长 = 提交到最后一个节点通过，按自然小时计。</li>
          <li>流程通过后立即生效：入职新增人员（试用）、转正改状态、调岗改部门、离职置为离职。</li>
          <li>所有数据保存在本机浏览器（localStorage），右上角「重置」可恢复初始状态。</li>
        </ul></div>
      </div>`;
  }

  // ---------- OA 联调 ----------
  function renderMapping() {
    const type = $("#map-type").value || "onboard";
    $("#map-type").innerHTML = Object.entries(HR.TYPES).map(([k, t]) => `<option value="${k}" ${k === type ? "selected" : ""}>${t.name}（${t.oa}）</option>`).join("");
    const rows = HR.FIELD_MAP.filter((f) => !f.types || f.types.includes(type));
    $("#map-table").innerHTML = `<thead><tr><th>HRIS 字段</th><th>OA 字段</th><th>说明</th><th>转换</th><th>必填</th></tr></thead><tbody>
      ${rows.map((f) => `<tr><td><code>${f.from}</code></td><td><code>${f.to}</code></td><td>${f.label}</td><td class="muted">${f.map ? "映射" : "原值"}</td><td>${f.required ? "是" : ""}</td></tr>`).join("")}</tbody>`;
  }
  function renderLog() {
    $("#oa-log").innerHTML = state.oaLog.length ? state.oaLog.map((l, i) => `<li class="l-${l.level}" ${l.payload ? `data-payload="${i}"` : ""}>
      ${esc(l.at)} · <b>${l.id}</b> · ${esc(l.msg)}${l.payload ? "（点击查看报文）" : ""}</li>`).join("") : `<li class="l-info">还没有同步记录。先在审批中心把流程审批通过，再回来同步。</li>`;
  }
  function showLatestPayload() {
    const entry = state.oaLog.find((l) => l.payload);
    $("#oa-payload").hidden = !entry;
    if (entry) $("#oa-payload").textContent = `// ${entry.id} 推送报文\n` + JSON.stringify(entry.payload, null, 2);
  }
  function sync() {
    const failPlan = {};
    const targets = state.requests.filter((r) => r.status === "approved");
    if ($("#fault").checked) targets.forEach((r) => { failPlan[r.id] = 2; });
    const transport = HR.mockOA(failPlan);
    const at = now();
    if (!targets.length) state.oaLog.unshift({ at, id: "—", level: "info", msg: "没有已通过的流程" });
    targets.forEach((r) => HR.syncToOA(r, transport, (l) => state.oaLog.unshift(l), { at }));
    save();
    renderLog();
    showLatestPayload();
  }

  // ---------- 总渲染与事件 ----------
  function renderAll() {
    renderIdentity();
    document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("on", b.dataset.f === filter));
    renderList();
    renderDetail();
    renderOrg();
    renderDashboard();
    renderMapping();
    renderLog();
    showLatestPayload();
  }

  $("#tabs").addEventListener("click", (e) => {
    const tab = e.target.dataset.tab;
    if (!tab) return;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b === e.target));
    document.querySelectorAll(".page").forEach((p) => { p.hidden = p.id !== tab; });
    location.hash = tab;
  });
  $("#identity").addEventListener("change", (e) => { me = e.target.value; renderAll(); });
  $("#reset").addEventListener("click", () => { localStorage.removeItem(KEY); state = HR.initState(); me = defaultIdentity(); state.oaLog = []; filter = "mine-todo"; renderAll(); });
  $("#filters").addEventListener("click", (e) => { if (e.target.dataset.f) { filter = e.target.dataset.f; renderAll(); } });
  $("#req-list").addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (li) { selected = li.dataset.id; renderAll(); } });
  $("#detail").addEventListener("click", (e) => {
    if (e.target.dataset.act) act(e.target.dataset.act);
    if (e.target.dataset.switch) { me = e.target.dataset.switch; filter = "mine-todo"; renderAll(); }
  });
  $("#tree").addEventListener("click", (e) => { const n = e.target.closest("[data-dept]"); if (n) { orgSel = n.dataset.dept; renderOrg(); } });
  $("#new-btn").addEventListener("click", openNew);
  $("#new-type").addEventListener("change", renderNewFields);
  $("#new-fields").addEventListener("input", previewChain);
  $("#new-fields").addEventListener("change", previewChain);
  $("#new-form").addEventListener("submit", (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    const { type, form } = readForm();
    try {
      const r = HR.submit(state, type, form, me, now());
      save();
      selected = r.id;
      filter = "mine";
    } catch (err) { e.preventDefault(); $("#new-errors").textContent = err.message; return; }
    renderAll();
  });
  $("#map-type").addEventListener("change", renderMapping);
  $("#sync-btn").addEventListener("click", sync);
  $("#resync-btn").addEventListener("click", () => { $("#fault").checked = false; sync(); });
  $("#oa-log").addEventListener("click", (e) => {
    const li = e.target.closest("[data-payload]");
    if (!li) return;
    $("#oa-payload").hidden = false;
    $("#oa-payload").textContent = JSON.stringify(state.oaLog[+li.dataset.payload].payload, null, 2);
  });

  // ?demo：从初始状态走完 R-1001 并同步 OA，方便直接看到完整链路
  if (new URLSearchParams(location.search).has("demo")) {
    state = HR.initState();
    const r = state.requests.find((x) => x.id === "R-1001");
    while (r.status === "pending") HR.approve(state, r, HR.current(r).approver, now(), "同意");
    HR.syncToOA(r, HR.mockOA({ "R-1001": 2 }), (l) => state.oaLog.unshift(l), { at: now() });
    selected = r.id;
    filter = "all";
    me = defaultIdentity();
    save();
  }

  renderAll();
  const tab = location.hash.slice(1);
  if (tab) { const b = document.querySelector(`#tabs [data-tab="${tab}"]`); if (b) b.click(); }
  window.addEventListener("load", () => window.scrollTo(0, 0));
})();
