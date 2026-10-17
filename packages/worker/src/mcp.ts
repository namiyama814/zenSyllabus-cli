import { McpServer } from '@modelcontextprotocol/server';
import {
  SyllabusClient,
  searchSchema,
  subjectInputSchema,
  compareSchema,
  filterInputSchema,
  errorResult,
} from '@zen-syllabus/core';

export function createServer(client = new SyllabusClient()) {
  const server = new McpServer({ name: 'zen-syllabus', version: '0.1.0' });
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
  const result = async (work: () => Promise<object>) => {
    try {
      const data = await work();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data) }],
        structuredContent: data,
      };
    } catch (e) {
      const data = { error: errorResult(e) };
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify(data) }],
        structuredContent: data,
      };
    }
  };
  server.registerTool(
    'search_subjects',
    {
      description:
        'ZEN大学の科目を検索。年度未指定は全年度。pageは1始まり。teacherは名前、teacherIdはID。検索結果は概要のみ。',
      inputSchema: searchSchema,
      annotations,
    },
    (input) => result(() => client.search(input)),
  );
  server.registerTool(
    'get_subject',
    {
      description:
        '年度と科目番号を指定し、授業計画・評価方法・教材などの全詳細を取得。',
      inputSchema: subjectInputSchema,
      annotations,
    },
    (input) => result(() => client.getSubject(input)),
  );
  server.registerTool(
    'compare_subjects',
    {
      description:
        '同一年度の2〜5科目を比較。取得できない科目は個別のエラーを返す。',
      inputSchema: compareSchema,
      annotations,
    },
    (input) => result(() => client.compare(input)),
  );
  server.registerTool(
    'get_subject_relations',
    {
      description:
        '推奨・強く推奨される前提科目と推奨後継科目を取得。kind=referenceは便覧等の参照情報であり前提科目の確定情報ではない。',
      inputSchema: subjectInputSchema,
      annotations,
    },
    (input) => result(() => client.getRelations(input)),
  );
  server.registerTool(
    'list_filter_options',
    {
      description:
        'APIの全ページから使用中の検索条件を取得。kindで種類を選択。patternの表示名はIDのみ。全ページ分の通信が発生する。',
      inputSchema: filterInputSchema,
      annotations,
    },
    (input) => result(() => client.listFilters(input)),
  );
  return server;
}
