// 结构与 CLI 层单测：npm test（scripts/run-tests.mjs）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { ROOT, detectLayout } from './util.mjs';
import { buildCatalog } from './catalog.mjs';
import { buildFiles, isDistStale, refFiles } from './build.mjs';
import { listFiles, runScan, globToRegExp, makeStripper, skipByPath, matchLine, scanText, stripLines, changedLines, GIT } from './scan.mjs';
import { EXCEPTION_WORDING, runCheck, printCheck, rootStrayFiles } from './check.mjs';
import { matchesDeclared, detectEngines } from './init.mjs';
import { runPublishCheck, runHistoryCheck } from './publish.mjs';
import { planInstall, applyInstall } from './install.mjs';
import { runCrossCheck } from './cross.mjs';
import { runEvals } from './eval.mjs';

const read = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-'));

test('build：rules/<domain> 下每个文件都进了对应 skill 的 references', () => {
  const files = buildFiles(ROOT);
  const cat = buildCatalog(ROOT);
  for (const skill of cat.skills ?? []) {
    for (const ref of refFiles(ROOT, skill.domain)) {
      const key = `skills/${skill.name}/references/${ref}`;
      assert.ok(files.has(key), `${key} 缺失`);
      assert.equal(files.get(key), read(path.join(ROOT, 'rules', skill.domain, ref)), `${key} 内容与源不一致`);
    }
  }
  // domain 下的 .md 必须都被某个 skill 收走，否则规则正文对 Agent 不可见
  for (const d of fs.readdirSync(path.join(ROOT, 'rules'), { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('_')) continue;
    if (!(cat.skills ?? []).some((s) => s.domain === d.name)) continue;
    for (const ref of refFiles(ROOT, d.name)) {
      assert.ok(
        [...files.keys()].some((k) => k.startsWith('skills/') && k.endsWith(`/references/${ref}`)),
        `rules/${d.name}/${ref} 没有被任何 skill 收录`,
      );
    }
  }
});

test('build：dist 与规则同步（stale 会给出原因）', () => {
  const st = isDistStale(ROOT);
  assert.equal(st.stale, false, st.reason);
});

test('listFiles：只跳过带 cases/ 的 evals 目录，业务仓同名目录照常扫', () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'evals/cases/x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'evals/cases/x/A.java'), 'class A {}');
  fs.mkdirSync(path.join(root, 'src/evals'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/evals/B.java'), 'class B {}');

  const got = listFiles(root).map((p) => path.relative(root, p).split(path.sep).join('/'));
  assert.ok(!got.some((p) => p.startsWith('evals/')), `fixture 目录应跳过：${got.join(', ')}`);
  assert.ok(got.includes('src/evals/B.java'), `普通目录不应跳过：${got.join(', ')}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('check：例外措辞能认出「除 … 外」「只允许」，不误伤「内部」', () => {
  const hit = (s) => (s.match(EXCEPTION_WORDING) ?? [null])[0];
  assert.ok(hit('除 `fetch.js` 内部外禁止直接 import axios'));
  assert.equal(hit('拦截器内部是唯一允许 JSON.parse(response.data) 的位置'), '唯一允许');
  assert.equal(hit('`@Transactional` 只允许用于 Service 方法'), '只允许');
  assert.ok(hit('注释里的示例代码不在管辖范围'));
  // M-4：条文承诺的豁免通道（L3 / baseline）也必须能认出来
  assert.ok(hit('极简单表 CRUD 若要豁免由 L3 声明'));
  assert.ok(hit('由 L3 的 engines 决定方言'));
  assert.equal(hit('头部注释可省略'), '可省略');
  // 含「内部」但无例外语义的正文不该报——否则这条校验会被噪声淹掉
  assert.equal(hit('Service 内部方法上只读查询加 readOnly'), null);
  assert.equal(hit('不得大面积覆盖第三方组件内部结构'), null);
  assert.equal(hit('跨行空块抓不到，归人工审查'), null);
});

test('doctor：L3 写粗粒度版本、多值分隔符不同，都不算不一致', () => {
  assert.equal(matchesDeclared('2.x', '2.3.1.RELEASE'), true);
  assert.equal(matchesDeclared('8', '8'), true);
  assert.equal(matchesDeclared('2.7', '2.7.16'), true);
  assert.equal(matchesDeclared('3.x', '2.3.1.RELEASE'), false);
  // engines 多值：斜杠 / 逗号 / 顺序 都不影响
  assert.equal(matchesDeclared('mysql / kingbase', 'mysql,kingbase'), true);
  assert.equal(matchesDeclared('mysql,oracle', 'oracle,mysql'), true);
  assert.equal(matchesDeclared('mysql / postgres / kingbase / oracle（逗号分隔）', 'mysql,oracle'), true);
  assert.equal(matchesDeclared('mysql', 'oracle'), false);
  // 非版本、非多值字段退回字符串包含
  assert.equal(matchesDeclared('com.cloud', 'com.cloud'), true);
  assert.equal(matchesDeclared('com.other', 'com.cloud'), false);
});

test('detectEngines：仓根就是 sql/ 或 mapper/ 时也能探测到方言', () => {
  const base = path.join(os.tmpdir(), 'stdkit-eng');
  const f = (...p) => path.join(base, ...p);
  assert.equal(detectEngines([f('sql/upgrade/mysql/001.sql')], base), 'mysql');
  assert.equal(
    detectEngines([f('sql/upgrade/mysql/001.sql'), f('sql/upgrade/oracle/001.sql')], base),
    'mysql,oracle',
  );
  assert.equal(detectEngines([f('src/main/resources/mapper/kingbase/a.xml')], base), 'kingbase');
  assert.equal(detectEngines([f('sql/install/postgres_init.sql')], base), 'postgres');
  assert.equal(detectEngines([f('README.md')], base), null);
});

test('注释剥离：跨行 HTML 注释整段丢掉（注释掉的 SQL 不算违规）', () => {
  const xml = makeStripper('m/UserMapper.xml');
  assert.equal(xml('<!--').trim(), '');
  assert.equal(xml("SELECT * FROM t_old WHERE name LIKE '${name}'").trim(), '');
  assert.equal(xml('-->').trim(), '');
  // 注释结束后恢复正常
  assert.match(xml('SELECT id FROM t'), /SELECT id FROM t/);

  const vue = makeStripper('src/A.vue');
  assert.equal(vue('<!--').trim(), '');
  assert.equal(vue('<script setup>').trim(), '');
  assert.equal(vue('-->').trim(), '');
});

test('listFiles：业务包名叫 log/tmp/build 不能被跳过，项目根的构建目录要跳', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-skip-'));
  for (const pkg of ['log', 'tmp', 'build']) {
    fs.mkdirSync(path.join(root, 'src/main/java/com/x', pkg), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/main/java/com/x', pkg, 'A.java'), 'class A {}');
  }
  fs.mkdirSync(path.join(root, 'target/classes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'target/classes/Gen.java'), 'class Gen {}');
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>');

  const rels = listFiles(root).map((p) => path.relative(root, p).split(path.sep).join('/'));
  for (const pkg of ['log', 'tmp', 'build']) {
    assert.ok(rels.includes(`src/main/java/com/x/${pkg}/A.java`), `包名 ${pkg} 被误跳：${rels.join(', ')}`);
  }
  assert.ok(!rels.some((p) => p.startsWith('target/')), `项目根 target 应跳过：${rels.join(', ')}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('glob 大小写不敏感：.VUE 也算 Vue 文件', () => {
  assert.ok(globToRegExp('**/*.vue').test('src/A.VUE'));
  assert.ok(globToRegExp('**/*.java').test('A.Java'));
});

test('scan 可以直接传单个文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-one-'));
  const file = path.join(root, 'A.java');
  fs.writeFileSync(file, 'class A { private double amount; }');
  const r = runScan({ target: file, catalog: buildCatalog(ROOT) });
  assert.equal(r.scanned, 1);
  assert.deepEqual(
    r.findings.map((f) => f.ruleId),
    ['J8-API-04'],
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('eval：每条可机判规则都至少被一个用例命中（防死规则）', () => {
  const r = runEvals(ROOT);
  assert.deepEqual(r.uncovered, [], `未被覆盖：${r.uncovered.join('、')}`);
  assert.equal(r.failed, 0);
});

test('.vue 按块剥离：注释里的 <script> 不当块标签，字符串/属性里的 <!-- 不当注释', () => {
  const vue = makeStripper('src/A.vue');
  assert.match(vue('<div :title="\'<!--\'" />'), /:title=/); // 属性里的 <!-- 不剥
  assert.equal(vue('  <!-- 历史：<script setup> 已回退 -->').trim(), ''); // 行内注释整段去掉
  assert.match(vue('<script>'), /<script>/); // 块标签本身保留
  assert.match(vue("const t = '<!--'"), /<!--/); // script 里是普通字符串
});

// .vue / xml 注释剥离的边界矩阵。
// 这些边界（跨行、未闭合、正文提标签、引号、CDATA、块嵌套）已被改坏过三次，
// 每一条都用现象锁定，而不是锁实现。
test('注释剥离边界矩阵', () => {
  const cat = buildCatalog(ROOT);
  const hits = (rel, lines) =>
    scanText({ relPath: rel, text: lines.join('\n'), catalog: cat }).map((f) => `${f.ruleId}@${f.line}`);
  const V = 'src/App.vue';

  const cases = [
    [
      '注释正文含 </template>（正常闭合）',
      [
        '<template>',
        '  <!--',
        '  不要在模板里写 </template>',
        '  data: {',
        '  -->',
        '  <div />',
        '</template>',
      ],
      [],
    ],
    [
      '注释正文含 </script>（正常闭合）',
      [
        '<template>',
        '  <!--',
        '  不要写 </script>',
        '  document.getElementById("a").innerHTML = "x"',
        '  -->',
        '  <div />',
        '</template>',
      ],
      [],
    ],
    [
      '未闭合注释 + 行首 </template>（坏文件也要继续扫）',
      ['<template>', '  <!-- 忘了闭合', '  <div />', '</template>', '<script>', 'export default {', '  data: {', '  },', '}', '</script>'],
      ['V2-CMP-02@7'],
    ],
    [
      '未闭合注释 + 无闭合标签（吞到 EOF）',
      ['<template>', '  <!-- 忘了闭合', '  <div />', '<script>', 'export default {', '  data: {', '}', '</script>'],
      [],
    ],
    [
      'script 字符串里的 <!-- 不吞后文',
      ['<script>', 'const t = "<!-- x"', 'export default {', '  data: {', '}', '</script>'],
      ['V2-CMP-02@4'],
    ],
    [
      '模板属性里的 <!-- 不吞后文',
      ['<template>', '  <div :title="\'<!--\'" />', '</template>', '<script>', 'export default {', '  data: {', '}', '</script>'],
      ['V2-CMP-02@6'],
    ],
    ['多行注释包住 <script setup>', ['<template>', '  <!--', '  <script setup>', '  -->', '  <div />', '</template>'], []],
    [
      '行内注释后的 data 仍要报',
      ['<template>', '  <!-- 注释 -->', '  <div />', '</template>', '<script>', 'export default {', '  data: {', '}', '</script>'],
      ['V2-CMP-02@7'],
    ],
    ['script 行注释里的代码不报', ['<script>', '// const a = new Date(); Math.random()', 'export default {}', '</script>'], []],
    [
      'style 里 url(http://) 不被当行注释',
      ['<style scoped>', '.a { background: url(http://x/y.png) }', '</style>', '<script>', 'export default {', '  data: {', '}', '</script>'],
      ['V2-CMP-02@6'],
    ],
    [
      '嵌套 <template #header> 不影响块跟踪',
      [
        '<template>',
        '  <el-table>',
        '    <template #header><span>x</span></template>',
        '  </el-table>',
        '</template>',
        '<script>',
        'export default {',
        '  data: {',
        '}',
        '</script>',
      ],
      ['V2-CMP-02@8'],
    ],
    [
      'script 里 "<template>" 字符串不切换块',
      ['<script>', 'const s = "<template>"', 'export default {', '  data: {', '}', '</script>'],
      ['V2-CMP-02@4'],
    ],
    ['只有 <script> 没有 <template>', ['<script>', 'export default {', '  data: {', '}', '</script>'], ['V2-CMP-02@3']],
    ['<script> 在前、<template> 在后', ['<script>', 'export default {', '  data: {', '}', '</script>', '<template>', '  <div />', '</template>'], ['V2-CMP-02@3']],
    [
      '注释结束同行接代码',
      ['<template>', '  <!-- c --> <div :class="x" />', '</template>', '<script>', 'export default {', '  data: {', '}', '</script>'],
      ['V2-CMP-02@6'],
    ],
  ];

  for (const [name, lines, want] of cases) {
    assert.deepEqual(hits(V, lines), want, `.vue 边界：${name}`);
  }

  // XML：注释内不扫，CDATA 内照扫，未闭合到 EOF
  assert.deepEqual(hits('m/UserMapper.xml', ['<mapper>', '  <!--', "  WHERE name LIKE '${name}'", '  -->', '</mapper>']), []);
  assert.deepEqual(
    hits('m/UserMapper.xml', ['<mapper>', "  <select id='a'><![CDATA[ WHERE name LIKE '${name}' ]]></select>", '</mapper>']),
    ['J8-MBT-02@2'],
  );
  assert.deepEqual(hits('m/UserMapper.xml', ['<mapper>', '  <!-- 忘了闭合', "  <select id='a' resultType='map'>SELECT 1</select>"]), []);
});

test('skipByPath：构建目录看父目录是不是项目根（git 与 walk 同一判定）', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-skip2-'));
  fs.writeFileSync(path.join(base, 'pom.xml'), '<project/>');
  fs.mkdirSync(path.join(base, 'target/classes'), { recursive: true });
  fs.writeFileSync(path.join(base, 'target/classes/Gen.java'), 'class Gen {}');
  fs.mkdirSync(path.join(base, 'src/main/java/com/x/build'), { recursive: true });
  fs.writeFileSync(path.join(base, 'src/main/java/com/x/build/A.java'), 'class A {}');
  fs.mkdirSync(path.join(base, '.tmp'), { recursive: true });
  fs.writeFileSync(path.join(base, '.tmp/B.java'), 'class B {}');

  assert.equal(skipByPath(path.join(base, 'target/classes/Gen.java'), base), true, '项目根的 target 应跳');
  assert.equal(skipByPath(path.join(base, 'src/main/java/com/x/build/A.java'), base), false, '包名 build 不该跳');
  assert.equal(skipByPath(path.join(base, '.tmp/B.java'), base), true, '.tmp 应跳');
  fs.rmSync(base, { recursive: true, force: true });
});

test('部署配置：.ini 里的明文口令也会被 J8-SPR-15 拦', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-ini-'));
  const file = path.join(root, 'conf/app.ini');
  fs.mkdirSync(path.join(root, 'conf'), { recursive: true });
  fs.writeFileSync(file, 'db.password = Root@2024\n');
  const r = runScan({ target: file, catalog: buildCatalog(ROOT) });
  assert.deepEqual(
    r.findings.map((f) => f.ruleId),
    ['J8-SPR-15'],
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('未闭合注释在坏文件里到 </template> 收手（整文件剥离才做修复）', () => {
  const lines = ['<template>', '  <!-- 忘了闭合', '  <div />', '</template>', '<script>', 'export default { data: { a: 1 } }', '</script>'];
  const out = stripLines('src/Bad.vue', lines);
  assert.equal(out[0].trim(), '<template>');
  assert.equal(out[1].trim(), '');
  assert.equal(out[2].trim(), ''); // 仍在注释里
  assert.match(out[3], /<\/template>/); // 块边界：修复模式下重置注释
  assert.match(out[5], /data: \{/); // 后面的 script 照扫

  // 流式剥离器不知道文件坏没坏，保持「注释吞到 EOF」的语义
  const stream = makeStripper('src/Bad.vue');
  assert.equal(stream('<template>').trim(), '<template>');
  assert.equal(stream('  <!-- 忘了闭合').trim(), '');
  assert.equal(stream('</template>').trim(), '');
});

test('matchLine：传了 stripped 就不再各自调剥离器（无顺序依赖）', () => {
  const compiled = [
    {
      rule: { id: 'X-1', severity: 'high', level: 'must', raw: false, noString: false, file: 'f', line: 1, title: 't' },
      globs: [globToRegExp('**/*.java')],
      excludes: [],
      deny: [/double\s+amount/],
      allow: [],
      stripper: () => {
        throw new Error('不应该被调用');
      },
    },
  ];
  const hits = matchLine(compiled, 'src/A.java', 'private double amount;', 1, [], 'private double amount;');
  assert.equal(hits.length, 1);
});

test('剥离器健壮性：随机拼片段不挂死、不抛错', () => {
  const cat = buildCatalog(ROOT);
  const TOKENS = [
    '<template>', '</template>', '<script>', '</script>', '<style scoped>', '</style>',
    '<!--', '-->', '<![CDATA[', ']]>', '<template #header>', "<div :title=\"'<!--'\" />",
    'const s = "<!-- x"', 'const s = "<template>"', 'data: {', '  data: {', '// 注释', '/* 块注释', '*/',
    '.a { background: url(http://x/y.png) }', "SELECT * FROM t WHERE a = '${a}'", 'resultType="map"',
    'password: root123', '', '   ', '</div>',
  ];
  const exts = ['.vue', '.xml', '.html', '.java', '.sql', '.yml'];
  let seed = 20261117;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let n = 0; n < 400; n++) {
    const len = 1 + Math.floor(rnd() * 12);
    const lines = Array.from({ length: len }, () => TOKENS[Math.floor(rnd() * TOKENS.length)]);
    const rel = `src/Fuzz${exts[Math.floor(rnd() * exts.length)]}`;
    const t0 = Date.now();
    const f = scanText({ relPath: rel, text: lines.join('\n'), catalog: cat });
    const ms = Date.now() - t0;
    assert.ok(Array.isArray(f), `第 ${n} 例返回异常`);
    // 这条断言要抓的是「死循环 / 灾难性回溯」，那会是秒级；给 2s 是为了不被 CI 的负载抖动打成红灯
    // （200ms 在 2 核 runner 上并发跑三个测试文件时会偶发超时）。
    assert.ok(ms < 2000, `第 ${n} 例耗时 ${ms}ms，可能有死循环或回溯：${lines.join(' ⏎ ')}`);
  }
});

test('init --scaffold：只建默认树目录、不放文件；--dry-run 不落盘', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-scaffold-'));
  const ds = path.join(ROOT, 'cli', 'ds.mjs');
  const run = (args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [ds, ...args], { encoding: 'utf8', stdio: 'pipe' }) };
    } catch (e) {
      return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
    }
  };

  const dry = run(['init', root, '--scaffold', '--dry-run']);
  assert.equal(dry.code, 0);
  assert.match(dry.out, /controller/);
  assert.ok(!fs.existsSync(path.join(root, 'src')), '--dry-run 不应建目录');

  const real = run(['init', root, '--scaffold']);
  assert.equal(real.code, 0);
  const pkgDir = path.join(root, 'src', 'main', 'java', 'com', 'example');
  for (const d of ['controller', 'service', 'service/impl', 'mapper', 'entity', 'model', 'convert', 'config', 'common']) {
    assert.ok(fs.existsSync(path.join(pkgDir, ...d.split('/'))), `缺目录 ${d}`);
  }
  const files = [];
  const walkDir = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walkDir(abs);
      else files.push(abs);
    }
  };
  walkDir(path.join(root, 'src'));
  assert.deepEqual(files, [], '脚手架不应创建文件');

  // 再跑一次不重复建（幂等）
  const again = run(['init', root, '--scaffold']);
  assert.match(again.out, /包结构已齐/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('publish-check：本仓 0 命中，植入内部串能抓到', () => {
  // 本仓应干净（有命中说明 CHANGELOG/示例里漏了内部标识）
  // 本仓是 git 仓：没有 git 可执行文件时 publish-check 会明确报错（见下一条测试），
  // 所以这里在拿不到 git 时跳过「扫本仓」这一半，不让环境差异变成红灯。
  const hasGit = (() => {
    try {
      execFileSync(GIT, ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  if (hasGit) assert.deepEqual(runPublishCheck([ROOT]).map((h) => `${h.id}@${h.rel}`), []);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-publish-'));
  // 拼出来而不是写字面量：本文件也在 publish-check 的扫描范围内
  const leak = [
    '内网地址 ' + ['10', '1', '2', '3'].join('.'),
    '密钥 ' + 'sk_' + 'live_abc12345',
    '仓名 ' + 'cloud' + '-integration',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'leak.md'), leak);
  const ids = runPublishCheck([root]).map((h) => h.id);
  for (const id of ['private-ip', 'stripe-key', 'internal-repo']) assert.ok(ids.includes(id), `应命中 ${id}，实际 ${ids}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('LICENSE 与 package.json 一致，且 dist 带着 LICENSE', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.license, 'MIT');
  assert.match(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'), /MIT License/);
  assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'LICENSE')), 'dist/LICENSE 应随 build 生成');
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'package.json'), 'utf8')).license, 'MIT');
});

test('install：规划路径正确、dry-run 不落盘、未知目标报错', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-proj-'));

  const plan = planInstall({ distDir: path.join(ROOT, 'dist'), home, project, targets: ['claude', 'codex', 'cursor', 'copilot'] });
  const tos = plan.map((x) => x.to);
  assert.ok(tos.some((t) => t.startsWith(path.join(home, '.claude', 'commands'))), 'claude 命令应落到 ~/.claude/commands');
  assert.ok(tos.some((t) => t.startsWith(path.join(home, '.claude', 'skills', 'write-java'))), 'claude skill 应落地');
  assert.ok(tos.some((t) => t.startsWith(path.join(home, '.agents', 'skills'))), 'codex skill 应落到 ~/.agents/skills');
  assert.deepEqual(
    tos.filter((t) => t.startsWith(project)).sort(),
    [path.join(project, '.cursor/rules/stdkit.mdc'), path.join(project, '.github/copilot-instructions.md')].sort(),
  );

  const r = applyInstall(plan, { dryRun: true });
  assert.equal(r.written.length, plan.length);
  assert.ok(!fs.existsSync(path.join(home, '.claude')), 'dry-run 不应创建目录');

  assert.throws(() => planInstall({ targets: ['vscode'] }), /未知目标/);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

test('cross：缺回滚与方言缺口都能抓到，非标准布局不误报', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-cross-'));
  const w = (rel, body = 'SELECT 1;\n') => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };

  w('AGENTS.md', '# L3\n\n| 项 | 值 |\n|---|---|\n| **engines** | mysql,postgres |\n');
  w('sql/upgrade/mysql/001_a.sql');
  w('sql/upgrade/mysql/rollback/001_a.sql');
  w('sql/upgrade/mysql/002_b.sql'); // 缺回滚
  w('sql/upgrade/postgres/001_a.sql');
  w('sql/upgrade/postgres/rollback/001_a.sql'); // 缺 002_b

  const hits = runCrossCheck(root);
  const rbk = hits.filter((h) => h.ruleId === 'SQL-RBK-01');
  const dia = hits.filter((h) => h.ruleId === 'SQL-DIA-01');
  assert.deepEqual(rbk.map((h) => h.file), ['sql/upgrade/mysql/002_b.sql']);
  assert.equal(dia.length, 1);
  assert.match(dia[0].msg, /002_b\.sql/);
  assert.equal(dia[0].severity, 'critical');

  // 把回滚补齐 → 两条都消失
  w('sql/upgrade/mysql/rollback/002_b.sql');
  w('sql/upgrade/postgres/002_b.sql');
  w('sql/upgrade/postgres/rollback/002_b.sql');
  assert.deepEqual(runCrossCheck(root), []);

  // 非标准布局（没有 sql/upgrade/<dialect>/）→ 跳过，不误报
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-cross2-'));
  fs.mkdirSync(path.join(other, 'db'), { recursive: true });
  fs.writeFileSync(path.join(other, 'db/001_a.sql'), 'SELECT 1;\n');
  assert.deepEqual(runCrossCheck(other), []);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});

test('CLI：--domain 校验、--severity 计数收敛、init --dry-run 不落盘', () => {
  const ds = path.join(ROOT, 'cli', 'ds.mjs');
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'A.java'), 'class A { private double amount; }');

  const run = (args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [ds, ...args], { encoding: 'utf8', stdio: 'pipe' }) };
    } catch (e) {
      return { code: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') };
    }
  };

  const bad = run(['scan', root, '--domain', 'ts']);
  assert.notEqual(bad.code, 0, '非法 --domain 应非零退出');
  assert.match(bad.out, /不存在（可用：/);

  const full = JSON.parse(run(['scan', root, '--json']).out);
  const one = JSON.parse(run(['scan', root, '--json', '--severity', 'high']).out);
  assert.ok(one.rules < full.totalRules, `--severity 应缩小参与匹配的规则数：${one.rules} / ${full.totalRules}`);
  assert.equal(one.findings.length, 0, 'double amount 是 critical，不应出现在 --severity high 的结果里');

  const dry = run(['init', root, '--dry-run']);
  assert.equal(dry.code, 0);
  assert.ok(!fs.existsSync(path.join(root, 'AGENTS.md')), 'init --dry-run 不应写文件');
  fs.rmSync(root, { recursive: true, force: true });
});

// dist/ 单独安装（无 rules/）时的降级：这不是可选项，是 gate.sh 的活路
test('check：无 rules/ 的目录按 dist 安装处理，跳过且退出码 0', () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'catalog'), { recursive: true });
  fs.writeFileSync(path.join(root, 'catalog', 'rules.json'), '{"rules":[]}');
  // dist 安装的判据：catalog/rules.json + cli/ds.mjs，且没有 rules/（见 detectLayout）
  fs.mkdirSync(path.join(root, 'cli'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cli', 'ds.mjs'), '');

  const r = runCheck(root);
  assert.equal(r.skipped, true, '无 rules/ 应标记 skipped');
  assert.deepEqual(r.errors, [], '不应产生「规则不存在」这类假错误');

  const log = console.log;
  console.log = () => {}; // printCheck 会打一行提示，测试里吞掉
  try {
    assert.equal(printCheck(r), 0, 'dist 安装下必须 exit 0，否则 gate.sh 会拦死业务仓所有 PR');
  } finally {
    console.log = log;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('gate.sh：选项先剥离再取 base-ref，且自检步有 rules/ 守卫', () => {
  const src = fs.readFileSync(path.join(ROOT, 'templates', 'ci', 'gate.sh'), 'utf8');
  const loop = src.indexOf('case "$a" in');
  const base = src.indexOf('BASE:-origin/main');
  assert.ok(loop > 0 && base > loop, '参数循环必须在默认 ref 赋值之前，否则 --no-cross 会被当成 ref');
  assert.match(src, /--help\)/, 'gate.sh 要能 --help');
  assert.ok(src.includes('-d "'), 'gate.sh 要按 rules/ 是否存在决定跑不跑自检');
  assert.ok(src.includes('/rules" ]'), '自检守卫要检查 STDKIT 下的 rules/ 目录');
});

// 三分判定：dist 是「跳过」，走错目录是「失败」。混成一件事就会让 rules/ 被误删也绿着通过
test('detectLayout：rules-repo / dist-install / unknown 三态可区分', () => {
  const root = tmpdir();
  assert.equal(detectLayout(root), 'unknown', '空目录应是 unknown');

  fs.mkdirSync(path.join(root, 'catalog'), { recursive: true });
  fs.writeFileSync(path.join(root, 'catalog', 'rules.json'), '{"rules":[]}');
  assert.equal(detectLayout(root), 'unknown', '只有 catalog 还不够，必须同时有 cli/ds.mjs');

  fs.mkdirSync(path.join(root, 'cli'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cli', 'ds.mjs'), '');
  assert.equal(detectLayout(root), 'dist-install', 'catalog + cli 就是 dist 安装');

  fs.mkdirSync(path.join(root, 'rules'), { recursive: true });
  assert.equal(detectLayout(root), 'rules-repo', '有 rules/ 就是规则仓（即便别的都不全）');
  fs.rmSync(root, { recursive: true, force: true });
});

test('check：不认识的目录 exit 2，不伪装成「已检查」', () => {
  const root = tmpdir();
  const r = runCheck(root);
  assert.equal(r.layout, 'unknown');
  assert.equal(r.skipped, false, 'unknown 不能标 skipped');
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(printCheck(r), 2, '走错目录必须 exit 2');
  } finally {
    console.log = log;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('仓根白名单：陌生文件会被点名，白名单文件与目录不误报', () => {
  const root = tmpdir();
  fs.writeFileSync(path.join(root, 'README.md'), '# x');
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'ovl.mjs'), '// 一时手快落在仓根');
  fs.writeFileSync(path.join(root, '.gitignore'), '');
  fs.mkdirSync(path.join(root, 'cli'));
  fs.mkdirSync(path.join(root, '.idea'));
  const stray = rootStrayFiles(root);
  assert.deepEqual(stray, ['ovl.mjs'], `只应点名 ovl.mjs，实际：${stray.join(',')}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('gate.sh：三分守卫（规则仓 / dist / 残缺安装）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'templates', 'ci', 'gate.sh'), 'utf8');
  assert.match(src, /elif \[ -f "\$STDKIT\/catalog\/rules\.json" \]/, 'dist 分支按 catalog/rules.json 判定');
  assert.match(src, /既不是规则仓（无 rules\/）也不是 dist 安装/, '第三个分支要明确报错');
});

test('publish-check：git 仓但调不到 git 时明确报错，不静默降级', () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a.md'), 'x');
  const log = console.log;
  console.log = () => {};
  try {
    assert.throws(() => runPublishCheck([root]), /需要 git|DS_GIT/, 'git 仓缺 git 必须报错');
  } finally {
    console.log = log;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('publish-check：非 git 目录退回遍历，跳过 .idea 等本地产物', () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, '.idea'), { recursive: true });
  // 拼出来而不是写字面量：本文件也在 publish-check 的扫描范围内（否则规则会抓到自己的测试）
  const abs = ['D:', 'work', 'project'].join('/');
  const ws = 'Alibaba' + '_codeup';
  fs.writeFileSync(path.join(root, '.idea', 'workspace.xml'), abs + '/' + ws + '/x');
  const hits = runPublishCheck([root]);
  assert.deepEqual(hits.map((h) => h.rel), [], '.idea 不应被扫（否则每台机器都报本机路径）');
  fs.rmSync(root, { recursive: true, force: true });
});

test('changedLines：非 git 目录的报错里带 git 自己的话（stderr 被捕获，不是透传到我们的输出）', () => {
  const gitAvailable = (() => {
    try {
      execFileSync(GIT, ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  if (!gitAvailable) return; // 没有 git 的环境由「publish-check 缺 git 报错」那条覆盖

  const root = tmpdir();
  fs.writeFileSync(path.join(root, 'a.java'), 'class A {}');
  assert.throws(() => changedLines(root, 'HEAD'), (e) => {
    assert.match(e.message, /DS_GIT/, '报错要给出可执行的下一步');
    assert.match(e.message, /not a git repository/i, 'git 的 stderr 应被拼进报错，而不是打到自己的 stderr');
    return true;
  });
  fs.rmSync(root, { recursive: true, force: true });
});

// force-push 不删对象：工作树干净不等于历史干净，这条断言守的就是这件事
test('publish-check --history：抓得到「提交过又删掉」的泄漏，allowPaths 与 historyAllow 生效', () => {
  const gitAvailable = (() => {
    try {
      execFileSync(GIT, ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  if (!gitAvailable) return;

  const root = tmpdir();
  const g = (...a) => execFileSync(GIT, ['-C', root, ...a], { stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  g('init', '-q');
  fs.writeFileSync(path.join(root, 'keep.md'), 'hello');
  g('add', '-A');
  g('commit', '-qm', 'init');

  // 拼出来而不是写字面量：本文件也在 publish-check 的扫描范围内
  const leak = '内网地址 ' + ['10', '9', '9', '9'].join('.');
  fs.writeFileSync(path.join(root, 'leak.md'), leak);
  g('add', '-A');
  g('commit', '-qm', 'add leak');
  fs.rmSync(path.join(root, 'leak.md'));
  g('add', '-A');
  g('commit', '-qm', 'remove leak');

  assert.deepEqual(runPublishCheck([root]).map((h) => h.id), [], '工作树已经干净');
  const hist = runHistoryCheck(root);
  assert.ok(hist.some((h) => h.id === 'private-ip' && h.rel === 'leak.md'), '历史里应抓到 private-ip');

  // 同一条命中，被 historyAllow 枚举后就该消失（历史改不掉，接受要写下来）
  const allowed = runHistoryCheck(root, { forbidden: hist.length ? [{ id: 'private-ip', pattern: '\\b(?:10\\.\\d{1,3})\\.\\d{1,3}\\.\\d{1,3}\\b', why: 'x' }] : [], allowPaths: [], historyAllow: [{ id: 'private-ip', path: 'leak.md', reason: '测试' }] });
  assert.deepEqual(allowed, [], 'historyAllow 命中后应被排除');
  fs.rmSync(root, { recursive: true, force: true });
});
