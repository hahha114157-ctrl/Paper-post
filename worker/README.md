# PaperScope 在线精译代理

GitHub Pages 只托管静态文件，第三方翻译密钥不能直接放在 `app.js` 中。
这个 Cloudflare Worker 会校验来源、限制文本长度，并在服务端调用 DeepL
或 LibreTranslate。

## 部署

```powershell
cd worker
Copy-Item wrangler.toml.example wrangler.toml
npx wrangler login
npx wrangler secret put DEEPL_API_KEY
npx wrangler deploy
```

使用 LibreTranslate 时，把 `TRANSLATION_PROVIDER` 改为
`libretranslate`，设置 `LIBRETRANSLATE_URL`，如果服务需要密钥再执行：

```powershell
npx wrangler secret put LIBRETRANSLATE_API_KEY
```

部署后将 `https://<worker>.workers.dev/translate` 填入 PaperScope 的
“在线精译代理”设置。不要提交 `wrangler.toml`、`.dev.vars` 或任何密钥。
