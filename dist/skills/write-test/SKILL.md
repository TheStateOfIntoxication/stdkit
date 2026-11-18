---
name: write-test
description: >
  按 stdkit 规则写单元测试。仅在用户**明确要求**写测试时使用（写侧默认不写测试）。在要写 JUnit 4 / Mockito 单测、
  Jest + @vue/test-utils 组件测试、要判断该测什么/怎么避免 flaky，或输入 /write-test 时使用。
---

# 单元测试

权威条文只在本目录 `references/`。规则用稳定 ID 引用（如 `UT-GEN-01`），不要按章节名回指。

栈：JUnit 4 + Mockito · Jest + @vue/test-utils

## 条文

- `references/00-unit.md`（本 skill 自带，规则正文与元数据）

## 规则索引（10 条）

| 规则 ID | 级别 / 严重度 | 标题 |
|---|---|---|
| `UT-GEN-01` | must / high | 测行为与边界，不测私有实现 |
| `UT-GEN-02` | must / high | 必须覆盖清单 |
| `UT-GEN-03` | must / medium | 一个用例一个意图，用例间互不依赖 |
| `UT-GEN-04` | must / high | 禁提交被禁用的用例 |
| `UT-GEN-05` | must / high | 禁 sleep 等待异步 |
| `UT-GEN-06` | must / high | 用例必须可重复：不依赖真实时间、随机、网络 |
| `UT-J8-01` | must / high | 单测不连真库、真 Redis、真 MQ |
| `UT-J8-02` | must / medium | 断言走断言库，不靠打印 |
| `UT-NAM-01` | should / low | 用例命名说清场景与期望 |
| `UT-VUE-01` | must / medium | Vue2 单测测 props / emit / 渲染，不测内部方法 |

## 步骤

1. 读业务仓根 `AGENTS.md`（L3）：Java/Vue 版本、engines、API Mode、分页上限、时区、根包、存量包映射。
2. 新项目：复制 stdkit `templates/AGENTS.md` 到业务仓根填满；存量仓只跟随现有结构，禁止为对齐规范搬包。
3. 按需读命中章节：先看规则索引定位 ID，再在 `references/` 里读该条正文与示例。
4. 只改需求范围。多方言有几套改几套。
5. 机械检查自查：`ds scan` （4 条规则带正则守卫，本机可跑）。
6. 写完即止：不写测试、不触发审查、不提交；测试与审查仅人手动触发。

## 约束

- 冲突优先级：业务仓 `AGENTS.md` > 本 skill `references/` > stdkit `policy/` 默认值。
- 回指一律用规则 ID（`UT-GEN-01`），不用「文件名 §章节」。
- 条文没有的不要凭空发明；不确定先问。
- 示例全部 Java 8 / Vue 2.7 可运行；不要引入版本外语法。
