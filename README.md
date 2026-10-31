# 实验室出入登记

一个纯静态网页：点一下头像 = 签到，再点一下 = 签退，时间自动进数据库，随时导出表格。

- 前端：原生 HTML/CSS/JS，无构建、无依赖，任何静态托管都能放（GitHub Pages / Cloudflare Pages / Vercel）
- 后端：Supabase 免费 Postgres，前端直接调 REST 接口（不需要自己写服务端）
- 记录模型：**只追加的日志**（insert only，不能改不能删）。"谁在场"由每个人的最后一条记录推导，所以不会出现状态错乱
- 时区：一律按 `Asia/Shanghai` 显示和分组
- 断网容错：写不进去的先存手机本地，联网后自动补传

```
lab-checkin/
├── index.html            页面结构
├── styles.css            样式（含深色模式）
├── config.js             唯一需要改的文件：数据库地址 + 初始名单 + 各种开关
├── app.js                全部逻辑
├── supabase.sql          全新安装用的建表脚本
├── supabase-update.sql   已在用的库升级用（可重复执行）
├── dev/mock.py           本地假后端，不连数据库也能预览
└── README.md
```

---

## 一、建数据库（约 10 分钟，免费）

全新安装：

1. 打开 https://supabase.com 注册，新建一个 project（Region 选 `Northeast Asia (Tokyo)` 或 `Singapore`，离北京近一些）。
2. 左侧 **SQL Editor** → New query → 把 `supabase.sql` 全文粘进去 → **Run**。
3. 左侧 **Project Settings → API**，复制 `Project URL` 和 `anon` `public` key。

**已经在用的库**：只需在 SQL Editor 里跑一次 `supabase-update.sql`，它会补上北京时间列、补齐历史数据、建成员表。可以重复跑，不会覆盖数据。

> anon key 放在前端是 Supabase 的官方设计：它只代表"匿名权限"，真正的边界由数据库里的 RLS 策略决定。建表脚本只给了匿名用户"新增"和"读取"两项权限，改和删是拿不到的。

## 二、填配置

打开 `config.js`：

```js
supabaseUrl: "https://…supabase.co",
supabaseAnonKey: "sb_publishable_…",
people: ["史家维", "…"],        // 初始名单

allowAddPerson: true,           // 是否允许网页右下角加号添加成员
leaveReminder: {                // 签退时的离开检查清单，仅最后一人离开时弹
  enabled: true,
  title: "离开前请确认",
  desc: "{person}，实验室里只剩你了，请确认：",
  items: ["关好窗户", "关闭电闸", "锁好门"],
  confirmText: "已确认，签退",
  cancelText: "取消",
},
```

`people` 里的人排在前面，之后在网页上加的人追加在后面并存在数据库里，不用再改这个文件。名字是记录的主键，**改名会让历史记录对不上**。

## 三、本地先看效果

```bash
cd lab-checkin
py -m http.server 8000
```

浏览器打开 http://127.0.0.1:8000 。点几个头像，然后去 Supabase 的 **Table Editor → visits** 看数据是否进来。

不想碰真实数据库时，用假后端预览：

```bash
py dev/mock.py          # 假 Supabase，监听 8788，数据只在内存里
```

把 `config.js` 的 `supabaseUrl` 临时改成 `"http://127.0.0.1:8788"`、`supabaseAnonKey` 随便填（如 `"local-test"`），打开 http://127.0.0.1:8788 即可。看完记得改回真地址。

## 四、部署

1. GitHub 新建 **public** 仓库。
2. 把 `index.html`、`styles.css`、`config.js`、`app.js` **四个文件放在仓库根目录**（放在子文件夹里会导致根地址只显示 README）。
3. **Settings → Pages** → Source 选 `Deploy from a branch` → Branch `main`、目录 `/ (root)` → Save。
4. 一两分钟后地址是 `https://<用户名>.github.io/<仓库名>/`，做成二维码贴门边。

---

## 使用方式

- **进门**：点自己的头像 → 变绿显示"在场 x 分钟"，底部提示"已签到 14:32"。
- **离开**：再点一下。如果此时实验室里还有别人，直接记为离开；**只有你走之后实验室就空了，才弹出离开提醒**（关窗 / 电闸 / 锁门），确认后才记为离开。点"取消"不会产生任何记录。
- **加人**：右下角加号 → 输姓名 → 添加。写入 `people` 表，所有设备、所有人刷新后都能看到。
- **今日记录**：右上角切换，能看到当天全部流水并导出 CSV。
- 卡片第二行小字是今日累计时长，进出成对才计入。

## 关于时间：为什么有两列

| 列 | 内容 | 用来看什么 |
|---|---|---|
| `at` | 标准时间点（UTC 存储，`timestamptz`） | 程序内部排序、算时长，换算永远不会错 |
| `at_local` | 同一时刻的北京时间，如 `2026-10-31T19:22:24` | 在 Table Editor 里直接看这一列 |

Supabase 的表格界面默认按 UTC 显示 `timestamptz`，所以你看到 `at` 会差 8 小时。这是正常的，不是记错了时间——19:22 的签到对应 `at = 11:22Z`。加 `at_local` 就是为了让人不用心算。历史记录已经由 `supabase-update.sql` 一次性补齐。

## 需要知道的几个坑

**1. 国内访问 github.io 不稳定。** 校园网和移动网络下偶尔很慢甚至打不开。卡的话把这四个文件原样搬到 Cloudflare Pages（连 GitHub 仓库自动部署）或 Vercel，国内速度通常好一些，代码一行不用改。

**2. Supabase 免费项目闲置一周会暂停。** 每天有人点就没事；寒暑假长期不用，需要进控制台点一下 Restore。

**3. 纯软件挡不住代签。** 任何人拿到链接都能点别人的头像。只做留档通常无所谓；要拿来考核就得再加一层（每人 4 位 PIN，点自己头像后输 PIN）。

**4. 时间是点击那一刻的手机时钟。** 手机时间错了记录就错。在意的话可以让数据库用 `now()` 生成 `at`，代价是失去离线排队能力。

**5. anon key 能读到全部记录。** 拿到 key 的人能看到所有人什么时间来、待多久。实验室内部用问题不大，但别把地址发到公开群里。

**6. 离开提醒是提醒，不是审计。** 弹窗把清单摆在你面前，点"已确认"就记签退，不校验这几件事是否真做了。触发条件是"你走之后没别人在场了"，判断依据是每个人最后一条记录——所以如果有人忘了签退（72 小时内的都算在场），后面真正最后走的人反而不会看到提醒。遇到这种情况让对方补一次签退即可。

## 数据维护

- 导出：页面"导出 CSV"，或 **Table Editor → visits → Export** 拿全量。
- 清理旧记录：`delete from visits where at < now() - interval '180 days';`（匿名用户没这个权限，要在 SQL Editor 里跑）
- 删掉加错的人：`delete from people where name = '张三';`（历史记录里的名字不会跟着变，需要的话另外 update `visits`）
- 统计工时：SQL Editor 里按 `person`、按 `at_local::date` 聚合。
