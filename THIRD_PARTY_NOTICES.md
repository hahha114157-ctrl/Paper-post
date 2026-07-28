# Third-party data notices

## ECDICT

PaperScope 的通用离线英汉词典分片由
[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT) 数据生成。

- Project: ECDICT — Free English to Chinese Dictionary Database
- License: MIT
- Source revision: `c4ade63ea08cf39d9c3475e96929036d64d94c94`

PaperScope 仅选取高频、常用及考试词汇并转换为浏览器按需加载的 JSON
分片；专业 AI 与计算机体系结构术语由 PaperScope 单独维护。

## PDF.js

- Project: Mozilla PDF.js
- Source: https://github.com/mozilla/pdf.js
- Version: 6.1.200
- License: Apache License 2.0

站内 PDF 阅读器打包了 PDF.js 的浏览器显示层、Worker、字符映射、标准字体与 WASM 辅助文件。

## pdf-lib

- Project: pdf-lib
- Source: https://github.com/Hopding/pdf-lib
- Version: 1.17.1
- License: MIT

PaperScope 使用 pdf-lib 在浏览器内生成带可见标注的 PDF 副本和标注摘要页，不修改用户导入的原文件。

## Tesseract.js

- Project: Tesseract.js
- Source: https://github.com/naptha/tesseract.js
- Version: 7.0.0
- License: Apache License 2.0
- Language data: https://tessdata.projectnaptha.com/4.0.0

OCR 引擎、Worker 与 WASM 核心由站点本地提供；首次 OCR 会下载并缓存 `eng` 与 `chi_sim` 语言数据。页面图像在当前浏览器中识别，不上传到 PaperScope 服务器。
