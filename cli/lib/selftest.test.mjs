// 纯函数单测：node --test cli/lib/
import test from 'node:test';
import assert from 'node:assert/strict';

import { globToRegExp, parseGitPath, makeStripper, isExpired } from './scan.mjs';
import { formatsOf } from './check.mjs';
import { parseRules } from './parse.mjs';
import { resolveFailOn } from './policy.mjs';
import { ROOT } from './util.mjs';

test('globToRegExp：** 与 * 的语义', () => {
  assert.ok(globToRegExp('**/*.java').test('src/main/java/A.java'));
  assert.ok(globToRegExp('**/*.java').test('A.java'));
  assert.ok(!globToRegExp('**/*.java').test('A.java.bak'));
  assert.ok(globToRegExp('sql/upgrade/**/*.sql').test('sql/upgrade/mysql/001.sql'));
  assert.ok(!globToRegExp('**/controller/**/*.java').test('src/service/Foo.java'));
  assert.ok(globToRegExp('**/controller/**/*.java').test('src/controller/Foo.java'));
  assert.ok(globToRegExp('**/App.vue').test('src/App.vue'));
});

test('parseGitPath：去掉 git 的引号与转义', () => {
  assert.equal(parseGitPath('src/A.java'), 'src/A.java');
  assert.equal(parseGitPath('"src/中文 A.java"'), 'src/中文 A.java');
  assert.equal(parseGitPath('"src/quote\\"x.java"'), 'src/quote"x.java');
});

test('注释剥离：注释内代码不算违规，字符串内容保留', () => {
  const java = makeStripper('A.java');
  assert.equal(java('// private double amount;').trim(), '');
  assert.equal(java('private double amount; // 注释'), 'private double amount; ');
  assert.match(java('String u = "http://x//y";'), /http:\/\/x\/\/y/);

  const sql = makeStripper('a.sql');
  assert.equal(sql("-- DELETE FROM t").trim(), "");
  assert.match(sql("SELECT '--x' FROM t"), /'--x'/);

  const xml = makeStripper('a.xml');
  assert.equal(xml('<!-- ${name} -->').trim(), '');
  assert.match(xml('<a>${name}</a>'), /\$\{name\}/);
});

test('isExpired：按本地日末计算，不提前失效', () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.equal(isExpired(tomorrow), false);
  assert.equal(isExpired('2000-01-01'), true);
  assert.equal(isExpired(undefined), false);
});

test('resolveFailOn：阈值语义与逗号列表', () => {
  assert.deepEqual([...resolveFailOn('high', {})].sort(), ['critical', 'high']);
  assert.deepEqual([...resolveFailOn('low', {})].sort(), ['critical', 'high', 'low', 'medium']);
  assert.deepEqual([...resolveFailOn('critical,high', {})].sort(), ['critical', 'high']);
  assert.deepEqual([...resolveFailOn(undefined, { blockOn: ['critical'] })], ['critical']);
  assert.throws(() => resolveFailOn('bogus', {}));
});

test('formatsOf：按词法格式归并扩展名', () => {
  assert.deepEqual(formatsOf(['**/*.java']), ['java']);
  assert.deepEqual(formatsOf(['**/*.yml', '**/*.yaml']).sort(), ['yaml']);
  assert.deepEqual(formatsOf(['**/*.vue']), ['sfc']);
  assert.deepEqual(formatsOf(['**/*.vue', '**/*.js']).sort(), ['js', 'sfc']);
});

test('parseRules：围栏内的 # 注释不会被当成标题', () => {
  const rules = parseRules(ROOT);
  const sp15 = rules.find((r) => r.id === 'J8-SPR-15');
  assert.ok(sp15, 'J8-SPR-15 应存在');
  // yaml / properties 围栏必须保留在正文里（曾被 # 注释提前截断）
  assert.match(sp15.body, /password: root123/);
  assert.match(sp15.body, /spring\.datasource\.password=root123/);
});
