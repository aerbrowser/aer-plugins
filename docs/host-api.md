# Floating Plugin Host API 4

当前插件包为 0.2.0 / Host API 4，已发布到 `aerbrowser/aer-plugins` 的 `v0.2.0`。已发布的 0.1.0 使用 API 3。新宿主兼容两者，旧宿主会拒绝 API 4 包。编辑器填入能力需要兼容 Host API 4 的宿主；旧版 Aer 需要先升级宿主。

包使用 `kind: plugin`、`dataSchema: 1`、固定入口 `ui/index.html`。API 3 权限按序为 `page.read`, `ai.transform`, `storage.local`, `clipboard.write`；API 4 在其后增加 `editor.fill`。安装器按版本核对完整权限列表。API 3 包不能调用编辑器接口。

Aer macOS 宿主使用原生 NSPanel 和隔离 WKWebView，非持久数据存储，每插件独立 `aer-plugin://<id>` origin。仅主 frame 能调用桥接，禁止外部导航、任意页面脚本、网络请求、iframe、系统进程和任意文件读写。SDK 通过 `window.webkit.messageHandlers.aer` 发送 `{id,method,params}`，接收 `window.__aerReply({id,result,error})`。

| 方法 | 参数 / 返回 |
| --- | --- |
| `page.capture` | 当前页/选区的 `text,title,url,capturedAt,extractedFrom`，以及页面图片和视频元数据，最多 60,000 字符 |
| `ai.transform` | `{action,text,target}`；translate/rewrite/shorten/titles；返回 `{text}` |
| `ai.cancel` | 取消当前模型请求 |
| `storage.get` / `storage.put` | 读取草稿 / 写入 `{draft}`，按 Profile 和插件隔离，最大 1 MiB |
| `clipboard.write` | `{text}`，最多 60,000 字符 |
| `panel.close` / `panel.minimize` | 收起为 Aer Logo，保留当前插件视图及草稿 |
| `panel.menu` / `settings.open` | 原生菜单 / 插件设置 |
| `editor.prepare`（API 4） | `{title,body,destination?}`；标题最多 200 字符，正文 60,000；X 和视频号可不填独立标题；`destination` 仅允许 `wechat-channels` 或 `xiaohongshu-video`；返回任务状态 |
| `editor.status`（API 4） | `{jobId}`，返回同一 Profile/插件的任务状态 |
| `editor.cancel`（API 4） | `{jobId}`，停止等待或后续填入，保留目标标签及已填内容 |

任务状态为 `{jobId,state,message,terminal}`；state 是 waiting/filled/conflict/failed/cancelled/expired。没有发帖、提交或保存平台草稿的 API。

## 视频抓取与发布

`page.capture` 的 `videos` 最多返回 20 条，每条包含 `kind`、`url`、`poster`、`width`、`height`、`duration`、`quality` 和 `from`。`kind` 为 `file` 时表示宿主识别到可下载的 HTTP(S) MP4/WebM/MOV；`stream` 表示 HLS/DASH 或分段资源；`blob` 表示页面临时媒体。分段流、blob、加密媒体和需要登录签名才能访问的资源不会被伪装成可下载文件。

共享界面支持单条视频下载、下载进度与取消，也支持把原文/创作稿制作成可编辑分镜并导出竖版 1080×1920 MP4。下载或导出的文件由宿主保存到 Aer 下载目录，插件不会获得任意文件系统访问权。

视频发布目标使用固定宿主路由：`wechat-channels` 打开视频号发布页，`xiaohongshu-video` 打开小红书视频发布页。插件会填入可识别的标题和正文；视频文件仍由用户在平台编辑器中手动上传，封面、平台限制和最终发表由用户核对并确认。宿主不自动点击发布，不绕过登录、验证码或平台权限。

## 页面素材与草稿

首次打开自动读取当前页；恢复已有草稿时也读取当前页，但不会覆盖已有素材、正文和手工修改。检测到新素材会提示通过「重新读取」更新。自动读取不调用模型；翻译、二创、缩写和拟标题仍需点击，使用 Aer 已配置模型，密钥不进入插件。

提取器是宿主固定脚本，排除表单、可编辑区域、隐藏节点和导航；不读取 Cookie 或登录凭据。只读取已加载文本，不保证跨源 iframe、未加载内容或图片。捕获和模型请求绑定来源标签与导航代次，失活/导航/收起时取消。

草稿保存在 `<Profile>/AerPlugins/data/<plugin>/draft.json`，每个插件一份磁盘草稿、各视图独立内存内容；最后保存者决定下次恢复内容，不是多文档历史库。新增 title/suggestions/importJob 字段保持 dataSchema 1，兼容旧稿的 input/output/source/target。卸载保留草稿。

## 平台填入

宿主按插件身份选择固定 HTTPS 地址，通过 `OpenAERAgentTab` 认领本次新建的唯一标签。不能指定 URL、CSS 选择器或脚本，不能绑定任意现有匹配网站的标签。来源与目标必须保持登记在同一 RequestContext/Profile，任务不激活已有标签。状态读取和取消可在来源失活时使用，以便用户在目标页完成登录。

公众号读取当前页面 URL 或可见站内链接中的 token，并在页面内构造固定图文编辑器地址；token 不返回插件、不发送模型。小红书等待用户选择类型、上传图片并出现标题与正文区；X 将当前创作正文填入一个帖子编辑框；二创仍可生成编号串文稿件，但追加串文和各条发布由用户在平台处理；头条号使用文章编辑器。登录后若平台没有提供可识别编辑入口，需要用户在这个新标签手动打开创作页。

就绪探测不携带稿件。只有目标处于活动状态、路由属于该平台编辑器时才发送标题/正文；写入前再次验证文档内的就绪标记、URL 和编辑器元素身份。字段出现非空且不同的内容，或已有正文媒体时停止，避免覆盖草稿。小红书等平台已上传的封面/附件位于正文以外，不受此检查影响。

填入通过原生输入 setter/事件、浏览器编辑事务，以及匹配可见正文的现有公众号 UEditor API 完成。正文按纯文本/安全段落传入，不接受任意 HTML。350ms 后比对完整可见文本，不能确认或发生截断则提示失败；一旦尝试写入就不会自动重试，避免重复或覆盖用户后续修改。检查不是平台服务端保存凭据，最终仍需用户检查排版、封面、来源和平台限制并确认发布。

等待上限 10 分钟，单次执行上限 8 秒，全局最多 8 个未完成任务；过多重定向会停止。来源导航/关闭、目标关闭、Profile 变化、卸载、更新或显示设置变化会取消。切换来源标签、收起面板本身不会取消已明确请求的跨标签填入。任务仅在内存持有稿件，完成后清除，状态保留 5 分钟供查询；浏览器重启不恢复任务。

## 分发

动态包使用 ECDSA P-256 签名目录、序号/有效期检查、大小/SHA-256、ZIP 路径/符号链接校验和原子激活。包内容变化必须升版本；不得覆盖旧资产。0.2.0 的四个 `.aerplugin` 已签署并上传到 `v0.2.0`，`catalog/stable.json` 已更新为 Host API 4；宿主内置公钥未变。
