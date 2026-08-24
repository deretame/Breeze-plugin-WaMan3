# 蛙漫3 Breeze 插件

基于 WaMan3 / 蛙漫3 API 的 Breeze 插件适配器。公开内容无需登录；收藏和账号相关操作使用账号设置中的无验证码登录接口。

> **注** ：不应该主动修改types目录下的任何内容，types目录下的文件仅作为类型声明使用。

## 文档

插件开发文档：[https://deretame.github.io/plugin-dev-docs/](https://deretame.github.io/plugin-dev-docs/)

## 已导出的 fnPath

### 核心

- `getInfo` — 插件信息
- `searchComic` — 搜索漫画
- `getComicDetail` — 漫画详情
- `getReadSnapshot` — 阅读快照
- `getChapter` — 章节内容
- `fetchImageBytes` — 下载图片

### 社交

- `toggleLike` — 点赞
- `startFavoriteAction` — 新版收藏工作流
- `continueFavoriteAction` — 新版收藏工作流继续入口
- `toggleFavorite` — 收藏
- `listFavoriteFolders` — 收藏夹列表
- `moveFavoriteToFolder` — 移动到收藏夹
- `getCommentFeed` — 评论列表
- `loadCommentReplies` — 加载回复
- `postComment` — 发评论
- `postCommentReply` — 回复评论

### 发现

- `getAdvancedSearchScheme` — 高级搜索方案
- `getComicListSceneBundle` — 列表场景
- `getNewestData` — 更新列表
- `getNewestSceneBundle` — 更新场景
- `getRankingData` — 榜单数据
- `getRankingFilterBundle` — 榜单筛选
- `getCategoryData` — 分类列表
- `getCategoryFilterBundle` — 分类标签筛选
- `getCategorySceneBundle` — 分类场景

### 设置

- `getSettingsBundle` — 设置方案
- `content.mode` — 全部、BL、禁漫/成人、一般（BG/男女向候选）、TL、GL
- `getCapabilitiesBundle` — 能力操作
- `getUserInfoBundle` — 用户信息

### 回调

- `onAuthChanged` — 保存账号密码、使用无验证码登录并通过 Toast 通知结果
- `logoutAccount` — 清除服务端和本地登录态
- `clearPluginCache` — 清理缓存

## 登录说明

在插件设置中填写账号和密码后，插件请求：

```http
POST /api/account/login
Content-Type: application/json

{"username":"<账号>","password":"<密码>"}
```

请求体不包含 `captcha`。插件初始化时会使用已保存的账号密码自动登录一次；设置页重新输入账号密码时也会执行登录。登录中、登录成功和登录失败都会通过 Toast 通知，其中失败会包含服务端或网络错误原因。登录成功后仅在 Breeze 的插件配置中保存会话 Cookie，后续收藏请求会自动复用；仓库、日志和文档不保存真实账号、密码或 Cookie。

设置中的“内容模式”会影响更新、排行和分类请求。模式映射为：全部、BL、禁漫/成人、一般（BG/男女向候选）、TL、GL；调用方显式传入 `extern.gender` 或 `extern.c_gender` 时会覆盖该设置。

## 收藏说明

收藏和取消收藏共用：

```http
POST /api/detail/favorite
```

收藏使用 `{ "val": 0, "book_id": "<漫画ID>" }`，取消使用 `{ "val": 1, "book_id": "<漫画ID>" }`；调用方已知收藏夹 ID 时，收藏请求也会透传 `folder_id`。收藏夹列表、移动和按目标收藏夹移除尚未接入，因为当前已确认的 API 只稳定支持全局收藏/取消收藏。

## 快速开始

```bash
git clone https://github.com/deretame/Breeze-plugin-example.git your-plugin-name
cd your-plugin-name
pnpm install
```

克隆后删除 `.git` 重新初始化：

```bash
# Windows
Remove-Item -Recurse -Force .git

# macOS / Linux
rm -rf .git

git init
```

然后修改 `src/common.ts` 的 `PLUGIN_ID` 和 `src/get-info.ts` 的插件信息。

## 开发

```bash
pnpm run dev
```

dev server 启动后输出 bundle 地址，在 Breeze 中通过"网络安装"加载即可调试。支持热更新。

## 构建

```bash
pnpm run build
```

构建流程：typecheck → 同步版本号 → 生成 `manifest.json` → rspack 打包 → Brotli 压缩。

**构建前请先更新 `src/get-info.ts` 中的 `version` 字段。**
