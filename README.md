# PaperScope

PaperScope 是一个面向 AI 研究人员的论文、官方资讯和会议期刊聚合站。生产环境使用 **GitHub Actions 定时抓取数据 + GitHub Pages 静态发布**，不需要 Render 或常驻服务器。

固定网址：<https://hahha114157-ctrl.github.io/Paper-post/>

完整操作见 [GitHub Pages 部署与 APP 安装指南](DEPLOYMENT_GUIDE.md)。

## 数据来源

- arXiv API：`cs.AI`、`cs.LG`、`cs.CL`、`cs.CV`、`cs.RO` 最新预印本。
- Crossref REST API：最近 45 天登记 DOI 的 AI / ML 期刊论文。
- 官方 RSS：OpenAI、Google DeepMind、Microsoft Research。
- 会议与期刊：官方 CFP / 作者指南链接、人工核验日期和动态截止状态。

构建失败时不会发布空数据，也不会生成假论文；GitHub Pages 会继续保留上一次成功部署。

## 自动更新

工作流位于 `.github/workflows/pages.yml`：

- 每天北京时间 06:30 自动构建和发布。
- 推送到 `main` 分支时自动发布。
- 可以在 GitHub 仓库的 **Actions** 页面手动运行。

GitHub Actions 使用 UTC，工作流中的 `30 22 * * *` 对应次日北京时间 06:30。

## 本地构建

需要 Node.js 18 或更新版本：

```powershell
npm run build
npm start
```

打开 <http://localhost:4173>。`npm run build` 需要访问外部论文和 RSS 数据源。

可选配置：

```powershell
$env:CONTACT_EMAIL="your-email@example.com"
npm run build
```

`CONTACT_EMAIL` 用于 Crossref polite pool，不要提交真实邮箱到仓库。

## 目录

```text
.github/workflows/pages.yml  自动抓取和 Pages 部署
scripts/build-static.mjs     聚合论文、资讯、热点和会议数据
scripts/preview.mjs          本地静态预览服务
index.html / app.js          前端页面和交互
manifest.webmanifest         PWA 安装配置
service-worker.js            静态资源与数据离线缓存
dist/                        构建产物，不提交到 Git
```

## 数据边界

- “热点”是当前批次关键词统计，不代表完整领域的全局趋势。
- “结构化摘要”只重组来源摘要，不虚构实验结果，也不是大模型翻译。
- 会议信息是官方页面的核验快照，临时变更仍应以链接页面为准。
- 当前没有后台 Web Push；关闭 APP 后主动收到通知需要独立的推送服务。
