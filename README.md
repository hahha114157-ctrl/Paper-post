# PaperScope

PaperScope 是一个 AI 研究资讯聚合站，当前接入以下实时来源：

完整的固定网址部署和 APP 安装步骤见 [部署与 APP 安装指南](DEPLOYMENT_GUIDE.md)。

- arXiv API：`cs.AI`、`cs.LG`、`cs.CL`、`cs.CV`、`cs.RO` 最新预印本。
- Crossref REST API：最近 45 天登记 DOI 的 AI / ML 期刊论文。
- 官方 RSS：OpenAI、Google DeepMind、Microsoft Research。
- 会议与期刊：使用官方 CFP / 作者指南链接，并展示人工核验日期和动态截止状态。

项目不再生成假论文作为回退。实时来源不可用时，只展示最近一次成功缓存，并明确标记异常；没有缓存时显示空状态。

## 本地运行

需要 Node.js 18 或更新版本：

```powershell
npm start
```

打开 <http://localhost:4173>。如果终端无法识别 `node` 或 `npm`，请安装 Node.js LTS 并重新打开终端。

可选环境变量：

```powershell
$env:CONTACT_EMAIL="your-email@example.com"
npm start
```

`CONTACT_EMAIL` 会放入 Crossref 的 polite-pool 请求信息。不要将私人邮箱提交到仓库。

## 固定网址

仓库包含 `render.yaml`，可以部署到支持 Blueprint 的 Render Web Service：

1. 将项目推送到自己的 GitHub 仓库。
2. 在 Render 新建 Blueprint，并选择该仓库。
3. 部署完成后会得到固定的 HTTPS 地址。

也可以部署到 Railway、Fly.io 或任意支持 Node.js 18+ 的容器/主机。托管平台必须允许服务端访问 arXiv、Crossref 和官方 RSS。

## 安装为 APP

项目已经具备 PWA manifest 和 service worker。通过 HTTPS 固定网址访问后，Chrome、Edge 和 Android 浏览器会显示“安装为 APP”；安装后可从桌面或开始菜单直接启动。iPhone/iPad 可使用 Safari 的“添加到主屏幕”。

静态界面可离线打开，但最新论文和资讯仍需要后端联网同步。真正的后台推送通知还需要增加 Web Push 订阅数据库和推送服务。

## 数据边界

- “热点”是当前同步批次的关键词统计，不代表完整学术领域的全局趋势。
- “结构化摘要”只重组来源摘要，不会虚构论文实验结论，也不是大模型翻译。
- 会议日期来自官方页面的核验快照；页面动态计算是否截止，但官方临时变更仍应以原页面为准。
- 期刊审稿速度是经验区间，不是出版社承诺。
