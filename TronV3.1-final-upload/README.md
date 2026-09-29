# TRON Permission Control v3.0.1

这是 v3.0 的构建修正版。项目根目录本身就是 GitHub 仓库根目录，`.github/workflows/build.yml` 已放在正确位置。

## GitHub 上传
不要把整个 `tron-permission-control-v3.0.1` 文件夹再套一层上传。应上传这个文件夹**里面的全部内容**到仓库根目录，使结构为：

```text
TronV3.0/
├── .github/workflows/build.yml
├── package.json
├── src/
├── scripts/
└── server/
```

上传并 push 到 `main` 后，GitHub Actions 会自动分别构建 Windows 和 macOS。也可以在仓库的 Actions 页面手动运行。

## v3.0.1 修正
- 移除不存在的 `renderer/app.js` 构建步骤。
- Electron 直接打包现有 `src/app.js`。
- Windows: NSIS 安装包 + Portable。
- macOS: DMG + ZIP。
- Actions 使用 Node 20，并在项目根目录执行。
- 增强 `npm run check`，构建前检查关键文件和 JS 语法。
- 保留 v3.0 的 TRON 权限编排、批量 C、A/B 2-of-2、Proposal Hash、Request ID、链上权限读取、Active Permission 保留、费用查询、操作中心和钱包渠道框架。

## 构建
```bash
npm install
npm run check
npm run dist:win
# 或
npm run dist:mac
```

## 安全模型
C 的私钥不进入后台或本程序。权限变更交易必须由 C 钱包本地签名；A/B 后续操作也必须由对应钱包签名。

> 注意：TronLink、TokenPocket、imToken 是否能在完全无网页的情况下从远程桌面请求直接唤起钱包，取决于钱包官方支持的渠道和设备环境。本项目只使用官方可用的 DeepLink / Adapter / WalletConnect 路径，不伪造通用的“仅凭地址推送钱包弹窗”协议。
