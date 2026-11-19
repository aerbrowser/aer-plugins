# Floating Plugin Host API 3

平台包使用 `kind: plugin`、`hostAPI: 3`、`dataSchema: 1`，固定入口 `ui/index.html`。四项权限按序为 `page.read`, `ai.transform`, `storage.local`, `clipboard.write`。当前宿主只接受这组能力；权限变化需要更新宿主，不能由下载包自行提权。

AER macOS 宿主使用原生 NSPanel 加独立 WKWebView，非持久化 Web 数据存储，每个插件独立 `aer-plugin://<id>` origin。主页面之外不能调用桥接，不允许外部导航。宿主强制 CSP，不允许插件直接联网、加载 iframe 或执行内联脚本。

SDK 将 `{id, method, params}` 发送至 `window.webkit.messageHandlers.aer`，通过 `window.__aerReply({id,result,error})` 收到对应结果。普通网页不获得这个对象。

| 方法 | 参数 / 返回 |
| --- | --- |
| `page.capture` | 返回 `text,title,url,capturedAt,extractedFrom`；最多 60,000 字符，优先选区 |
| `ai.transform` | `{action,text,target}`；action 为 translate/rewrite/shorten/titles；返回 `{text}` |
| `ai.cancel` | 取消当前请求 |
| `storage.get` | 读取插件草稿 |
| `storage.put` | `{draft}`；当前 Profile / 插件范围，最大 1 MiB |
| `clipboard.write` | `{text}`；最多 60,000 字符 |
| `panel.close` | 本次文档关闭 |
| `panel.minimize` | 收起 / 展开 |
| `panel.menu` | 原生插件切换及关闭菜单 |
| `settings.open` | 打开 Aer 插件设置 |

网页提取由宿主固定的只读脚本执行，插件不能提供脚本。仅采集当前文档已渲染文本，排除表单、可编辑区域、隐藏节点、导航等。跨源 iframe、未加载帖子和需要登录后才可见的数据不保证提取。页面本身不可信，页面文本作为模型用户素材，不作为系统指令。

读取和 AI 请求绑定当前标签、Profile 和导航代次，失活或导航时取消。目标网页导航不会把异步结果写入新页面。插件仅返回可编辑文本，无站点发帖权限。

草稿按插件与 Profile 持久化；活动标签各有内存稿，磁盘保存该插件最近一次写入的稿件，供下一次打开恢复。这不是多文档历史库。卸载保留草稿；重新下载不会自动迁移其他扩展的数据。

动态包共享 AER 应用安装器的 ECDSA P-256 签名、目录序列/过期检查、下载大小、SHA-256、ZIP 路径/链接校验与原子激活。独立根目录 `<Profile>/AerPlugins`，独立仓库与公钥。更新过程关闭插件视图，旧包在激活成功前保留；下载失败不替换当前包。当前需要手动检查/安装更新。
