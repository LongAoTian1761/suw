# 上线清单

## 什么算「完成」

一个同学拿到网址，能做完整这一串，就算完成了：

> 打开网址 → 找到今天的习题 → 写下答案（公式能正常显示）
> → 把手机拍的手写推导拖进去 → 点提交 → 看到「提交成功」
> → 你和全班在网站和「全部作业」里看到它，附件点得开。

而且这一串要在**公网**上稳定成立 —— 不需要你的电脑开着任何东西。

当前进度：

| 项目 | 状态 |
| --- | --- |
| 网站本身（205 个页面、搜索、公式排版） | 已完成 |
| 免账号提交表单 + 附件上传 | 已完成 |
| 接收服务器（Supabase） | 已完成，并且真机验证通过 |
| 公网部署（GitHub Pages） | **待你操作 —— 只剩这一步** |
| 你课程的章节 / 题目 | 已完成：15 章 161 道课后题，题面已录入 |
| 清理示例数据 | 已完成 |
| MathJax 本地化（不依赖 CDN） | 已完成 |
| 参考思路（每题的标准解法） | 可按周逐步补 |

---

## 阶段 1 · 接上接收服务器 ✅ 已完成

- [x] **1.1** 建好 Project（名字「高级宏观」，区域 ap-southeast-1 新加坡，离国内很近）。
- [x] **1.2** `supabase/schema.sql` 已在 SQL Editor 里执行，表、权限、存储桶都建好了。
- [x] **1.3** 公开密钥已填进 `data/course.json`（`sb_publishable_...`，本来就是可以公开的）。
- [x] **1.4** 体检全绿：匿名提交返回 201、附件上传成功、越权写入被拒、未发布内容读不到。
- [x] **1.5** 真实浏览器跑通完整流程：填表 → 传附件 → 提交 → 习题页显示答案，公式、列表、附件链接都正常。

想再确认一次，随时重跑：

```
node scripts/check-backend.mjs
```

> 每次体检都会在数据库里留下两条带 `healthcheck` 标签的测试记录。
> 上线前在 **SQL Editor** 里执行下面这句就能一次清干净：
>
> ```sql
> delete from public.submissions where tags @> array['healthcheck'];
> ```

---

## 阶段 2 · 部署到公网（约 5 分钟，只有你能做）

- [ ] **2.1** 在 GitHub 建一个空仓库（Public，不要勾选 README）。
- [ ] **2.2** 在本项目目录里推送：

```
git init
git add .
git commit -m "init solutions site"
git remote add origin git@github.com:<你的用户名>/<仓库名>.git
git push -u origin main
```

- [ ] **2.3** 仓库 **Settings → Pages**：Source 选 `Deploy from a branch`，Branch 选 `main`，目录选 `/ (root)`，Save。
- [ ] **2.4** 等 1～2 分钟，打开 `https://<用户名>.github.io/<仓库名>/`。

之后每次改过 `data/` 或 `assets/`，在本机跑一次 `node scripts/build.mjs` 再推送，
线上才会更新（GitHub 那边不跑构建）。

---

## 阶段 3 · 验收 ✅ 基本完成

- [x] **3.1–3.6** 已在真实服务器上验证：提交成功并给出提交编号、附件能打开、
      答案出现在对应习题页、公式与列表渲染正常、计数徽标变成 1。
- [ ] **3.7**（还没试，20 秒可完成）打开 Supabase **Table Editor → submissions**，
      把任意一行的 `status` 改成 `rejected`，刷新网页它会消失；改回 `verified` 又出现。

> 3.7 验证的是「你能不能把不合适的作业撤下来」。试完顺手把测试记录删掉就行。

---

## 阶段 4 · 内容（这是真正的工作量）

代码已经定型，剩下的是把你的课程装进去。

课程内容已经装好了：**Schmitt-Grohé / Uribe / Woodford《International Macroeconomics》**，
15 章、161 道课后题，按书里的四个部分分组。剩下的是可选的打磨：

- [ ] **4.1 站点信息**　`data/course.json` 顶部的 `titleZh`、`description`、`repo` 换成你课程的说法。`repo` 只影响页脚链接，可以不填。
- [ ] **4.2 参考思路**　每道题的 `reference` 字段可以写你自己的标准解法（Markdown + LaTeX）；留 `null` 就不显示「参考思路」板块。不必一次写完，建议先填本周要讲的那一章。
- [ ] **4.3 题面打磨**　自动提取的题面里，复杂分式与上下标偶尔会串位。重要的题目建议手工改成 LaTeX 写法。另一个选择是把 `showProblemText` 改成 `false`，只保留题号与提交入口（版权上也更保守）。
- [ ] **4.4 美元符号写法**　新增题面时，金额要写成 `\$35,000`，否则会被当成公式。

---

## 阶段 5 · 通知同学

把网址发给同学，说清三件事就够了：

> 作业答案传到 `https://<你的网址>/submit.html`
> 不用注册、不用登录，姓名可以填「匿名」
> 手写照片、PDF、代码都能直接拖进去

---

## 上线前最后一个决定

**提交后是立刻展示，还是你先看一遍？**

| 选择 | 怎么改 | 适合什么情况 |
| --- | --- | --- |
| 立刻展示（当前默认） | 不用动 | 只有本班同学知道网址 |
| 先审后放 | 把 `autoApprove` 改成 `false`；把 `schema.sql` 里插入策略的 `'verified'` 改成 `'pending'`，在 SQL Editor 重跑那一段 | 网址可能被外人看到 |

改完记得跑 `node scripts/build.mjs`。

---

## 出问题时先查这几处

| 症状 | 多半是这个原因 |
| --- | --- |
| 提交时报 `row-level security policy` | `schema.sql` 没跑，或改了 `autoApprove` 但没同步改 SQL |
| 提交时说 `new row violates` | 同上；也可能 `author` 或正文长度超出限制 |
| 附件传不上去 | 存储桶没建，或桶名和 `course.json` 里的 `bucket` 对不上 |
| 附件链接点开 404 | 桶不是 public；到 Storage 里把桶设为 public |
| 交完刷新看不见 | 这条记录的 `status` 不是 `verified` / `peer` / `alternative` |
| 改了 JSON 但网页没变 | 忘了跑 `node scripts/build.mjs`，或推送后还没等 Pages 构建完 |
| 本地预览打不开，提示 ERR_CONNECTION_REFUSED | `node scripts/serve.mjs` 没在跑（它只是预览服务，跟线上无关） |
