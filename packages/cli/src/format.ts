import type { SyllabusClient, Subject } from '@zen-syllabus/core';

const clean = (s: unknown) =>
  String(s ?? '未掲載').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
const list = (xs: { name: string }[]) =>
  xs.map((x) => clean(x.name)).join('、') || '未掲載';
const width = (s: string) =>
  [...s].reduce((n, c) => n + (/[^\u0000-\u00ff]/.test(c) ? 2 : 1), 0);
function table(rows: string[][]) {
  const widths = rows[0]!.map((_, i) =>
    Math.max(...rows.map((r) => width(r[i] ?? ''))),
  );
  return rows
    .map((r) =>
      r
        .map((c, i) => c + ' '.repeat(widths[i]! - width(c)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}
export function formatSearch(
  data: Awaited<ReturnType<SyllabusClient['search']>>,
) {
  const rows = [
    ['年度', '科目番号', '科目名', '単位', '開講Q', '教員'],
    ...data.subjects.map((s) => [
      String(s.year),
      s.numbering,
      clean(s.name),
      clean(s.credit),
      s.quarters.join('、'),
      list(s.faculty),
    ]),
  ];
  return `${table(rows)}\n\n全${data.totalCount}件  ${data.page}/${Math.max(1, data.totalPages)}ページ\n取得日時 ${data.fetchedAt}`;
}
export function formatSubject(s: Subject) {
  const m = s.metadata;
  const rows: [string, unknown][] = [
    ['科目番号', s.numbering],
    ['教員', list(s.faculty)],
    ['タグ', list(s.tags)],
    ['履修想定年次', m.enrollmentGrade],
    ['単位', m.credit],
    ['開講Q', m.quarters?.join('、')],
    ['科目属性', m.subjectRequirement],
    ['授業方法', m.teachingMethod],
    ['科目の概要', s.description],
    ['到達目標', m.objective],
    ['評価方法', m.evaluationSystem],
    ['前提科目（推奨）', list(m.recommendedPrerequisiteSubjects ?? [])],
    [
      '前提科目（強く推奨）',
      list(m.stronglyRecommendedPrerequisiteSubjects ?? []),
    ],
    ['後継科目（推奨）', list(m.recommendedNextSubjects ?? [])],
    ['教科書', m.textBooks?.map((b) => b.title).join('\n')],
    ['参考書', m.referenceBooks?.map((b) => b.title).join('\n')],
    ['授業時間外の学修', m.learningOutsideClass],
    ['特記事項', m.specialNotes],
  ];
  return `${clean(s.name)}（${s.openingYear}年度）\n\n${rows.map(([label, value]) => `${label}\n${clean(value)}\n`).join('\n')}\n授業計画\n${s.coursePlans.map((p, i) => `第${i + 1}回  ${clean(p.title)}\n${clean(p.description)}`).join('\n\n')}\n\n関連科目\n${list(s.relatedSubjects)}\n\n${s.sourceUrl}\n取得日時 ${s.fetchedAt}`;
}
export function formatCompare(
  data: Awaited<ReturnType<SyllabusClient['compare']>>,
) {
  const subjects = data.results.filter((r) => r.subject).map((r) => r.subject!);
  const fields: [string, (s: (typeof subjects)[number]) => string][] = [
    ['科目名', (s) => clean(s.name)],
    ['科目番号', (s) => s.numbering],
    ['単位', (s) => clean(s.credit)],
    ['開講Q', (s) => s.quarters.join('、')],
    ['想定年次', (s) => clean(s.grade)],
    ['教員', (s) => list(s.faculty)],
    ['授業方法', (s) => clean(s.method)],
    ['評価方法', (s) => clean(s.evaluation)],
    ['前提（推奨）', (s) => list(s.relations.recommended)],
    ['前提（強く推奨）', (s) => list(s.relations.stronglyRecommended)],
    ['公式ページ', (s) => s.sourceUrl],
    ['取得日時', (s) => s.fetchedAt],
  ];
  const errors = data.results
    .filter((r) => r.error)
    .map((r) => `${r.numbering}  ${r.error!.message}`)
    .join('\n');
  return `${data.year}年度\n\n${subjects.length ? table(fields.map(([label, fn]) => [label, ...subjects.map(fn)])) : ''}${errors ? `\n\n取得エラー\n${errors}` : ''}`;
}
export function formatRelations(
  data: Awaited<ReturnType<SyllabusClient['getRelations']>>,
) {
  return `${clean(data.name)}（${data.year}年度）\n\n${(['recommended', 'stronglyRecommended', 'next'] as const).map((key, i) => `${['前提科目（推奨）', '前提科目（強く推奨）', '後継科目（推奨）'][i]}\n${data[key].map((r) => `${clean(r.name)}${r.kind === 'subject' ? `  ${r.numbering}\n${r.sourceUrl}` : '（参照情報）'}`).join('\n') || '未掲載'}`).join('\n\n')}\n\n${data.sourceUrl}\n取得日時 ${data.fetchedAt}`;
}
export function formatFilters(
  data: Awaited<ReturnType<SyllabusClient['listFilters']>>,
) {
  return `${Object.entries(data.options)
    .map(
      ([key, values]) =>
        `${key}\n${table([['値', '名前'], ...values.map((v) => [v.value, clean(v.label)])])}`,
    )
    .join('\n\n')}\n\n${data.sourceUrl}\n取得日時 ${data.fetchedAt}`;
}
