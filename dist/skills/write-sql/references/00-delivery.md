# SQL 交付

> 只管 `sql/` 下的交付脚本。Mapper XML 见 J8-MBT 系列。`p3c:` 为《Java 开发手册》章节序号，无对应条款写 `-`。

## 目录与命名

### SQL-DIR-01 目录布局固定：install / upgrade / rollback

```txt rule
level: must
severity: high
tags: sql-layout
applies: sql/**/*.sql
p3c: -
```

**规则**：

```text
sql/
├── install/{dialect}_init.sql
├── upgrade/{dialect}/
│   ├── 001_desc.sql
│   └── rollback/001_desc.sql
└── README.md
```

`install/` 只给空库；`upgrade/` 给存量；回滚**只**放 `upgrade/{dialect}/rollback/`。`upgrade/` 下不建版本目录（无 `upgrade/v1.5/`）。禁止 `sql/rollback/`、禁止把回滚与正向平铺。

**为什么**：执行顺序是「install → upgrade 升序 → 回滚降序」，布局一乱就没法脚本化执行，只能靠人记「这次跑哪几个」。

### SQL-NAM-01 文件名 `{序号}_{描述}.sql`，不带产品版本号

```txt rule
level: must
severity: medium
tags: sql-naming
applies: sql/**/*.sql
p3c: -
```

**规则**：`001_add_host_name.sql`。序号三位、单调递增；文件名禁止产品版本号（`v1.5.0`）与 `ddl`/`dml` 标记，版本只写在文件头「目标版本」。粒度 = 一次发布批次（同一目标版本可含多项，在「说明」分条列出）；L2/L3 风险项建议单独成文件以便独立回滚。

**为什么**：把版本号写进文件名后，同一版本追加变更只能取 `v1.5.0_b`，序号语义立刻失效。

## 方言覆盖

### SQL-DIA-01 变更必须覆盖 L3 声明的全部 engines

```txt rule
level: must
severity: critical
tags: multi-dialect
applies: sql/**/*.sql
p3c: -
```

**规则**：`upgrade/{dialect}/` 每个已声明方言都要有 `00N_*.sql` 与同名回滚。缺一侧即阻断。一次性例外必须在文件头「说明」写原因。禁止为「对齐规范」虚构项目没有的方言目录。

**为什么**：常见组合是开发/测试用 MySQL、客户现场用 Kingbase。少一侧时内部全绿、现场上线失败，且失败发生在发布窗口。

### SQL-DIA-02 各方言原生守卫，禁止跨方言照抄

```txt rule
level: must
severity: high
tags: multi-dialect
applies: sql/**/*.sql
p3c: -
```

**规则**：禁止把方言 A 的脚本复制到方言 B 目录而不改语法——分页、自增、upsert、字符串拼接、布尔、类型逐项核对（`SQL-TYP-01`）。吃不准时结构对齐并标「方言细节需人工确认」。

**为什么**：复制的脚本在两个目录里长得一样，评审时看起来「已覆盖全方言」，实际上其中一个跑不了。

```sql
-- GOOD —— postgres 目录：用 PG 模式
INSERT INTO dictionary (id, code) VALUES ('d1', 'ON') ON CONFLICT (id) DO NOTHING;

-- BAD —— postgres 目录直接照搬了 MySQL 的 upsert
INSERT INTO dictionary (id, code) VALUES ('d1', 'ON') ON DUPLICATE KEY UPDATE code = 'ON';
```

### SQL-DIA-03 MySQL 专有语法不得出现在 PG / Kingbase 目录

```txt rule
level: must
severity: high
tags: multi-dialect
applies: sql/upgrade/postgres/**/*.sql, sql/upgrade/kingbase/**/*.sql, sql/install/postgres_init.sql, sql/install/kingbase_init.sql
deny: (?i)auto_increment; (?i)on\s+duplicate\s+key; (?i)engine\s*=\s*innodb; (?i)\blimit\s+\d+\s*,\s*\d+
p3c: -
```

**规则**：`/postgres/`、`/kingbase/` 目录内禁止出现 MySQL 专有语法（自增、upsert、引擎选项、双参 `LIMIT`）。

**为什么**：这是复制粘贴的典型残留，报错位置在 `CREATE`/`INSERT` 关键字上，不指向真正原因；Kingbase 还有 Oracle-like 与 PG 模式两种，更需以实例为准。

```sql
-- GOOD
CREATE TABLE t_order (id bigserial PRIMARY KEY, order_no varchar(64));
SELECT id FROM t_order ORDER BY id DESC LIMIT 20 OFFSET 0;

-- BAD
CREATE TABLE t_order (id BIGINT AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO t_order (id) VALUES (1) ON DUPLICATE KEY UPDATE id = 1;
SELECT id FROM t_order ORDER BY id DESC LIMIT 0, 20;
```

