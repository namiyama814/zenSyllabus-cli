#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import {
  SyllabusClient,
  errorResult,
  filterInputSchema,
} from '@zen-syllabus/core';
import {
  formatCompare,
  formatFilters,
  formatRelations,
  formatSearch,
  formatSubject,
} from './format.js';

const program = new Command()
  .name('zen-syllabus')
  .description('ZEN大学のシラバスを検索')
  .version('0.1.0')
  .option('--json', 'JSONで出力');
program.exitOverride().configureOutput({ writeErr: () => {} });
const client = new SyllabusClient();
function output<T>(value: T, format: (data: T) => string, cmd: Command) {
  process.stdout.write(
    (cmd.optsWithGlobals().json
      ? JSON.stringify(value, null, 2)
      : format(value)) + '\n',
  );
}
const search = program
  .command('search [query]')
  .description('科目を検索')
  .option('--year <year>', '開講年度')
  .option('--grade <grade>', '想定年次（1〜4）')
  .option('--category <id>', '分類ID')
  .option('--tag-id <id>', 'タグID')
  .option('--teacher <name>', '教員名')
  .option('--teacher-id <id>', '教員ID')
  .option('--quarter <quarter>', '開講Q（1q、1-2q、annualなど）')
  .option('--method <method>', '授業方法')
  .option('--credit <credit>', '単位数（1、2、4）')
  .option('--requirement <requirement>', '科目属性')
  .option('--pattern-id <id>', '履修パターンID')
  .option('--day <day>', '曜日')
  .option('--page <page>', 'ページ番号（1始まり）', '1')
  .option('--sort <sort>', 'subject-asc / subject-desc', 'subject-asc');
search.action(
  async (query: string | undefined, _options: unknown, cmd: Command) => {
    const { json: _json, ...opts } = cmd.optsWithGlobals();
    output(await client.search({ ...opts, query }), formatSearch, cmd);
  },
);
program
  .command('show <numbering>')
  .description('科目の詳細を表示')
  .requiredOption('--year <year>', '開講年度')
  .action(async (numbering: string, _options: unknown, cmd: Command) =>
    output(
      await client.getSubject({ year: cmd.opts().year, numbering }),
      formatSubject,
      cmd,
    ),
  );
program
  .command('compare <numberings...>')
  .description('2〜5科目を比較')
  .requiredOption('--year <year>', '開講年度')
  .action(async (numberings: string[], _options: unknown, cmd: Command) => {
    const result = await client.compare({ year: cmd.opts().year, numberings });
    output(result, formatCompare, cmd);
    if (result.results.some((r) => r.error)) process.exitCode = 1;
  });
program
  .command('prerequisites <numbering>')
  .description('前提・後継科目を確認')
  .requiredOption('--year <year>', '開講年度')
  .action(async (numbering: string, _options: unknown, cmd: Command) =>
    output(
      await client.getRelations({ year: cmd.opts().year, numbering }),
      formatRelations,
      cmd,
    ),
  );
program
  .command('filters [kind]')
  .description('検索条件の候補を表示（全ページを取得）')
  .action(async (kind: string | undefined, _options: unknown, cmd: Command) =>
    output(
      await client.listFilters(filterInputSchema.parse({ kind })),
      formatFilters,
      cmd,
    ),
  );
try {
  await program.parseAsync();
} catch (e) {
  if (e instanceof CommanderError && e.exitCode === 0) process.exitCode = 0;
  else {
    const error =
      e instanceof CommanderError
        ? { code: 'INVALID_INPUT', message: e.message }
        : errorResult(e);
    process.stderr.write(
      (process.argv.includes('--json')
        ? JSON.stringify({ error }, null, 2)
        : `${error.code}: ${error.message}${'details' in error && error.details ? '\n' + JSON.stringify(error.details, null, 2) : ''}`) +
        '\n',
    );
    process.exitCode = error.code === 'INVALID_INPUT' ? 2 : 1;
  }
}
