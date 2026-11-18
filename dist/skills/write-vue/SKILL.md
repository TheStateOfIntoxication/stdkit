---
name: write-vue
description: >
  按 stdkit 规则写或改 Vue 2.7 + Element UI + JavaScript（Options API）前端。在要写组件、改页面、改路由/Vuex、封装请求、动 *.vue、
  提到 Element UI、Options API、禁 TypeScript、禁 Pinia、data/props、样式 scoped，或输入 /write-vue 时使用。
  不要用来写 Java 或 sql/ 脚本。
---

# Vue 2 前端

权威条文只在本目录 `references/`。规则用稳定 ID 引用（如 `V2-API-01`），不要按章节名回指。

栈：Vue 2.7 · Element UI 2.15 · Vuex 3 · Vue Router 3 · Axios

## 条文

- `references/00-vue2.md`（本 skill 自带，规则正文与元数据）

## 规则索引（26 条）

| 规则 ID | 级别 / 严重度 | 标题 |
|---|---|---|
| `V2-API-01` | must / high | 只走统一封装，禁裸 axios / fetch |
| `V2-API-02` | must / high | 接口基址来自配置，禁在页面里拼地址 |
| `V2-API-03` | must / medium | 所有请求必须有错误处理 |
| `V2-API-04` | must / high | 响应解包由拦截器统一，禁二次解析 |
| `V2-API-05` | must / medium | 接口调用抽到 api/ 目录 |
| `V2-BASE-01` | must / high | 只用 Options API，禁 Composition API 与 TypeScript |
| `V2-BASE-02` | must / high | 禁 Pinia、禁第二个 UI 库、禁原子化 CSS |
| `V2-CMP-01` | must / medium | 组件文件 PascalCase，`name` 与文件名一致 |
| `V2-CMP-02` | must / high | data 必须是函数 |
| `V2-CMP-03` | must / medium | props 必须声明类型 |
| `V2-CMP-04` | must / medium | 单文件不超过 500 行，超限拆分 |
| `V2-CMP-05` | must / high | 事件监听与定时器必须在 beforeDestroy 清理 |
| `V2-CMP-06` | must / low | `el-table` 必须给高度，列必须对齐 |
| `V2-CMP-07` | must / medium | `el-form` 走 `:model` + `:rules`，`el-form-item` 必须 `prop` |
| `V2-EVT-01` | must / high | 用 Vue 方式操作 DOM，禁 jQuery 与 innerHTML |
| `V2-EVT-02` | must / medium | 提示用 $message / $confirm，禁原生 alert / confirm |
| `V2-QLT-01` | must / medium | 禁 console 与 debugger 进提交 |
| `V2-QLT-02` | must / low | const/let，禁 var |
| `V2-RTR-01` | must / high | 路由懒加载，禁 window.location 跳转 |
| `V2-RTR-02` | must / medium | 禁改已有路由 path 与 name |
| `V2-SEC-01` | must / critical | 前端包内禁真实密钥 |
| `V2-STO-01` | must / high | 状态只通过 mutation 修改 |
| `V2-STO-02` | should / low | 组件内状态不要进 Vuex |
| `V2-STY-01` | must / medium | 组件样式必须 scoped |
| `V2-STY-02` | must / medium | 禁在组件内用 :global() 覆盖 Element UI |
| `V2-STY-03` | should / low | 类名 kebab-case，控 !important |

## 步骤

1. 读业务仓根 `AGENTS.md`（L3）：Java/Vue 版本、engines、API Mode、分页上限、时区、根包、存量包映射。
2. 新项目：复制 stdkit `templates/AGENTS.md` 到业务仓根填满；存量仓只跟随现有结构，禁止为对齐规范搬包。
3. 按需读命中章节：先看规则索引定位 ID，再在 `references/` 里读该条正文与示例。
4. 只改需求范围。多方言有几套改几套。
5. 机械检查自查：`ds scan` （16 条规则带正则守卫，本机可跑）。
6. 写完即止：不写测试、不触发审查、不提交；测试与审查仅人手动触发。

## 约束

- 冲突优先级：业务仓 `AGENTS.md` > 本 skill `references/` > stdkit `policy/` 默认值。
- 回指一律用规则 ID（`V2-API-01`），不用「文件名 §章节」。
- 条文没有的不要凭空发明；不确定先问。
- 示例全部 Java 8 / Vue 2.7 可运行；不要引入版本外语法。
