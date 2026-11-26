# takeaway
今天吃什么

这是可匿名访问的午餐助手演示。GitHub 保存源代码，Cloudflare Workers 运行页面和 API，D1 保存各浏览器的演示会话、偏好和订单。页面没有 ChatGPT 登录流程。

## 本地验证

需要 Node.js 22.13 或更高版本。

```sh
npm ci
npm test
npm run build
npm run db:local
npm start
```

按终端输出打开本地地址。默认的本地规则可运行文字推荐。云模型和录音转写使用服务端模型配置。

## 部署到 Cloudflare

1. 在 Cloudflare 创建 D1 数据库 `takeaway`，复制数据库 UUID。
2. 在 **Workers & Pages → Create application** 连接此仓库。将构建命令设为 `npm run build`、部署命令设为 `npm run deploy`，将 `TAKEAWAY_D1_ID` 设为构建变量。部署脚本先执行 D1 迁移，再发布 Worker。构建部署用的 API Token 需要对该 Cloudflare 账号有 D1 编辑和 Workers 部署权限，默认生成的构建令牌可能不包括 D1。
3. 在 Worker 的 **Settings → Variables and Secrets** 把百炼密钥添加为 Secret，名称为 `LUNCH_DEFAULT_BAILIAN_KEY`。打开 Cloudflare 提供的网站地址测试。密钥保存在 Worker 运行环境。
4. 首次部署使用新的 D1 数据库。ChatGPT Sites 上已有的访客 Cookie、偏好和订单属于原站点。

也可在具有 Cloudflare 授权的终端中设置 `TAKEAWAY_D1_ID` 后运行 `npm run build` 和 `npm run deploy`。可用 `npx wrangler secret put LUNCH_DEFAULT_BAILIAN_KEY --config dist/server/wrangler.json` 安全设置运行时密钥。

## GitHub Pages

部署好上面的 Cloudflare Worker 后，在仓库根目录执行：

```sh
VITE_LUNCH_API_ORIGIN=https://takeaway.<你的子域>.workers.dev npm run build:pages
```

将地址替换为实际 Worker 的 HTTPS 域名，也可以使用 Worker 绑定的自定义域名。将 `dist/pages` 的产物发布到 `gh-pages` 分支根目录，并保留 `.nojekyll`。GitHub Pages 访客无需登录，浏览器会直接向 Worker 请求 `/api`。Worker 允许 `https://double-bean.github.io` 跨域访问，以会话头维护访客身份。

未设置 Worker 地址或首次连接失败时，页面使用本地规则和浏览器内的演示会话；云端文字模型与录音转写需要可达的 Worker 和服务端百炼密钥。切换线上地址前，分别从中国大陆网络测试页面加载、文字推荐和录音转写。

## 腾讯云 SCF 后端 + 原 GitHub Pages

这个方案保留 `https://double-bean.github.io/takeaway/`。在切换前保持生产发布分支 `gh-pages` 的 API 地址。

1. 在腾讯云选择同一个中国大陆地域和 VPC，创建 MySQL 数据库。建库后执行 `scf/schema.sql`。为应用创建仅能对这两个表查询、插入和更新的账号，使用 MySQL 内网连接地址。
2. 在项目根目录执行 `npm ci`、`npm ci --prefix scf`、`npm run test:scf` 和 `npm run package:scf`。最后一条命令需要 `zip`，生成 `dist/takeaway-scf.zip`。在 SCF 控制台新建 **Web 函数**，选择 **Node.js 20.19**，上传 ZIP，监听 **9000**，执行超时设为 **30 秒**作为联调起点。函数需能访问 MySQL 内网和百炼公网服务。
3. 在 SCF 函数环境变量中设置 `MYSQL_HOST`、`MYSQL_PORT`（默认 3306）、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD` 和 `LUNCH_DEFAULT_BAILIAN_KEY`。数据库启用 TLS 时可设置 `MYSQL_SSL_CA` 为受信任的 PEM 证书。密码和百炼密钥只保存在云端运行配置。
4. 开启公网 **函数 URL**。浏览器跨域响应由应用处理，函数 URL 的附加 CORS 规则留空，以免重复添加响应头。用 GitHub Pages 来源验证 `GET /api/session?daily=manual`、文字请求和录音转写。
5. 使用 `VITE_LUNCH_API_ORIGIN=<函数的公开HTTPS地址> npm run build:pages` 构建，再发布到原 `gh-pages` 分支。切换前从中国大陆网络测试完整用户流程。

SCF 使用独立的 MySQL 数据库。已有 Cloudflare D1 数据和旧站会话需要单独迁移。
