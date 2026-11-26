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

## 魔搭创空间部署

[创建公开 Docker 创空间](https://modelscope.cn/studios)，选择可用的免费 CPU 规格。应用在同一个 HTTPS 域名提供页面和 `/api/`，访问者可以直接体验对话、推荐和录音转写。分享时使用创空间应用的独立 `*.ms.show` HTTPS 地址，便于浏览器保存会话和申请麦克风权限。

把 `deploy/modelscope` 分支的文件同步到创空间仓库根目录，保留创空间初始化生成的配置。Docker 服务监听 `0.0.0.0:7860`。在创空间的「设置 → 环境变量」配置以下项目。

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` | 密钥 | 可调用模型的百炼华北 2（北京）API Key |
| `LUNCH_BASE_URL` | 普通变量 | 百炼控制台代码示例中完整的 `base_url`。使用北京公共端点时可省略 |
| `LUNCH_EMBED_MODEL` | 普通变量 | 可选，默认尝试 `text-embedding-v4`，失败时使用本地标签向量 |
| `LUNCH_TEXT_MODEL`、`LUNCH_SPEECH_MODEL` | 普通变量 | 可选，默认均为 `qwen3.8-omni-flash` |

申请新密钥并撤销已公开的密钥。密钥只填在创空间私密配置中，避免写入 Git、Dockerfile 或截图。百炼的模型用量按账号额度和计费规则计算。

### 同步到魔搭

从空间的克隆入口复制实际 Git 地址，并替换下方的 `<空间 Git 地址>`。HTTPS 要求认证时，用户名用 `oauth2`，密码用[魔搭访问令牌](https://modelscope.cn/my/myaccesstoken)。用 Git 的密码提示输入令牌。

```bash
git clone --branch deploy/modelscope https://github.com/Double-Bean/takeaway.git takeaway-source
git clone "<空间 Git 地址>" takeaway-studio
git -C takeaway-source archive HEAD | tar -x -C takeaway-studio --exclude=README.md
git -C takeaway-studio add .
git -C takeaway-studio commit -m "Deploy Lunch Assistant"
git -C takeaway-studio push
```

等待部署状态变为运行中，打开应用独立链接。用无痕窗口发送「想吃 30 元以内的辣面」，然后使用麦克风说「改成不辣」。检查转写是否进入输入框、发送后推荐是否调整，以及采纳后是否能看到模拟订单。访问 `/healthz` 可检查服务进程是否已就绪。

本地运行使用 Node.js 24，依次执行 `npm ci`、`npm run build:studio`、`npm run start:studio`，访问 `http://localhost:7860`。`LUNCH_DATA_DIR` 可指定支持 SQLite 的持久化磁盘目录。默认数据库位于容器临时磁盘，实例重建时可能清空。不要直接把 SQLite 工作库放进对象存储挂载。
