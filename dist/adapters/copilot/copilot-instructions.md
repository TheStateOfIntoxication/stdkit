# Copilot 指令（stdkit）

本仓遵循 stdkit 工程规范（JDK8 / Vue2 / SQL，共 127 条）。规则以 ID 引用。

- 改 `*.java` / Mapper XML：遵守 skill `write-java`；金额用 `BigDecimal`（J8-API-04），列表必须分页有上限（J8-SPR-10），写路径幂等（J8-SPR-12），事务内禁远程（J8-SPR-03）。
- 改 `*.vue`：Vue 2 + Options API + Element UI，禁 TypeScript 与 Pinia（V2-BASE-01、V2-BASE-02）。
- 改 `sql/`：目录与文件头、幂等守卫、同名回滚、全量方言（SQL-DIR-01、SQL-IDM-01、SQL-RBK-01、SQL-DIA-01）。
- 只改需求范围，不顺手重构、不搬包。不确定先问。
- 不自动写测试、不自动触发审查。
