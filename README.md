# 实验室出入登记

一个纯静态网页：点一下头像 = 签到，再点一下 = 签退，时间自动进数据库，随时导出表格。

- 前端：原生 HTML/CSS/JS，无构建、无依赖，任何静态托管都能放（GitHub Pages / Cloudflare Pages / Vercel）
- 后端：Supabase 免费 Postgres，前端直接调 REST 接口（不需要自己写服务端）
- 记录模型：**只追加的日志**（insert only，不能改不能删）。"谁在场"由每个人的最后一条记录推导，所以不会出现状态错乱
- 时区：一律按 `Asia/Shanghai` 显示和分组
- 断网容错：写不进去的先存手机本地，联网后自动补传

```
lab-checkin/
├── index.html     页面结构
├── styles.css     样式（含深色模式）
├── config.js      唯一需要改的文件：数据库地址 + 人员名单
├── app.js         全部逻辑
├── supabase.sql   建表脚本
└── README.md
```

---

## 一、建数据库（约 10 分钟，免费）

1. 打开 https://supabase.com 注册，新建一个 project（Region 选 `Northeast Asia (Tokyo)` 或 `Singapore`，离北京近一些）。
2. 左侧 **SQL Editor** → New query → 把 `supabase.sql` 全文粘进去 → **Run**。
3. 左侧 **Project Settings → API**，复制两样东西：
   - `Project URL`（形如 `https://abcdefghijkl.supabase.co`）
   - `anon` `public` key（很长的一串 JWT）

> anon key 放在前端是 Supabase 的官方设计：它只代表"匿名权限"，真正的边界由数据库里的 RLS 策略决定。`supabase.sql` 已经只给了匿名用户"新增"和"读取"两项权限，改和删是拿不到的。

## 二、填配置

打开 `config.js`：

```js
supabaseUrl: "https://abcdefghijkl.supabase.co",
supabaseAnonKey: "eyJhbGciOi...",
people: ["史家维", "张伟", "李娜"],   // 改成你们实验室的名单
```

人员名单就是这个页面上的按钮，按顺序排。名字是记录的主键，**改名字会导致历史记录对不上**，要改名的话先在数据库里批量 update 旧记录。

## 三、本地先看效果

```bash
cd lab-checkin
py -m http.server 8000
```

浏览器打开 http://127.0.0.1:8000 。点几个头像，然后去 Supabase 的 **Table Editor → visits** 看数据是否进来。

如果暂时不想注册 Supabase，想先看看界面长什么样：

```bash
py dev/mock.py          # 启动一个假的 Supabase，监听 8788
```

然后把 `config.js` 里的 `supabaseUrl` 临时改成 `"http://127.0.0.1:8788"`、`supabaseAnonKey` 随便填（比如 `"local-test"`），直接打开 http://127.0.0.1:8788 。`dev/mock.py` 顺带把整个目录当成静态站托管，数据只存在内存里，关掉就清空。看完记得把配置改回真地址。

## 四、部署到 GitHub Pages

1. 在 GitHub 新建一个 **public** 仓库，比如 `lab-checkin`。
2. 把 `index.html`、`styles.css`、`config.js`、`app.js` 四个文件上传到仓库根目录（README 和 supabase.sql 可以一起传，不影响）。
3. 仓库 **Settings → Pages** → Source 选 `Deploy from a branch` → Branch 选 `main`、目录选 `/ (root)` → Save。
4. 等一两分钟，地址是 `https://<你的用户名>.github.io/lab-checkin/`。
5. 用任意二维码生成器把这个地址做成二维码，打印出来贴在门边。

之后改名单就改 `config.js` 再提交一次，Pages 一分钟内自动更新。

---

## 使用方式

- 进门：找到自己的头像点一下 → 卡片变绿显示"在场 x 分钟"，底部提示"已签到 14:32"。
- 离开：再点一下 → 变灰显示"已离开 17:05"。
- 右上角"今日记录"能看到今天所有人的进出流水，可以导出 CSV。
- 卡片第二行小字是今日累计时长，进出成对才计入。

## 需要知道的几个坑

**1. 国内访问 github.io 不稳定。** 校园网和移动网络下偶尔很慢甚至打不开。如果实测卡，把同样四个文件原样搬到 Cloudflare Pages（连接 GitHub 仓库即可自动部署，免费）或 Vercel，国内速度通常好一些。文件本身不依赖任何外网 CDN，换托管方什么都不用改。

**2. Supabase 免费项目闲置一周会暂停。** 每天有人点就没事；如果放寒暑假长期没人用，重新启用要进控制台点一下 Restore。

**3. 纯软件挡不住代签。** 任何人拿到链接都能点别人的头像。如果这份记录只用于留档，这通常无所谓；如果要拿来考核，再加一层：给每个人一个 4 位 PIN（存数据库里做比对），或者改成"点自己的头像 → 弹数字键盘 → 输 PIN"。要加的话告诉我。

**4. 时间是点击那一刻的手机时钟。** 手机时间错了记录就错。如果在意准确性，可以把 `app.js` 里的 `at: new Date().toISOString()` 改成让数据库用 `now()` 生成时间（代价是断网时无法离线排队）。

**5. anon key 能读到全部记录。** 拿到 key 的人可以看到所有人什么时间来、待了多久。实验室内部用问题不大，但别把这个地址发到公开群里。

## 数据维护

- 导出：页面上"导出 CSV"，或 Supabase **Table Editor → visits → Export** 拿全量 CSV。
- 清理：`delete from visits where at < now() - interval '180 days';`（注意：匿名用户没这个权限，得在 SQL Editor 里用管理员身份跑）
- 统计某月工时：SQL Editor 里按 `person`、按天聚合，比纸表翻页快得多。
