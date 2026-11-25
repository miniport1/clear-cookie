# ClearCookie

零运行时依赖、物理级禁止外联的跨浏览器 Cookie 编辑器，支持 **Chrome 系（Chrome / Edge / Brave / Arc）** 与 **Firefox（≥ 128）**。

## 安全设计（可逐行审计）

- **零网络外联**：双端 Manifest 均强制声明 `content_security_policy.extension_pages` 包含 `connect-src 'none'`，扩展自身无法发起任何外部请求。
- **零运行时依赖**：`package.json` 不含任何 `dependencies`，全部扩展代码为本项目 `src/` 下的 TypeScript 源码。
- **按需站点权限**：仅在 `optional_host_permissions` 声明 `<all_urls>`；默认不获取任何网站权限，按需针对单个站点授权，且可在「设置」页随时一键收回。
- **无广告、无遥测**：Firefox Manifest 显式声明 `data_collection_permissions.required: ["none"]`，设置与账号快照仅存于本地 `storage.local`。

## 功能特性

- **多入口形态**：工具栏 Popup、侧边栏（Chrome Side Panel / Firefox Sidebar）、DevTools 独立面板、设置与安全自检页。
- **完整 Cookie 编辑**：支持 Name、Value、Domain、Path、SameSite、Expiration、HostOnly、Session、HttpOnly、Secure，兼容 Firefox 容器（`cookieStoreId`）与 CHIPS 分区 Cookie（`partitionKey`）。
- **多格式导入 / 导出**：JSON、HTTP Cookie Header、Netscape `cookies.txt`（支持 `#HttpOnly_`），导入支持自动识别格式与文件上传。
- **值自动解码预览**：编辑时自动识别并格式化 JWT（含过期状态与到期时间）、JSON、URL 编码与 Base64。
- **本地快照（Profiles）**：将当前站点整套 Cookie 存为命名快照，一键切换测试账号。
- **防录屏遮罩**：工具栏一键遮罩全部 Cookie 值，并可在设置中开启「默认遮罩」。

## 本地构建

```bash
npm install
npm test
npm run typecheck
npm run build      # 同时构建 dist/chrome 与 dist/firefox
npm run pack       # 生成 dist/clear-cookie-chrome.zip 与 dist/clear-cookie-firefox.zip
```

## 本地安装

### Chrome / Edge / Brave / Arc
1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）并开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择 `dist/chrome` 目录。

### Firefox
1. 打开 `about:debugging#/runtime/this-firefox`。
2. 点击「临时载入附加组件」，选择 `dist/firefox/manifest.json`（如需长期使用，可使用 Mozilla 账号对 `dist/clear-cookie-firefox.zip` 做仅自用签名 / Self-Distribution）。
