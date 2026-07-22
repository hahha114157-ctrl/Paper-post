# PaperScope

PaperScope 是一个面向 AI 与计算机体系结构研究人员的论文工作台。生产环境使用 **GitHub Actions 定时抓取数据 + GitHub Pages 静态发布**，不需要 Render 或常驻服务器。

固定网址：<https://hahha114157-ctrl.github.io/Paper-post/>

完整操作见 [GitHub Pages 部署与 APP 安装指南](DEPLOYMENT_GUIDE.md)。

## 个人文献库

- 个人主页与研究方向资料。
- 收藏、阅读队列、阅读进度、已读历史、笔记、自定义标签与摘要文字标注。
- 自定义专题收藏、批量操作以及 2～3 篇论文并排对比。
- 基于 arXiv 元数据及 Crossref 标题匹配的正式发表状态跟踪。
- JSON 导入/导出备份，以及 BibTeX / Markdown 引用导出。

个人数据只保存在当前浏览器的 `localStorage`，不会上传到 GitHub。清理浏览器数据或更换设备前请先导出备份。

## 页面与导航

站点使用适合 GitHub Pages 的 Hash 路由，不需要服务器重写规则：

- `#/home`：精简研究概览。
- `#/ai`、`#/architecture`：独立论文列表、筛选、排序与分页。
- `#/library/*`：收藏、队列、最近阅读、笔记、发表动态和专题。
- `#/news`、`#/venues`：分页资讯与会议期刊目录。
- `#/paper/<id>`：可复制和返回的论文详情链接。

支持浏览器前进/后退、深色模式、`Ctrl/Cmd + K` 快速跳转和移动端底部导航。

## 数据来源

- arXiv API：AI 栏目使用 `cs.AI`、`cs.LG`、`cs.CL`、`cs.CV`、`cs.RO`；体系结构栏目使用 `cs.AR`、`cs.DC`、`cs.PF`。
- Crossref REST API：AI 与计算机体系结构相关的最新期刊及会议论文。
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
