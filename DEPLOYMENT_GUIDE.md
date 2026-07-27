# GitHub Pages 部署与 APP 安装指南

PaperScope 已改造为 GitHub Pages 静态站点，不需要购买服务器或使用 Render。GitHub Actions 每天抓取最新内容，并将构建结果发布到固定 HTTPS 地址。

## 一、启用 GitHub Pages

代码合并到 `main` 后：

1. 打开仓库 <https://github.com/hahha114157-ctrl/Paper-post>。
2. 进入 **Settings** → **Pages**。
3. 在 **Build and deployment** 的 **Source** 中选择 **GitHub Actions**。
4. 打开仓库的 **Actions** 页面。
5. 选择 **Update research data and deploy Pages**。
6. 点击 **Run workflow**，选择 `main`，再确认运行。
7. 等待 `build` 和 `deploy` 两个任务显示绿色勾号。

发布成功后，固定地址为：

```text
https://hahha114157-ctrl.github.io/Paper-post/
```

GitHub 会自动配置 HTTPS，不需要购买证书。

## 二、配置 Crossref 联系邮箱

这不是必需步骤，但可以降低 Crossref 限流概率：

1. 打开仓库 **Settings** → **Secrets and variables** → **Actions**。
2. 点击 **New repository secret**。
3. 名称填写 `CONTACT_EMAIL`。
4. 值填写你的联系邮箱。
5. 保存后重新运行 Pages 工作流。

邮箱只会作为运行时环境变量使用，不会出现在网页或仓库代码中。

## 三、自动更新时间

工作流默认每天北京时间 06:30 执行一次：

```yaml
schedule:
  - cron: "30 22 * * *"
```

GitHub Actions 使用 UTC，因此北京时间 06:30 对应前一天 UTC 22:30。GitHub 高负载时，计划任务可能延迟几分钟。

还可以通过以下方式更新：

- 推送代码到 `main`，自动构建发布。
- 在 Actions 页面手动点击 **Run workflow**。

网页中的“检查最新数据”只会重新下载最近一次 Pages 发布的数据，不会直接启动 GitHub Actions。

## 四、查看构建问题

如果网站没有更新：

1. 打开仓库的 **Actions** 页面。
2. 进入最近一次 **Update research data and deploy Pages** 运行记录。
3. 查看 `Build static research digest` 步骤。

常见情况：

- arXiv、Crossref 或 RSS 暂时不可用。
- Crossref 返回 HTTP 429，表示请求被限流。
- GitHub Pages 尚未选择 GitHub Actions 作为来源。
- 工作流没有 `pages: write` 和 `id-token: write` 权限。

如果可靠论文少于 10 篇或官方资讯少于 3 条，构建会主动失败，不会用空内容覆盖上一次正常网站。

## 五、安装为 Windows / macOS APP

使用最新版 Edge 或 Chrome：

1. 打开 <https://hahha114157-ctrl.github.io/Paper-post/>。
2. 等待页面和数据加载完成。
3. 点击页面右上方的“安装为 APP”。
4. 如果页面按钮没有出现：
   - Edge：点击地址栏右侧的“安装此站点作为应用”。
   - Chrome：打开菜单，选择“投放、保存和分享” → “安装 PaperScope”。
5. 安装后，可以从 Windows 开始菜单、任务栏或 macOS 启动台打开。

卸载时，在 PaperScope 独立窗口的菜单中选择“卸载 PaperScope”。

## 六、安装为 Android APP

1. 使用 Chrome 打开固定网址。
2. 点击“安装为 APP”，或者打开 Chrome 菜单。
3. 选择“安装应用”或“添加到主屏幕”。
4. PaperScope 会出现在桌面和应用列表中。

## 七、添加到 iPhone / iPad 主屏幕

1. 使用 Safari 打开固定网址。
2. 点击“分享”按钮。
3. 选择“添加到主屏幕”。
4. 确认名称并点击“添加”。

iOS 通常不显示网页内的安装按钮，需要通过 Safari 菜单完成。

## 八、自定义域名（可选）

不购买域名也可以一直使用免费的 `github.io` 地址。如果以后购买了域名：

1. 在仓库 **Settings** → **Pages** 中填写 **Custom domain**。
2. 在域名服务商处配置 GitHub Pages 要求的 `CNAME`、`A` 或 `ALIAS` 记录。
3. DNS 生效后勾选 **Enforce HTTPS**。

域名只是替换访问地址，不会改变数据更新方式。

## 九、能力边界

- GitHub Pages 不运行 Node 后端；所有数据在 GitHub Actions 构建期间生成。
- 页面没有即时抓取按钮，最新数据取决于最近一次工作流发布。
- PWA 静态界面和最近缓存的数据可离线打开，更新仍需要网络。
- 真正的后台消息推送仍需要 Web Push 服务、订阅数据库和 VAPID 密钥。

## 十、启用在线精译（可选）

离线多义词典和浏览器本地翻译不需要服务器。若要启用 DeepL 或
LibreTranslate 在线精译，需要部署 `worker/` 目录中的 Cloudflare
Worker；GitHub Pages 网址保持不变。

1. 准备 DeepL API Key，或一个可访问的 LibreTranslate 服务。
2. 按照 [在线精译代理说明](worker/README.md) 部署 Worker。
3. 将 Worker 返回的 `https://…workers.dev/translate` 地址填入网页的
   **翻译设置 → 在线精译代理**。
4. 点击“测试在线代理”。

第三方 API Key 必须通过 Worker Secret 保存，不能写入 `app.js`、
GitHub Pages 或提交到 Git 仓库。
