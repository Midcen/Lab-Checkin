/* 实验室出入登记 —— 纯前端，数据存 Supabase Postgres
 * 记录方式：追加式日志（只 insert，不改不删），"在场/离开"由最后一条记录推导
 */
(function () {
  "use strict";

  var cfg = window.LAB_CONFIG || {};
  var TZ = "Asia/Shanghai";
  var TABLE = cfg.table || "visits";
  var PEOPLE_TABLE = cfg.peopleTable || "people";
  var SEED_PEOPLE = Array.isArray(cfg.people) ? cfg.people.filter(Boolean) : [];
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

  var roster = SEED_PEOPLE.slice();  // config 名单 + 数据库里新加的人
  var serverRecords = [];            // 来自数据库
  var pending = [];                  // 本地还没写成功的记录
  var view = "grid";
  var syncing = false;
  var dialog = null;

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

  function fetchPeople() {
    var url = cfg.supabaseUrl + "/rest/v1/" + PEOPLE_TABLE +
      "?select=name&order=created_at.asc&limit=1000";
    return fetch(url, { headers: headers() }).then(function (res) {
      if (!res.ok) { throw new Error("读取成员失败 " + res.status); }
      return res.json();
    }).then(function (rows) {
      var merged = SEED_PEOPLE.slice();
      rows.forEach(function (row) {
        if (row && row.name && merged.indexOf(row.name) === -1) { merged.push(row.name); }
      });
      roster = merged;
    }).catch(function (err) {
      // people 表还没建的时候不该拖垮整个页面，回退到 config 里的名单
      console.warn(err);
      roster = SEED_PEOPLE.slice();
    });
  }

  function postVisit(row) {
    return fetch(cfg.supabaseUrl + "/rest/v1/" + TABLE, {
      method: "POST",
      headers: headers({ Prefer: "resolution=ignore-duplicates,return=minimal" }),
      body: JSON.stringify([row]),
    }).then(function (res) {
      if (res.status === 400) {
        var err = new Error("写入被拒 400");
        err.status = 400;
        throw err;
      }
      if (!res.ok) { throw new Error("写入失败 " + res.status); }
    });
  }

  function insertRecord(rec) {
    var row = {
      id: rec.id,
      person: rec.person,
      action: rec.action,
      at: rec.at,
      at_local: rec.at_local,
    };
    return postVisit(row).catch(function (err) {
      // 库还没跑 supabase-update.sql（缺 at_local 列）时退回旧字段，宁可少一列也别把记录丢了
      if (err.status !== 400 || !row.at_local) { throw err; }
      return postVisit({
        id: row.id, person: row.person, action: row.action, at: row.at,
      });
    });
  }

  function insertPerson(name) {
    return fetch(cfg.supabaseUrl + "/rest/v1/" + PEOPLE_TABLE, {
      method: "POST",
      headers: headers({ Prefer: "resolution=ignore-duplicates,return=minimal" }),
      body: JSON.stringify([{ name: name }]),
    }).then(function (res) {
      if (res.status === 404) {
        throw new Error("数据库里还没有 people 表，先跑一次 supabase-update.sql");
      }
      if (!res.ok) { throw new Error("添加失败 " + res.status); }
    });
  }

  // 逐条重试，遇到失败就停下（大概率是断网），下次触发时继续
  function flush() {
    if (syncing || !pending.length) { return Promise.resolve(); }
    syncing = true;
    var queue = pending.slice();   // 固定这一批：待同步数组会在成功后被裁剪，不能边删边按下标走
    var i = 0;
    function step() {
      if (i >= queue.length) { syncing = false; render(); return; }
      var rec = queue[i];
      return insertRecord(rec).then(function () {
        // 写成功就把这条从待同步挪进已确认，避免界面在下次拉取前回退
        serverRecords.push({
          id: rec.id, person: rec.person, action: rec.action,
          at: rec.at, at_local: rec.at_local,
        });
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

  // 北京时间的墙上时钟字符串，写进数据库的 at_local 列，方便直接看表格
  function bjWallClock(date) {
    var parts = {};
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
    return parts.year + "-" + parts.month + "-" + parts.day + "T" +
      parts.hour + ":" + parts.minute + ":" + parts.second;
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
    roster.forEach(function (p) {
      var last = lastRecordOf(p);
      if (last && last.action === "in") { present += 1; }
    });
    $("#present").textContent = present + " 人在场";
    $("#viewToggle").textContent = view === "grid" ? "今日记录" : "返回打卡";
    $("#grid").hidden = view !== "grid";
    $("#recordsView").hidden = view === "grid";

    var fab = $("#addPerson");
    fab.hidden = !(configured() && cfg.allowAddPerson !== false);
  }

  function renderGrid() {
    var grid = $("#grid");
    var now = Date.now();
    var frag = document.createDocumentFragment();

    if (!roster.length) {
      var empty = document.createElement("p");
      empty.className = "grid-empty";
      empty.textContent = configured() && cfg.allowAddPerson !== false
        ? "还没有成员，点右下角的加号添加第一位。"
        : "人员名单是空的，先在 config.js 里填上名字。";
      frag.appendChild(empty);
    }

    roster.forEach(function (person) {
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

  /* ---------------- 弹窗 ---------------- */

  function closeDialog() {
    if (dialog) {
      dialog.remove();
      dialog = null;
    }
  }

  function showDialog(opts) {
    closeDialog();

    var overlay = document.createElement("div");
    overlay.className = "overlay";

    var box = document.createElement("div");
    box.className = "dialog";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", opts.title);

    var title = document.createElement("h2");
    title.className = "dialog-title";
    title.textContent = opts.title;
    box.appendChild(title);

    if (opts.desc) {
      var desc = document.createElement("p");
      desc.className = "dialog-desc";
      desc.textContent = opts.desc;
      box.appendChild(desc);
    }

    if (opts.items && opts.items.length) {
      var ul = document.createElement("ul");
      ul.className = "checklist";
      opts.items.forEach(function (text) {
        var li = document.createElement("li");
        var tick = document.createElement("span");
        tick.className = "tick";
        tick.textContent = "✓";
        tick.setAttribute("aria-hidden", "true");
        var label = document.createElement("span");
        label.textContent = text;
        li.appendChild(tick);
        li.appendChild(label);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    var input = null;
    if (opts.input) {
      input = document.createElement("input");
      input.className = "dialog-input";
      input.type = "text";
      input.placeholder = opts.input.placeholder || "";
      input.maxLength = opts.input.maxLength || 20;
      input.autocomplete = "off";
      box.appendChild(input);
    }

    var actions = document.createElement("div");
    actions.className = "dialog-actions";

    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost";
    cancel.textContent = opts.cancelText || "取消";
    cancel.addEventListener("click", function () {
      closeDialog();
      if (opts.onCancel) { opts.onCancel(); }
    });

    var ok = document.createElement("button");
    ok.type = "button";
    ok.className = "primary";
    ok.textContent = opts.confirmText || "确定";
    ok.addEventListener("click", function () {
      var value = input ? input.value.trim() : "";
      if (input && !value) { input.focus(); return; }
      closeDialog();
      if (opts.onConfirm) { opts.onConfirm(value); }
    });

    actions.appendChild(cancel);
    actions.appendChild(ok);
    box.appendChild(actions);
    overlay.appendChild(box);

    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) {
        closeDialog();
        if (opts.onCancel) { opts.onCancel(); }
      }
    });

    document.body.appendChild(overlay);
    dialog = overlay;

    if (input) {
      ok.disabled = !input.value.trim();
      input.addEventListener("input", function () { ok.disabled = !input.value.trim(); });
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && input.value.trim()) {
          ev.preventDefault();
          ok.click();
        }
      });
      setTimeout(function () { input.focus(); }, 40);
    } else {
      setTimeout(function () { ok.focus(); }, 40);
    }
  }

  /* ---------------- 交互 ---------------- */

  function newId() {
    if (window.crypto && window.crypto.randomUUID) { return window.crypto.randomUUID(); }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function commit(person, action) {
    var now = new Date();
    var rec = {
      id: newId(),
      person: person,
      action: action,
      at: now.toISOString(),
      at_local: bjWallClock(now),
      __local: true,
    };

    pending.push(rec);
    savePending();
    render();
    toast((action === "in" ? "已签到 " : "已签退 ") + clockOf(now));
    flush();
  }

  // 此刻还在场的人数，排除掉正在签退的这个人
  function presentOthers(person) {
    var lastByPerson = {};
    allRecords().forEach(function (r) { lastByPerson[r.person] = r; });
    var count = 0;
    Object.keys(lastByPerson).forEach(function (name) {
      if (name !== person && lastByPerson[name].action === "in") { count += 1; }
    });
    return count;
  }

  function onTap(person) {
    var last = lastRecordOf(person);
    if (last && Math.abs(Date.now() - new Date(last.at).getTime()) < TAP_GUARD_MS) {
      toast("刚记过，5 秒内不重复记");
      return;
    }

    if (last && last.action === "in") {
      var reminder = cfg.leaveReminder || {};
      // 只有「自己走之后实验室就没别人了」才提醒，中途出去不打扰
      if (reminder.enabled !== false && presentOthers(person) === 0) {
        showDialog({
          title: reminder.title || "离开前请确认",
          desc: (reminder.desc || "{person}，实验室里只剩你了，请确认：")
            .replace("{person}", person),
          items: reminder.items || ["关好窗户", "关闭电闸", "锁好门"],
          confirmText: reminder.confirmText || "已确认，签退",
          cancelText: reminder.cancelText || "取消",
          onConfirm: function () { commit(person, "out"); },
        });
        return;
      }
      commit(person, "out");
      return;
    }

    commit(person, "in");
  }

  function addPerson(name) {
    if (roster.indexOf(name) !== -1) {
      toast("「" + name + "」已经在名单里");
      return;
    }
    roster.push(name);
    render();
    insertPerson(name).then(function () {
      toast("已添加 " + name);
    }).catch(function (err) {
      console.warn(err);
      roster = roster.filter(function (n) { return n !== name; });
      render();
      toast(err.message || "添加失败，请检查网络");
    });
  }

  function exportCsv() {
    var today = dayOf(Date.now());
    var rows = allRecords().filter(function (r) { return dayOf(r.at) === today; });
    var lines = ["姓名,动作,日期,时间"];
    rows.forEach(function (r) {
      lines.push([
        r.person,
        r.action === "in" ? "进入" : "离开",
        dayOf(r.at),
        clockOf(r.at),
      ].join(","));
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
    return Promise.all([fetchRecords(), fetchPeople()])
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

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && dialog) { closeDialog(); }
    });

    $("#viewToggle").addEventListener("click", function () {
      view = view === "grid" ? "records" : "grid";
      render();
    });
    $("#exportCsv").addEventListener("click", exportCsv);
    $("#refresh").addEventListener("click", function () {
      refresh().then(function () { toast("已刷新"); });
    });
    $("#addPerson").addEventListener("click", function () {
      showDialog({
        title: "添加成员",
        desc: "输入姓名，加进来的人会存到数据库，所有设备都能看到。",
        input: { placeholder: "姓名", maxLength: 20 },
        confirmText: "添加",
        cancelText: "取消",
        onConfirm: addPerson,
      });
    });

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