### SQL-TYP-01 类型按方言对照，不假设通用

```txt rule
level: must
severity: medium
tags: multi-dialect
applies: sql/**/*.sql
p3c: MySQL 建表规约 3
```

**规则**：

| 意图 | MySQL | PostgreSQL | Oracle / Kingbase(Oracle-like) |
|---|---|---|---|
| 字符串 | `VARCHAR(n)` utf8mb4 | `varchar(n)` | `VARCHAR2` / `NVARCHAR2` |
| 布尔 | `TINYINT(1)` | `boolean` | `NUMBER(1)` |
| 时间 | `DATETIME` | `timestamp` | `TIMESTAMP` |
| 金额 | `DECIMAL(18,2)` | `numeric(18,2)` | `NUMBER(18,2)` |
| 大文本 | `TEXT` | `text` | `CLOB` |

金额禁用 `FLOAT`/`DOUBLE`（`J8-API-04`）。

**为什么**：类型漂移不会立刻报错，会在跨库迁移或统计口径对齐时集中爆发。

## 幂等

### SQL-IDM-01 DDL 幂等用本引擎原生守卫

```txt rule
level: must
severity: high
tags: idempotent
applies: sql/**/*.sql
p3c: -
```

**规则**：可重跑是底线。加列/建表/加索引各按引擎守卫：

```sql
-- MySQL
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_connection' AND COLUMN_NAME = 'host_name');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE app_connection ADD COLUMN host_name VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- PostgreSQL
ALTER TABLE app_connection ADD COLUMN IF NOT EXISTS host_name varchar(255);

-- Oracle / Kingbase(Oracle-like)
DECLARE v_cnt NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_cnt FROM user_tab_cols
     WHERE table_name = 'APP_CONNECTION' AND column_name = 'HOST_NAME';
    IF v_cnt = 0 THEN
        EXECUTE IMMEDIATE 'ALTER TABLE app_connection ADD (host_name NVARCHAR2(255))';
    END IF;
END;
/
```

**为什么**：交付脚本会被「重跑一遍确认没问题」——这一句是运维本能。不幂等就等于给了一次人为误操作的机会。

### SQL-IDM-02 seed 用存在性判断，别用覆盖写

```txt rule
level: must
severity: high
tags: idempotent, seed
applies: sql/**/*.sql
p3c: -
```

**规则**：seed 用 `WHERE NOT EXISTS`（Oracle/Kingbase 用 `dual`，PG 可 `ON CONFLICT DO NOTHING`）。用 `INSERT IGNORE` / `REPLACE` / 裸 `MERGE` 时必须在「说明」写清会静默跳过或覆盖什么。

**为什么**：seed 覆盖写会把运维在线上手改的配置冲掉，且没有任何痕迹。

```sql
-- GOOD
INSERT INTO dictionary (id, code, name)
SELECT 'dict-001', 'ENABLE', '启用' FROM dual
WHERE NOT EXISTS (SELECT 1 FROM dictionary WHERE id = 'dict-001');

-- BAD
REPLACE INTO dictionary (id, code, name) VALUES ('dict-001', 'ENABLE', '启用');
```

### SQL-IDM-03 幂等 ≠ 安全

```txt rule
level: must
severity: high
tags: idempotent, safety
applies: sql/**/*.sql
p3c: -
```

**规则**：`IF NOT EXISTS`、`ON CONFLICT`、`INSERT IGNORE`、`MERGE` 只保证「不报错」，不保证改对了。可重跑的 `UPDATE` 必须带「仅当仍是旧值」的谓词；`MERGE` 的匹配键必须精确。

**为什么**：幂等脚本第一次跑错了，第二次会安静地什么都不做——比报错更难发现。

## 回滚

### SQL-RBK-01 正向必须配同名回滚，执行序为反序

```txt rule
level: must
severity: high
tags: rollback
applies: sql/**/*.sql
p3c: -
```

**规则**：每个 `upgrade/{dialect}/00N_x.sql` 对应 `rollback/00N_x.sql`。回滚只对**已成功应用**的脚本执行，按序号降序。不可逆变更在文件头写 `不可逆: 是` + 备份/恢复方案。

> 回滚里的 `DROP TABLE` 是正常写法（`SQL-RSK-02` 因此 `exclude` 了 `rollback/**`）。
> 但要能回答两个问题：这张表里有没有不能丢的数据、丢了怎么恢复。答不上来就写明 `不可逆: 是` 并在说明里给恢复手段。

**为什么**：出问题时的前十分钟决定损失大小。等「先写个回滚脚本」的时候，数据通常已经不一样了。

## 文件头

### SQL-HDR-01 文件头必填项不得留模板占位

