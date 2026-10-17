import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const run = (...args: string[]) =>
  spawnSync(
    process.execPath,
    [
      '--import',
      resolve('tests/mock-fetch.mjs'),
      resolve('packages/cli/bin/zen-syllabus.js'),
      ...args,
    ],
    { encoding: 'utf8', timeout: 5000 },
  );
it('searches from a real CLI process and prints concise Japanese results', () => {
  const r = run('search', 'プログラミング');
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('テスト科目');
  expect(r.stdout).toContain('全1件');
  expect(r.stdout).not.toContain('テスト授業内容');
});
it('outputs parseable JSON without extra stdout', () => {
  const r = run('search', 'Python', '--json');
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).subjects[0].name).toBe('テスト科目');
  expect(r.stderr).toBe('');
});
it('shows complete lesson and textbook information', () => {
  const r = run('show', 'INF-1-C1-1030-001', '--year', '2026');
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('テスト授業内容');
  expect(r.stdout).toContain('テスト教科書');
  expect(r.stdout).toContain('レポート100%');
});
it('prints a comparison table and supports JSON', () => {
  const args = [
    'compare',
    'INF-1-C1-1030-001',
    'INF-1-C1-1030-002',
    '--year',
    '2026',
  ];
  const r = run(...args);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('評価方法');
  expect(r.stdout).toContain('INF-1-C1-1030-002');
  expect(JSON.parse(run(...args, '--json').stdout).results).toHaveLength(2);
});
it('marks handbook relations as reference information', () => {
  const r = run('prerequisites', 'INF-1-C1-1030-001', '--year', '2026');
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('参照情報');
});
it('lists typed filters', () => {
  const r = run('filters', 'teacher', '--json');
  expect(r.status).toBe(0);
  expect(Object.keys(JSON.parse(r.stdout).options)).toEqual(['teacher']);
});
it('returns partial comparison output and exit 1', () => {
  const r = run(
    'compare',
    'INF-1-C1-1030-001',
    'INF-1-C1-1030-003',
    '--year',
    '2026',
    '--json',
  );
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).results[1].error.code).toBe('SUBJECT_NOT_FOUND');
});
it.each([
  ['show', 'INF-1-C1-1030-001'],
  ['search', '--quarter', 'invalid'],
  ['filters', 'invalid'],
  ['search', '--typo', '--json'],
])('returns exit 2 for invalid input %j', (...args) => {
  const r = run(...args);
  expect(r.status).toBe(2);
  expect(r.stdout).toBe('');
  expect(r.stderr).toContain('INVALID_INPUT');
});
it('returns structured upstream errors on stderr and exit 1', () => {
  const r = run('search', '__ERROR__', '--json');
  expect(r.status).toBe(1);
  expect(r.stdout).toBe('');
  expect(JSON.parse(r.stderr).error.code).toBe('UPSTREAM_HTTP');
});
