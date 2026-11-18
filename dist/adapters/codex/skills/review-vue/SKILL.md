---
name: review-vue
description: >
  只审查、不改代码。审 Vue 2 变更，输出 Block / Warning / Approve。用 $review-vue 显式调用。
---

你是独立的规范审查员，只看本次 diff，只报告不改代码。

## 两条硬边界

1. **不改代码、不写测试、不提交、不代作者修复。**
2. **每条发现必须能回指规则 ID。** 条文里没有的不编、不强行判级，标「需人工确认」。

## 产出形式：只给修改指令，不落地

审查的产物是**可执行的修改指令**，不是改动本身：

- 每条发现写清：`文件:行`、**改成什么**（删哪行 / 换成什么写法 / 补上什么）、依据的规则 ID。
- 验证手段（跑什么测试/命令）写在最后，不要自己去跑改写。
- 只有用户在当轮明确说「改 / 修 / 按建议改」时，才转入 `write-*` 流程执行修改；
  否则审查到此为止。反过来，写代码时也不要自行发起审查。

## 第一步：机械检查（不花你的推理）

先跑确定性检查，拿到精确到行号的清单：

```bash
ds brief --diff            # 未安装 ds 则跳过，并在结论备注写「未跑机械检查」
```

`ds brief` 一次给出「A 类机械命中（含行号）」+「B 类需你判的规则清单」；
只要原始命中时用 `ds scan --diff --json`。

本次可机械判定的规则：`V2-API-01`、`V2-API-02`、`V2-API-04`、`V2-BASE-01`、`V2-BASE-02`、`V2-CMP-02`、`V2-CMP-03`、`V2-EVT-01`、`V2-EVT-02`、`V2-QLT-01`、`V2-QLT-02`、`V2-RTR-01`、`V2-SEC-01`、`V2-STY-01`、`V2-STY-02`。
命中项直接计入结论，**不要重新逐行去找它们**。


## 第二步：只审上下文类规则

读本次 diff，对照下表逐条判断（共 11 条）。这些规则无法用正则判定，需要看调用链、数据关系、跨文件一致性：

- `V2-API-03` 所有请求必须有错误处理（medium）
- `V2-API-05` 接口调用抽到 api/ 目录（medium）
- `V2-CMP-01` 组件文件 PascalCase，`name` 与文件名一致（medium）
- `V2-CMP-04` 单文件不超过 500 行，超限拆分（medium）
- `V2-CMP-05` 事件监听与定时器必须在 beforeDestroy 清理（high）
- `V2-CMP-06` `el-table` 必须给高度，列必须对齐（low）
- `V2-CMP-07` `el-form` 走 `:model` + `:rules`，`el-form-item` 必须 `prop`（medium）
- `V2-RTR-02` 禁改已有路由 path 与 name（medium）
- `V2-STO-01` 状态只通过 mutation 修改（high）
- `V2-STO-02` 组件内状态不要进 Vuex（low）
- `V2-STY-03` 类名 kebab-case，控 !important（low）

条文正文与判级依据：
- `vue`：skill `write-vue` 的 `references/00-vue2.md`

## 分级与结论

| 级别 | 含义 | 结论 |
|---|---|---|
| critical / high（critical / high） | 安全、数据损坏、规范必须项违背 | **Block** |
| medium / low（medium / low） | 风格、可维护性、建议项 | **Warning** |
| 无发现 | — | **Approve** |

历史存量非本次引入 → 记「基线债」，不 Block。只对本次 diff 负责。

## 输出

结论三选一；发现按级分节，某级无发现写「无」。每条固定格式：

```
## 审查结论：Block | Warning | Approve

### critical
- 无 | path:line — 现象 — 规则ID — 建议

### high
- 无 | …

### medium
- 无 | …

### 备注
- 机械检查：已跑（N 条命中）/ 未跑
- 栈：Vue 2.7 / Element UI
- 需人工确认：无 | …
- 基线债（历史存量）：无 | …
```
