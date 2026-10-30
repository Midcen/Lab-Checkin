/* 实验室出入登记 —— 纯前端，数据存 Supabase Postgres
 * 记录方式：追加式日志（只 insert，不改不删），"在场/离开"由最后一条记录推导
 */
(function () {
  "use strict";

  var cfg = window.LAB_CONFIG || {};
  var TZ = "Asia/Shanghai";
  var TABLE = cfg.table || "visits";
  var PEOPLE = Array.isArray(cfg.people) ? cfg.people.filter(Boolean) : [];
  var LOOKBACK_HOURS = 72;   // 往前读多久的记录用于判断当前状态（覆盖通宵）
  var TAP_GUARD_MS = 5000;   // 连点保护：同一个名字 5 秒内只认一次
  var POLL_MS = 60000;       // 轮询间隔，多台设备之间保持同步
  var QUEUE_KEY = "lab_checkin_queue_v1";

  var dtDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  });
  var dtTime = new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  var dayOf = function (t) { return dtDate.format(new Date(t)); };
  var clockOf = function (t) { return dtTime.format(new Date(t)); };

  var $ = function (sel) { return document.querySelector(sel); };

  var serverRecords = [];  // 来自数据库
  var pending = [];        // 本地还没写成功的记录
  var view = "grid";
  var syncing = false;

  /* ---------------- 本地离线队列 ---------------- */

  function loadPending() {
    try {
      var raw = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
      pending = Array.isArray(raw) ? raw : [];
    } catch (e) {
      pending = [];
    }
  }

  function savePending() {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(pending)); } catch (e) {}
  }

  function allRecords() {
    return serverRecords.concat(pending).sort(function (a, b) {
      return new Date(a.at) - new Date(b.at);
    });
  }

  function recordsOf(person) {
    return allRecords().filter(function (r) { return r.person === person; });
  }

  function lastRecordOf(person) {
    var rs = recordsOf(person);
    return rs.length ? rs[rs.length - 1] : null;
  }

  /* ---------------- 接口 ---------------- */

  function configured() {
    return Boolean(
      cfg.supabaseUrl &&
      cfg.supabaseAnonKey &&
      cfg.supabaseUrl.indexOf("YOUR-PROJECT") === -1 &&
      cfg.supabaseAnonKey.indexOf("YOUR-ANON-KEY") === -1
    );
  }

  function headers(extra) {
    var h = {
      apikey: cfg.supabaseAnonKey,
      Authorization: "Bearer " + cfg.supabaseAnonKey,
      "Content-Type": "application/json",
    };
    if (extra) { Object.keys(extra).forEach(function (k) { h[k] = extra[k]; }); }
    return h;
  }

  function fetchRecords() {
    var since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
    var url = cfg.supabaseUrl + "/rest/v1/" + TABLE +
      "?select=id,person,action,at" +
      "&at=gte." + encodeURIComponent(since) +
      "&order=at.asc&limit=2000";
    return fetch(url, { headers: headers() }).then(function (res) {
      if (!res.ok) { throw new Error("读取失败 " + res.status); }
      return res.json();
    }).then(function (rows) {
      serverRecords = rows;
      // 服务端已经有的记录，从待同步队列里去掉
      var ids = {};
      rows.forEach(function (r) { ids[r.id] = true; });
      var before = pending.length;
      pending = pending.filter(function (p) { return !ids[p.id]; });
      if (pending.length !== before) { savePending(); }
    });
  }

  function insertRecord(rec) {
    return fetch(cfg.supabaseUrl + "/rest/v1/" + TABLE, {
      method: "POST",
      headers: headers({ Prefer: "resolution=ignore-duplicates,return=minimal" }),
      body: JSON.stringify([{
        id: rec.id,
        person: rec.person,
        action: rec.action,
        at: rec.at,
      }]),
    }).then(function (res) {
      if (!res.ok) { throw new Error("写入失败 " + res.status); }
    });
  }

  // 逐条重试，遇到失败就停下（大概率是断网），下次触发时继续
  function flush() {
    if (syncing || !pending.length) { return Promise.resolve(); }
    syncing = true;
    var i = 0;
    function step() {
      if (i >= pending.length) { syncing = false; render(); return; }
      var rec = pending[i];
      return insertRecord(rec).then(function () {
        // 写成功就把这条从待同步挪进已确认，避免界面在下次拉取前回退
        serverRecords.push({ id: rec.id, person: rec.person, action: rec.action, at: rec.at });
        pending = pending.filter(function (p) { return p.id !== rec.id; });
        savePending();
        i += 1;
        return step();
      }).catch(function (err) {
        console.warn(err);
        syncing = false;
        render();
      });
    }
    return step();
  }

  /* ---------------- 时间统计 ---------------- */

  // 今日累计时长（毫秒）和当前这段的起点
  function todayStats(person) {
    var today = dayOf(Date.now());
    var rs = recordsOf(person).filter(function (r) { return dayOf(r.at) === today; });
    var total = 0;
    var openSince = null;
    rs.forEach(function (r) {
      if (r.action === "in") {
        openSince = new Date(r.at).getTime();
      } else if (openSince !== null) {
        total += Math.max(0, new Date(r.at).getTime() - openSince);
        openSince = null;
      }
    });
    return { total: total, openSince: openSince, count: rs.length };
  }

  function humanDuration(ms) {
    var minutes = Math.floor(ms / 60000);
    if (minutes < 1) { return "不到 1 分"; }
    if (minutes < 60) { return minutes + " 分钟"; }
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return m ? h + " 小时 " + m + " 分" : h + " 小时";
  }

  function hueOf(name) {
    var h = 0;
    for (var i = 0; i < name.length; i += 1) {
      h = (h * 31 + name.codePointAt(i)) % 360;
    }
    return h;
  }

  function initialOf(name) {
    return name.slice(0, 1);
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    renderHeader();
    if (view === "grid") { renderGrid(); } else { renderRecords(); }
    renderSync();
  }

  function renderHeader() {
    $("#title").textContent = cfg.title || "实验室出入登记";
    $("#clock").textContent = clockOf(Date.now());

    var present = 0;
    PEOPLE.forEach(function (p) {
      var last = lastRecordOf(p);
      if (last && last.action === "in") { present += 1; }
    });
    $("#present").textContent = present + " 人在场";
    $("#viewToggle").textContent = view === "grid" ? "今日记录" : "返回打卡";
    $("#grid").hidden = view !== "grid";
    $("#recordsView").hidden = view === "grid";
  }

  function renderGrid() {
    var grid = $("#grid");
    var now = Date.now();
    var frag = document.createDocumentFragment();

    PEOPLE.forEach(function (person) {
      var last = lastRecordOf(person);
      var stats = todayStats(person);
      var isIn = Boolean(last && last.action === "in");
      var h = hueOf(person);

      var card = document.createElement("button");
      card.type = "button";
      card.className = "card" + (isIn ? " is-in" : "");
      card.dataset.person = person;
      card.setAttribute("aria-pressed", isIn ? "true" : "false");
      card.setAttribute("aria-label", person + (isIn ? " 签退" : " 签到"));

      var avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = initialOf(person);
      avatar.style.background = "hsl(" + h + " 70% 93%)";
      avatar.style.color = "hsl(" + h + " 45% 32%)";

      var name = document.createElement("span");
      name.className = "name";
      name.textContent = person;

      var status = document.createElement("span");
      status.className = "status";
      var dot = document.createElement("i");
      dot.className = "dot";
      status.appendChild(dot);
      if (isIn) {
        var since = new Date(last.at).getTime();
        status.appendChild(document.createTextNode(
          "在场 " + humanDuration(Math.max(0, now - since))
        ));
      } else if (last) {
        status.appendChild(document.createTextNode("已离开 " + clockOf(last.at)));
      } else {
        status.appendChild(document.createTextNode("今日未签到"));
      }

      var total = document.createElement("span");
      total.className = "total";
      total.textContent = stats.count
        ? "今日累计 " + humanDuration(stats.total + (stats.openSince ? now - stats.openSince : 0))
        : "—";

      card.appendChild(avatar);
      card.appendChild(name);
      card.appendChild(status);
      card.appendChild(total);
      frag.appendChild(card);
    });

    grid.replaceChildren(frag);
  }

  function renderRecords() {
    var today = dayOf(Date.now());
    var rows = allRecords()
      .filter(function (r) { return dayOf(r.at) === today; })
      .reverse();

    var list = $("#todayList");
    list.replaceChildren();

    if (!rows.length) {
      var empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "今天还没有记录";
      list.appendChild(empty);
      return;
    }

    var frag = document.createDocumentFragment();
    rows.forEach(function (r) {
      var li = document.createElement("li");
      li.className = "record";

      var time = document.createElement("span");
      time.className = "record-time";
      time.textContent = clockOf(r.at);

      var who = document.createElement("span");
      who.className = "record-name";
      who.textContent = r.person;

      var badge = document.createElement("span");
      badge.className = "badge " + (r.action === "in" ? "badge-in" : "badge-out");
      badge.textContent = r.action === "in" ? "进入" : "离开";

      li.appendChild(time);
      li.appendChild(who);
      li.appendChild(badge);
      if (r.__local) {
        var tag = document.createElement("span");
        tag.className = "badge badge-pending";
        tag.textContent = "待同步";
        li.appendChild(tag);
      }
      frag.appendChild(li);
    });
    list.appendChild(frag);
  }

  function renderSync() {
    var el = $("#syncState");
    if (!configured()) {
      el.textContent = "未配置";
      el.className = "sync sync-warn";
      return;
    }
    if (pending.length) {
      el.textContent = "待同步 " + pending.length + " 条";
      el.className = "sync sync-warn";
    } else {
      el.textContent = "已同步";
      el.className = "sync";
    }
  }

  var toastTimer = null;
  function toast(message) {
    var el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 1800);
  }

  /* ---------------- 交互 ---------------- */

  function newId() {
    if (window.crypto && window.crypto.randomUUID) { return window.crypto.randomUUID(); }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function onTap(person) {
    var last = lastRecordOf(person);
    if (last && Math.abs(Date.now() - new Date(last.at).getTime()) < TAP_GUARD_MS) {
      toast("刚记过，5 秒内不重复记");
      return;
    }

    var action = last && last.action === "in" ? "out" : "in";
    var rec = {
      id: newId(),
      person: person,
      action: action,
      at: new Date().toISOString(),
      __local: true,
    };

    pending.push(rec);
    savePending();
    render();
    toast((action === "in" ? "已签到 " : "已签退 ") + clockOf(rec.at));
    flush();
  }

  function exportCsv() {
    var today = dayOf(Date.now());
    var rows = allRecords().filter(function (r) { return dayOf(r.at) === today; });
    var lines = ["姓名,动作,时间"];
    rows.forEach(function (r) {
      lines.push([r.person, r.action === "in" ? "进入" : "离开", clockOf(r.at)].join(","));
    });
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "出入记录-" + today + ".csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function refresh() {
    if (!configured()) { return Promise.resolve(); }
    return fetchRecords()
      .then(function () { render(); return flush(); })
      .catch(function (err) {
        console.warn(err);
        var notice = $("#notice");
        notice.hidden = false;
        notice.textContent = "读取数据失败：" + err.message + "（记录仍会先存在本机，恢复网络后自动补传）";
      });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    loadPending();

    if (!configured()) {
      var notice = $("#notice");
      notice.hidden = false;
      notice.innerHTML = "还没配置数据库：打开 <code>config.js</code>，填入 Supabase 的 URL 和 anon key，并确认人员名单。";
    }

    document.addEventListener("click", function (ev) {
      var card = ev.target.closest(".card");
      if (card) { onTap(card.dataset.person); }
    });

    $("#viewToggle").addEventListener("click", function () {
      view = view === "grid" ? "records" : "grid";
      render();
    });
    $("#exportCsv").addEventListener("click", exportCsv);
    $("#refresh").addEventListener("click", function () { refresh().then(function () { toast("已刷新"); }); });

    window.addEventListener("online", function () { flush(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") { refresh(); }
    });

    render();
    refresh();

    setInterval(function () { render(); }, 30000);
    setInterval(function () { refresh(); }, POLL_MS);
  }

  boot();
})();
