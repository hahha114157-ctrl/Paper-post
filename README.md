# PaperScope

PaperScope 是一个面向 AI 与计算机体系结构研究人员的质量优先论文工作台。生产环境使用 **GitHub Actions 定时抓取数据 + GitHub Pages 静态发布**，不需要 Render 或常驻服务器。

固定网址：<https://hahha114157-ctrl.github.io/Paper-post/>

完整操作见 [GitHub Pages 部署与 APP 安装指南](DEPLOYMENT_GUIDE.md)。

## 个人文献库

- 个人主页与研究方向资料。
- 收藏、阅读队列、阅读进度、已读历史、笔记、自定义标签与摘要文字标注。
- 自定义专题收藏、批量操作以及 2～3 篇论文并排对比。
- 基于 arXiv 元数据及 Crossref 标题匹配的正式发表状态跟踪。
- JSON 导入/导出备份，以及 BibTeX / Markdown 引用导出。
- 混合阅读翻译：离线多义词典、本地段落翻译和可选在线精译，可将结果加入论文笔记或生词本。
- 本地 PDF 工作区：可以给目录论文附加 PDF，也可以直接把任意 PDF 作为本地论文加入文献库。
- 论文与团队追溯：结合本地作者交集、Crossref 和 Semantic Scholar 查看公开机构、作者指标、共同作者与先前工作。

个人数据只保存在当前浏览器。结构化记录位于 `localStorage`，PDF 原文件和逐页文本位于 `IndexedDB`，不会上传到 GitHub。JSON 备份不包含 PDF 二进制文件；清理浏览器数据或更换设备前请分别导出重要 PDF。

## 站内 PDF 阅读

- 论文详情中的“导入 PDF”会解析本地文件、提取逐页文本，并将原文件保存在当前浏览器的 IndexedDB。
- “站内阅读”提供分页、缩放、全文搜索、页面渲染和可翻译文本；点击单词或框选段落沿用阅读翻译功能。
- 文献库顶部的“本地 PDF”可以导入目录中不存在的论文，标题和作者优先读取 PDF 元数据。
- 单文件上限为 150 MB。扫描版 PDF 若没有文本层仍可查看页面，但需要先用本地 OCR 软件生成文本层才能翻译。
- 网站不会自动镜像受版权保护的全文。开放版本仅提供可核验入口；跨站 PDF 还可能受浏览器 CORS 限制，因此手动下载后导入最稳定。

## 论文与团队追溯

- 有 DOI 时使用 Crossref 核验论文作者机构，并优先通过 ORCID 精确检索先前工作；Semantic Scholar 用于补充作者档案、共同作者和历史论文。
- 没有外部匹配或接口限流时，使用当前 PaperScope 数据中的作者交集给出本地追溯结果。
- “机构”是论文或作者档案公开记录，不代表作者当前所在机构；“团队线索”基于共同作者重合，不会自动声称某个实验室或课题组。
- 追溯结果会保存到当前浏览器，可手动刷新。外部计数和机构信息仍应点击来源页面复核。

## 阅读翻译

- 顶部“译”按钮可以总开关阅读翻译，并分别控制单词/术语点击、选区自动翻译、引擎策略和本地缓存。
- 翻译仅在论文摘要、详情和文献库阅读文本中生效，不会抢占标题链接、按钮或输入框。
- 单词优先查询 60,000 条 ECDICT 通用词库及 PaperScope AI/体系结构专业术语表，显示多词性、多义项、音标、英文解释和词形。
- 通用词典按首字母分片加载，也可以在设置中一次性下载完整离线词典；数据来源和许可见 [第三方数据声明](THIRD_PARTY_NOTICES.md)。
- 段落优先使用浏览器内置 `Translator API`；首次使用可能需要确认下载语言包。
- 翻译框可拖动；“固定位置”会记住坐标，“跟随选区”会自动显示在文字附近，移动端使用底部卡片。
- 在线精译通过用户自行部署的 Cloudflare Worker 调用 DeepL 或 LibreTranslate。第三方 API 密钥只保存在 Worker Secret，不写入网页，详见 [在线精译代理说明](worker/README.md)。
- 生词本支持查询次数、掌握度、朗读和 CSV 导出；翻译历史保留最近 200 条；论文详情支持生成中英对照摘要。
- PWA 静态脚本使用版本化地址；发现新版后会提示一键刷新，刷新不会清除收藏、笔记、生词本或其他本地资料。

## 页面与导航

站点使用适合 GitHub Pages 的 Hash 路由，不需要服务器重写规则：

- `#/home`：精简研究概览。
- `#/ai`、`#/architecture`：独立论文列表、会议/期刊筛选、质量排序与分页。
- `#/curated`：按会议或期刊当届专栏归类的正式收录论文、今日必读与未来两周计划。
- `#/library/*`：收藏、队列、最近阅读、笔记、发表动态、专题、生词本和翻译历史。
- `#/news`、`#/venues`：分页资讯与会议期刊目录。
- `#/paper/<id>`：可复制和返回的论文详情链接。

支持浏览器前进/后退、深色模式、`Ctrl/Cmd + K` 快速跳转和移动端底部导航。

## 数据来源

- arXiv API：AI 栏目使用 `cs.AI`、`cs.LG`、`cs.CL`、`cs.CV`、`cs.RO`；体系结构栏目使用 `cs.AR`、`cs.DC`、`cs.PF`。
- PMLR、NeurIPS Proceedings、ACL Anthology：ICML、NeurIPS、ACL 正式论文集与权威元数据。
- Crossref REST API 与出版方 DOI：CVPR、TPAMI、ISCA、MICRO、HPCA、ASPLOS、IEEE TC、ACM TACO 等会议和期刊专栏。
- Semantic Scholar Academic Graph：论文匹配、作者档案、共同作者和历史工作追溯；公共接口限流时自动回退到本地结果。
- arXiv 回退：正式出版元数据没有机器可读摘要时，按标准化标题匹配对应 arXiv 版本，并保留正式出版链接。
- 官方 RSS：OpenAI、Google DeepMind、Microsoft Research。
- 会议与期刊：官方 CFP / 作者指南链接、人工核验日期和动态截止状态。

## 质量优先推荐与每日阅读

- 默认排序依次考虑旗舰会议/期刊正式收录、官方来源、Crossref 被引信号、重点主题相关性和年份；最近几天上传只占很弱的权重。
- 首页每天推荐一篇值得精读的论文，提供推荐理由、正式收录时间、45 分钟分段阅读计划与三个复盘问题。
- 北京时间零点后切换当日论文；GitHub Actions 每天 06:30 抓取并发布最新数据。
- “完成今日阅读”会记录在当前浏览器，可在首页或顶会精选页查看打卡状态。

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
pdfjs-dist                   本地 PDF 页面渲染与文本提取
manifest.webmanifest         PWA 安装配置
service-worker.js            静态资源与数据离线缓存
dist/                        构建产物，不提交到 Git
```

## 数据边界

- “热点”是当前批次关键词统计，不代表完整领域的全局趋势。
- “推荐分”是可解释的站内排序信号，不等同于学术界公认排名；会议/期刊正式收录和来源可信度高于新鲜度。
- “结构化摘要”只重组来源摘要，不虚构实验结果，也不是大模型翻译。
- 会议信息是官方页面的核验快照，临时变更仍应以链接页面为准。
- 当前没有后台 Web Push；关闭 APP 后主动收到通知需要独立的推送服务。