```txt rule
level: must
severity: high
tags: header
applies: sql/**/*.sql
deny: ^\s*--\s*(?:作者|目标版本|说明|执行环境|回滚文件)\s*:\s*\[
p3c: -
raw: true
```

> `raw: true`：本条看的的就是注释本身（文件头），不能被注释剥离遮住。

**规则**：必填 `作者` / `目标版本` / `说明` / `执行环境` / `回滚文件`；建议 `依赖` / `校验SQL` / `不可逆`；可选 `工单/需求`。缺必填即阻断；只缺工单不算阻断。方言由路径决定，不写进头。

**为什么**：半年后执行这个脚本的人只会看到文件头。没有「谁、为什么、怎么退」，脚本就是一颗不知道装没装引信的雷。

```sql
-- GOOD
-- ============================================
-- 作者:          张三
-- 目标版本:      v4.4.0
-- 工单/需求:     REQ-1024
-- 说明:          连接表增加 host_name；L1 风险
-- 执行环境:      MySQL 8.0+
-- 回滚文件:      rollback/002_add_host_name.sql
-- 依赖:          001_db_change_log.sql
-- 校验SQL:       SELECT host_name FROM app_connection LIMIT 1;
-- 不可逆:        否
-- ============================================

-- BAD
-- 作者:          [姓名或团队]
-- 目标版本:      [v4.4.0]
```

## 安全红线

### SQL-BAN-01 禁止无 WHERE 的 DELETE

```txt rule
level: must
severity: critical
tags: sql-danger
applies: sql/**/*.sql
deny: (?i)^\s*delete\s+from\s+[\w."\x60]+\s*\x3b?\s*$
p3c: MySQL 数据订正 1
```

**规则**：`UPDATE` / `DELETE` 必须有精确 `WHERE`，并在文件头写「校验SQL」。整表清理走 `TRUNCATE` 并配备份说明，不用无 `WHERE` 的 `DELETE`。

**为什么**：一次误执行就是全表数据丢失，且 `DELETE` 不走快速截断，大表还会产生巨量 binlog 与锁等待。

```sql
-- GOOD
DELETE FROM t_order WHERE create_time < '2020-01-01' AND status = 'CANCELLED';

-- BAD
DELETE FROM t_order;
```

### SQL-BAN-02 禁止 DROP DATABASE / SCHEMA

```txt rule
level: must
severity: critical
tags: sql-danger
applies: sql/**/*.sql
deny: (?i)^\s*drop\s+(?:database|schema)\b
p3c: -
```

**规则**：交付脚本禁止 `DROP DATABASE`、禁止未经批准的 `DROP SCHEMA ... CASCADE`。需要时由 DBA 在变更单下单独执行，不进仓库。

**为什么**：这两条语句的影响面是「整个环境」，没有回滚路径，误执行的代价远超这个脚本能带来的任何收益。

```sql
-- GOOD
-- 由 DBA 在变更单下单独执行，仓库不落盘

-- BAD
DROP DATABASE order_db;
DROP SCHEMA app CASCADE;
```

### SQL-BAN-03 禁止明文凭证

```txt rule
level: must
severity: critical
tags: security
applies: sql/**/*.sql
deny: (?i)identified\s+by\s+'[^']{4,}'; (?i)\bpassword\s*=\s*'[^']{2,}'
p3c: 安全规约 1
```

**规则**：脚本内禁止明文密码、API key、证书。建账号语句由 DBA 在变更单下执行，密码从密钥服务注入。

**为什么**：SQL 脚本会进仓库、进工单、进聊天记录，一处明文等于永久泄露。

```sql
-- GOOD
-- 账号与口令由 DBA 在变更单下执行，口令走密钥服务

-- BAD
CREATE USER 'app'@'%' IDENTIFIED BY 'App@2024';
-- 连接串示例: password='root123'
```

### SQL-BAN-04 禁止吞错

```txt rule
level: must
severity: high
tags: sql-danger
applies: sql/**/*.sql
deny: (?i)when\s+others\s+then\s+null
p3c: -
```

**规则**：禁止 `WHEN OTHERS THEN NULL`；异常处理只捕预期错误码，其余继续抛出。遇错即停，禁止「忽略错误继续」。

**为什么**：吞错后脚本返回成功，运维据此进入下一步，最终结果是半成功状态——比直接失败难收拾得多。

```sql
-- GOOD
EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN NULL;

-- BAD
EXCEPTION
    WHEN OTHERS THEN NULL;
```

## 风险与执行

### SQL-RSK-01 按 L1 / L2 / L3 分级并写进「说明」

```txt rule
level: must
severity: high
tags: risk
applies: sql/**/*.sql
p3c: -
```

**规则**：

