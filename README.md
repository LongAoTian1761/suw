# 国际宏观经济学 · 课后题与解答

课程教材：**Schmitt-Grohé, Uribe & Woodford, _International Macroeconomics_**（2021 年 5 月 25 日草稿版）。
网站收录了 **15 章、161 道课后题**，分为书中的四个部分。

一个可以直接部署到 GitHub Pages 的网站：教师维护每道习题的题目与参考思路，
**同学打开网页填完就能提交作业 —— 不需要注册、不需要登录、不需要任何账号**，
答案连同附件一起存下来，并展示在对应习题页面。

> 第一次上手？直接照着 [GO-LIVE.md](GO-LIVE.md) 一步步做就行 ——
> 那是一份按顺序排好的上线清单，含验收步骤和排错表。

```
首页（按四个部分列出 15 章）  →  章节页  →  习题页（题目 / 参考思路 / 同学作业 / 上传入口）
                  ↘ 全部作业墙（可搜索、可筛选）
```

## 三步接入接收服务器

同学端之所以能做到「零账号」，是因为答案和附件直接写进 Supabase
（免费额度足够一个班用很多年）。你只需要配置一次，大约 5 分钟。

**第一步**　到 [supabase.com](https://supabase.com) 注册（免费），新建一个 Project。

**第二步**　左侧 **SQL Editor → New query**，把 [`supabase/schema.sql`](supabase/schema.sql)
整个文件粘贴进去，点 **Run**。它会建好表、权限和存放附件的存储桶。

**第三步**　左侧 **Project Settings → API**，复制两个值填进 `data/course.json`：

```json
"submission": {
  "backend": "supabase",
  "supabase": {
    "url": "https://xxxxxxxxxxxx.supabase.co",
    "anonKey": "eyJhbGciOi...",
    "table": "submissions",
    "bucket": "answer-uploads",
    "maxFileMb": 20,
    "autoApprove": true
  }
}
```

然后重新构建并推送：

```bash
npm run build
```

想确认真的通了，跑一次体检脚本：

```bash
node scripts/check-backend.mjs
```

它会用**和浏览器完全相同的公钥**逐项验证：能不能匿名提交、能不能传附件、
有没有把整张表暴露出去、有没有办法绕过前端给自己「加精」。全绿就说明同学可以用了。

> `anonKey` 本来就是设计成公开的，写进网页没有安全问题——真正拦人的是
> `schema.sql` 里的行级权限（RLS）。**绝对不要**把 `service_role` key 写进网页，
> 那个只在你自己的电脑或 CI 上用。

### 不想注册 Supabase，只想先看看效果

```bash
npm run mock-backend        # 本地假后端 → http://localhost:4174

# 另开一个终端
$env:SUPABASE_URL="http://localhost:4174"
$env:SUPABASE_ANON_KEY="local-test-key-000000000000000000"
npm run build
npm run dev                 # 打开 /submit.html 试一次真实上传
```

（macOS / Linux 用 `SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run build`。）
数据只存在内存里，进程一停就没了，纯粹用来演示「免账号直接上传」这条路。

## 同学是怎么交作业的

| 步骤 | 同学看到的 | 背后发生的事 |
| --- | --- | --- |
| 1 | 打开 `/submit.html`，选习题、填姓名、写答案正文 | 下方实时预览公式排版效果 |
| 2 | 把手写照片、PDF、代码拖进附件框 | 文件在浏览器里排队，还没上传 |
| 3 | 点「提交我的答案」 | 附件直传存储桶，答案写入数据库，全程无需账号 |
| 4 | 看到「提交成功」和一行提交编号 | `autoApprove: true` 时立刻出现在习题页与作业墙 |

整条路径没有注册、没有登录、没有邮箱验证。同学填的是「姓名或昵称」，
填「匿名」就不会公开显示姓名；班级 / 学号只存进数据库，页面上不展示。

### 三种后端，随时可换

改 `data/course.json` → `site.submission.backend`：

| 取值 | 同学体验 | 适用场景 |
| --- | --- | --- |
| `supabase`（默认） | 零账号，填完直接上传 | 正常收作业 |
| `github` | 跳转到预填好的 GitHub Issue 表单 | 同学普遍有 GitHub 账号 |
| `local` | 只生成 Markdown，不联网 | 完全不想用服务器 |

不管用哪一种，`submit.html` 上的「复制 Markdown / 下载 .md / 暂存到本机」始终可用，
所以线下收作业（微信、邮件、课程平台）永远不会被堵死。

## 快速开始

```bash
cd open-economy-solutions
npm run preview        # 生成页面 + 启动本地预览 → http://localhost:4173
```

只重新生成页面：

```bash
npm run build
```

没有构建依赖，只需要 Node 18+。`build` 把 `data/*.json` 渲染成完整静态站点，
直接双击 `index.html` 也能看（公式需要联网加载 MathJax）。

## 目录结构

```
.
├── data/
│   ├── course.json          # 章节、习题、题目、参考思路、后端配置
│   └── answers.json         # 手工整理的答案（与服务器上的作业合并展示）
├── assets/
│   ├── css/site.css         # 设计系统：配色、字体、组件
│   └── js/
│       ├── site.js          # 迷你 Markdown + LaTeX 渲染、作业列表、站内搜索
│       ├── backend.js       # 提交后端：Supabase 直传 / GitHub / 本地
│       └── submit.js        # 提交表单：实时预览、附件、进度、成功反馈
├── scripts/
│   ├── build.mjs            # 静态站点生成器
│   ├── serve.mjs            # 零依赖本地预览服务器
│   ├── check-backend.mjs    # 接收服务器体检（用公钥，模拟同学）
│   ├── moderate.mjs         # 老师批处理：列出 / 展示 / 撤下 / 删除
│   ├── mock-backend.mjs     # 本地假后端，不需要注册就能试跑
│   └── sync-submissions.mjs # 可选：把 GitHub Issues 同步成 answers.json
├── supabase/schema.sql      # 表 + 行级权限 + 存储桶（粘进 SQL Editor 即可）
├── submissions/             # 手工归档的附件
└── .github/                 # 可选：GitHub Issue 表单与同步工作流
```

生成出来的 `index.html`、`chapters/**` 都是**产物**，不要手改，
改动会在下次 `npm run build` 时被覆盖。

## 教师操作手册

### 1. 修改站点信息

编辑 `data/course.json` 顶部的 `site`。除了上面说的 `submission` 之外：

```json
{
  "titleZh": "开放宏观经济学 · 习题解答库",
  "description": "面向课程的习题解答库……",
  "repo": "你的GitHub用户名/仓库名"
}
```

`repo` 只影响页脚的仓库链接和讨论区入口，可以不填。

### 2. 补一道题的题面与参考思路

在 `data/course.json` 的 `chapters[].exercises[]` 里找到那道题，填两个字段：

```json
{
  "id": "2.3",
  "slug": "2_3",
  "title": "An Open Economy with Habit Formation",
  "problem": "考虑带有习惯形成的效用函数……\n\n**求**：最优消费的欧拉方程。",
  "reference": {
    "status": "sketch",
    "note": "参考思路（并非唯一做法）",
    "body": "**第一步**，把效用写成……"
  },
  "tags": ["习惯形成", "欧拉方程"]
}
```

两个字段都支持 Markdown + LaTeX：

- 行内公式 `$c_t = y_t - r d_{t-1}$`
- 独立公式 `$$\mu_{t+1} = \frac{r}{1+r-\rho}\epsilon_{t+1}$$`
- `**加粗**`、`- 列表`、`> 引用`、`` `代码` ``

`reference` 留 `null` 就不显示「参考思路」板块。

> ⚠️ **美元符号要转义。** 题面里的金额必须写成 `\$35,000`，
> 否则排版引擎会把它和下一个 `$` 之间的内容当成公式。当前 161 道题
> 都已经自动转义好了；你自己新加内容时记得这件事。

### 3. 题面是从 PDF 自动提取的

161 道题的题面来自教材 PDF 的自动提取，所以：

- 每道题页面上都会提示「以教材原文为准」；
- 复杂的**分式、上下标**偶尔会串位（例如把 $C_1^h$ 提取成 `C1 h`）；
  遇到重要的题，建议手工把题面改成 LaTeX 写法。

如果你希望**完全不展示题面**（只保留题号、标题和提交入口，让学生对照教材做题）——
这在版权上也更保守——把 `data/course.json` 里的 `showProblemText` 改成 `false`
再 `node scripts/build.mjs` 即可。

### 4. 管理同学交上来的作业

**在浏览器里改（最简单）**：Supabase 控制台左侧 **Table Editor → submissions**，
点开任意一行直接编辑。最常用的就是改 `status`：

| status | 网站上的样子 |
| --- | --- |
| `verified` | 精选解答（绿色，排最前） |
| `peer` | 同学解答 |
| `alternative` | 另一种思路 |
| `pending` | 存着但不公开 |
| `rejected` | 存着但不公开（用来「撤下」某条作业） |

**在命令行批量处理**（需要 service_role key）：

```bash
$env:SUPABASE_URL="https://xxxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOi..."

node scripts/moderate.mjs list                  # 最近的作业
node scripts/moderate.mjs list --status pending
node scripts/moderate.mjs publish <id>          # 展示（默认精选）
node scripts/moderate.mjs publish <id> --as peer
node scripts/moderate.mjs hide <id>             # 从网站撤下，记录仍在
node scripts/moderate.mjs rm <id>               # 彻底删除
```

### 5. 改成「先审后放」

默认是提交即展示（`autoApprove: true`）。想改成老师先过一遍：

1. `data/course.json` 里把 `autoApprove` 改成 `false`；
2. `supabase/schema.sql` 里把插入策略那一行的
   `status = 'verified'` 改成 `status = 'pending'`，重新在 SQL Editor 跑一次该策略；
3. 重新 `npm run build`。

之后新提交的作业会以 `pending` 存进数据库，只有你把它改成
`verified` / `peer` / `alternative` 才会出现在网站上。

### 6. 当前数据状态

仓库里已经**没有任何示例答案**了：`data/answers.json` 是空的，
`submissions/` 里只留下说明文件。网站上显示的作业全部来自同学提交
（存在 Supabase 里），页面上的每道题在收到第一份作业之前都是空状态。

## 部署到 GitHub Pages

1. 新建仓库并把本目录推上去：

   ```bash
   git init && git add . && git commit -m "init solutions site"
   git remote add origin git@github.com:<你的用户名>/<仓库名>.git
   git push -u origin main
   ```

2. 仓库 **Settings → Pages**：Source 选 `Deploy from a branch`，
   Branch 选 `main`、目录选 `/ (root)`，保存。

3. 等一两分钟，访问 `https://<用户名>.github.io/<仓库名>/`。

网站用的是相对路径，放在子路径或自定义域名下都不需要额外配置。
如果只想把静态页面放上去、接收服务器用 Supabase，到这一步就结束了——
网站的构建产物已经提交进仓库，GitHub Pages 不需要跑任何构建。

> 如果之后改过 `data/course.json` 或 `assets/`，记得在本机
> `npm run build` 一次再推送，否则线上页面不会更新。

## 站内搜索

搜索框在右上角（快捷键 `/`），索引在构建时生成，覆盖所有章节、习题和每道题的作业数量。
作业正文的全文检索在「全部作业」页面里。

## 已知限制

- **公式不需要联网，而且是按需加载**：MathJax 放在 `assets/vendor/tex-svg.js`
  （2 MB，线上 gzip 后约 670 KB），但只要页面上没出现公式就**不会下载**。
  首页、章节页、题面没有公式的习题页因此省下了近 700 KB 的首屏流量；
  同学在答案里写了 `$...$`，引擎会自动加载并排版。
  想升级版本就重新下载同一个文件覆盖
  （`https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js`）。
- **题面是自动提取的**：分式、上下标偶有偏差，页面上有提示；可用
  `showProblemText: false` 完全关闭题面展示。
- **公开桶**：附件文件名带时间戳和随机串，不列出就猜不到，但拿到链接的人能打开。
  需要严格保密的话，把 `schema.sql` 里的存储桶改成私有，并让同学改用「下载 .md」。
- **没有防刷**：同一个同学可以重复提交（这也是「更正版本」需要的）。
  要挡机器人，可以在 Supabase 前面挂 Cloudflare Turnstile。
- **搜索是纯前端的**：几千条以内没问题；上万条建议换成 Pagefind。
- **免费额度**：Supabase 免费版 500 MB 数据库 + 1 GB 存储。收作业绰绰有余；
  如果要传视频，另找对象存储。

## 许可与版权

代码部分可自由使用。教材题目、图表与出版社材料的版权归原作者与 Princeton
University Press 所有；本站只收录师生自己撰写的解答，请勿上传教材扫描页。
