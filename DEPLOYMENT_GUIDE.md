# PaperScope 部署与 APP 安装指南

本文介绍如何将 PaperScope 部署为长期可访问的 HTTPS 网站，以及如何将网站安装成桌面或手机 APP。

## 一、部署前准备

PaperScope 是一个 Node.js 服务，托管环境需要满足：

- Node.js 18 或更新版本。
- 允许服务端访问 arXiv、Crossref、OpenAI、Google DeepMind 和 Microsoft Research。
- 启动命令为 `npm start`。
- 服务端口从环境变量 `PORT` 读取；未设置时使用 `4173`。
- 健康检查地址为 `/api/health`。

建议配置 `CONTACT_EMAIL` 环境变量。它会用于 Crossref polite pool，只需在托管平台后台配置，不要写进代码或提交到 GitHub。

## 二、使用 Render 获得固定 HTTPS 地址

项目根目录已经包含 `render.yaml`，推荐使用 Render Blueprint 部署。

### 1. 创建 Render 服务

1. 打开 <https://dashboard.render.com/> 并使用 GitHub 登录。
2. 授权 Render 读取 `hahha114157-ctrl/Paper-post` 仓库。
3. 点击 **New**，选择 **Blueprint**。
4. 选择 `Paper-post` 仓库。
5. Render 会读取仓库中的 `render.yaml`，识别出名为 `paperscope` 的 Web Service。
6. 确认并开始部署。

### 2. 配置环境变量

进入服务的 **Environment** 页面，增加：

```text
CONTACT_EMAIL=你的联系邮箱
```

不要手动设置 `PORT`，Render 会自动提供。

### 3. 获取固定网址

部署完成后，Render 会提供类似以下地址：

```text
https://paperscope-xxxx.onrender.com
```

该地址就是固定 HTTPS 地址，可以收藏、分享或用于安装 PWA。

### 4. 验证部署

依次检查：

- 打开网站首页，论文和官方资讯能够加载。
- 打开 `https://你的地址/api/health`，应看到 `"ok": true`。
- 点击“同步最新内容”，确认来源数量和同步时间更新。
- 点击论文，确认详情、作者和原文链接正常。

### Render 免费服务注意事项

免费实例长时间无人访问时可能休眠，首次打开可能需要等待几十秒。休眠期间，进程内的 06:30 定时任务不会执行；但用户打开页面时仍会按缓存时效自动请求最新内容。需要严格每日定时同步时，应使用不会休眠的实例，或配置外部定时任务访问同步接口。

## 三、使用其他平台

也可以部署到 Railway、Fly.io、云服务器或 NAS。通用设置如下：

```text
构建命令：无需构建，或 npm install
启动命令：npm start
健康检查：/api/health
Node.js：18+
```

必须使用 HTTPS，PWA 安装和 Service Worker 在普通公网 HTTP 地址上无法正常工作。

## 四、安装为 Windows / macOS APP

推荐使用最新版 Edge 或 Chrome：

1. 使用浏览器打开部署后的 HTTPS 地址。
2. 等待页面加载完成。
3. 点击页面右上方出现的“安装为 APP”。
4. 如果按钮没有出现：
   - Edge：点击地址栏右侧的“安装此站点作为应用”。
   - Chrome：打开右上角菜单，选择“投放、保存和分享” → “安装 PaperScope”。
5. 安装后可以从 Windows 开始菜单、任务栏或 macOS 启动台直接打开。

卸载时，在已安装的 PaperScope 窗口菜单中选择“卸载 PaperScope”。

## 五、安装为 Android APP

1. 使用 Chrome 打开部署后的 HTTPS 地址。
2. 点击页面上的“安装为 APP”，或打开 Chrome 菜单。
3. 选择“安装应用”或“添加到主屏幕”。
4. 确认后，PaperScope 图标会出现在桌面和应用列表中。

## 六、添加到 iPhone / iPad 主屏幕

1. 必须使用 Safari 打开部署后的 HTTPS 地址。
2. 点击底部或顶部的“分享”按钮。
3. 向下滚动并选择“添加到主屏幕”。
4. 确认名称为 PaperScope，然后点击“添加”。

iOS 不一定显示网页内的“安装为 APP”按钮，应使用 Safari 的“添加到主屏幕”。

## 七、数据更新与通知边界

- 页面最多缓存论文 4 小时、官方资讯 2 小时。
- 点击“同步最新内容”可以强制请求官方数据源。
- 服务持续运行时，会在北京时间每天 06:30 同步一次。
- APP 图标和静态界面可以离线打开，但论文和资讯更新仍需要网络。
- 当前版本没有真正的后台 Web Push。关闭 APP 后主动收到通知，需要后续增加推送订阅数据库、VAPID 密钥和推送服务。

## 八、常见问题

### 页面显示实时源不可用

先检查 `/api/health`。如果健康检查正常，通常是某个外部数据源临时限流或网络不可达；页面会展示最近一次成功缓存，不会生成假论文。

### Crossref 返回 429

这是接口限流。不要连续频繁点击同步，并在托管平台配置 `CONTACT_EMAIL`。

### 安装按钮没有出现

确认使用 HTTPS、浏览器支持 PWA，并检查 `manifest.webmanifest` 与 `service-worker.js` 能否正常访问。iPhone/iPad 需要使用 Safari 的“添加到主屏幕”。

### 每天 06:30 没有同步

进程内定时任务要求服务器当时处于运行状态。免费托管实例休眠时不会执行，需要升级为常驻实例或使用外部定时任务。