| 级 | 例 | 要求 |
|---|---|---|
| L1 | 可空列、带键 seed、空表 | 成对回滚 |
| L2 | 大表重写、扩展-收缩后删列 | 备份 + 预生产演练 |
| L3 | 删表、批量清理 | `不可逆: 是` + 恢复方案 |

有回滚脚本不等于自动 L1——数据无法重建时按实际定级。

**为什么**：分级决定要不要申请窗口、要不要备份、要不要预演。定级错了，后面每一步都会跟着做错。

### SQL-RSK-02 DROP TABLE / TRUNCATE / 大表 ALTER 必须带控制措施

```txt rule
level: must
severity: high
tags: risk, sql-danger
applies: sql/**/*.sql
exclude: sql/**/rollback/**
deny: (?i)^\s*(?:drop\s+table|truncate\s+table)\b
p3c: -
```

> 回滚脚本不在管辖范围：新建表的回滚只能是 `DROP TABLE`，而 `SQL-RBK-01` 又强制每个正向脚本配回滚，
> 不排掉就是「写了就必被拦」。回滚脚本的破坏性由 `SQL-RSK-01`（L1/L2/L3 分级）
> 与 `SQL-RBK-01`（不可逆必须写备份/恢复方案）两条语义规则管。

**规则**：`DROP TABLE`、`TRUNCATE`、大表重写型 `ALTER`（MySQL 拷表、PG 非 `CONCURRENTLY` 索引、Oracle 表重定义）必须在「说明」写：备份方式、锁评估、执行窗口、校验SQL、中止阈值。能从预生产演练的先演练。

**为什么**：这些操作的共同点是「不可中断且不可快速回退」。没有备份与窗口，中途出问题只能等死。

```sql
-- GOOD
-- 说明: 删除废弃表 t_order_bak_2019；已备份至 backup/t_order_bak_2019.dump；不可逆: 是

-- BAD
DROP TABLE t_order_bak_2019;
```

### SQL-EXT-01 删列 / 收紧约束走扩展-收缩

```txt rule
level: must
severity: high
tags: migration
applies: sql/**/*.sql
p3c: -
```

**规则**：

```text
N:   加可空列 / 新表          → 旧应用仍跑
N:   回填
N+1: 应用改读写
N+2: 删旧列 / 收紧 NOT NULL
```

禁止删除运行中应用仍在读的列；大表加无默认值的 `NOT NULL` 必须先回填。

**为什么**：数据库与应用不可能同时切换。一次性删列会让「已发布但未重启」的实例立刻报错，而这种情况在滚动发布时是常态。

### SQL-EXE-01 install 与 upgrade 不得混跑

```txt rule
level: must
severity: high
tags: execution
applies: sql/**/*.sql
p3c: -
```

**规则**：新装 = `install/{dialect}_init.sql` + 升序 `upgrade/`；升级 = 只跑升序 `upgrade/`；回滚 = 只对已成功应用的脚本降序。存量库禁止跑 `install/` 或 `*_all.sql`。脚本执行 fail-stop；建议用 `db_change_log` 记账（含 checksum）。迁移账号与应用账号分离；DDL 走团队统一门禁（Flyway/Liquibase 或等价），不双轨散跑。

**为什么**：两条执行路径并存时，同一个库会被应用两次结构变更，而第二次报的错与真实原因无关。

### SQL-RDM-01 `sql/README.md` 必须维护到可自助执行

```txt rule
level: should
severity: medium
tags: docs
applies: sql/README.md
p3c: -
```

**规则**：至少包含：原则、真实目录树、命名、文件头模板、新装/升级/回滚步骤、新增变更对照、幂等与方言说明、禁止与受限、风险等级、兼容性、方言表、评审点。禁止只写三五行目录。

另建议维护一张**交付登记表**（表名与库由业务仓 L3 声明，本规则不绑定具体实现），最小字段集：

| 字段 | 含义 |
|---|---|
| `version` | 目标版本（与文件头「目标版本」一致） |
| `script` | 相对路径，如 `sql/upgrade/mysql/001_add_order.sql` |
| `dialect` | mysql / postgres / oracle / kingbase |
| `risk_level` | L1 / L2 / L3（与 `SQL-RSK-01` 分级一致） |
| `irreversible` | 是否不可逆（与文件头「不可逆」一致） |
| `applied_at` | 实际执行时间（含时区） |
| `applied_by` | 执行人 / 流水线标识 |
| `rollback_script` | 同名回滚脚本路径（与 `SQL-RBK-01` 一致） |
| `rollback_at` | 回滚时间（未回滚留空） |

**为什么要登记**：出问题时第一个问题永远是「这个版本到底跑了哪些脚本」。
只靠 git 历史回答不了——它不知道哪个分支的脚本已经在生产执行过。

**为什么**：README 是接盘者唯一的入口。写不出「怎么跑」的 README，等于所有变更都要去问当初那个人。
