import { z } from 'zod';
import {
  categories,
  methods,
  quarters,
  requirements,
  days,
  searchSchema,
  subjectInputSchema,
  compareSchema,
  filterInputSchema,
  responseSchema,
  type SearchInput,
  type Subject,
  type FilterKind,
} from './schema.js';
export * from './schema.js';

export class SyllabusError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'SyllabusError';
  }
}
export function errorResult(e: unknown) {
  if (e instanceof SyllabusError)
    return {
      code: e.code,
      message: e.message,
      ...(e.details === undefined ? {} : { details: e.details }),
    };
  if (e instanceof z.ZodError)
    return {
      code: 'INVALID_INPUT',
      message: '入力が正しくありません',
      details: e.issues,
    };
  return { code: 'INTERNAL_ERROR', message: '処理中にエラーが発生しました' };
}
export function sourceUrl(year: string | number, numbering: string) {
  return `https://syllabus.zen.ac.jp/subjects/${year}/${encodeURIComponent(numbering)}`;
}
type Dependencies = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
};
const normalName = (s: string) =>
  s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const isReference = (name: string) => /学生便覧|順次公開予定/.test(name);
const relations = (s: Subject) => {
  const convert = (
    items: NonNullable<Subject['metadata']['recommendedPrerequisiteSubjects']>,
  ) =>
    items.map((r) => ({
      ...r,
      kind: isReference(r.name) ? ('reference' as const) : ('subject' as const),
      sourceUrl: isReference(r.name)
        ? null
        : sourceUrl(r.openingYear, r.numbering),
    }));
  return {
    recommended: convert(s.metadata.recommendedPrerequisiteSubjects ?? []),
    stronglyRecommended: convert(
      s.metadata.stronglyRecommendedPrerequisiteSubjects ?? [],
    ),
    next: convert(s.metadata.recommendedNextSubjects ?? []),
  };
};
export function summarize(s: Subject) {
  return {
    numbering: s.numbering,
    year: Number(s.openingYear),
    name: s.name,
    description: s.description,
    faculty: s.faculty,
    tags: s.tags,
    credit: s.metadata.credit ?? null,
    quarters: s.metadata.quarters ?? [],
    grade: s.metadata.enrollmentGrade ?? null,
    method: s.metadata.teachingMethod ?? null,
    requirement: s.metadata.subjectRequirement ?? null,
    sourceUrl: s.sourceUrl,
    fetchedAt: s.fetchedAt,
  };
}

export class SyllabusClient {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(deps: Dependencies = {}) {
    this.fetcher = deps.fetch ?? fetch;
    this.timeoutMs = deps.timeoutMs ?? 15000;
    this.retries = deps.retries ?? 2;
    this.sleep =
      deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }
  private async request(params: URLSearchParams) {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let delay = Math.min(500 * 2 ** attempt, 3000);
      try {
        const response = await this.fetcher(
          `https://api.syllabus.zen.ac.jp/search?${params}`,
          {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          },
        );
        if (!response.ok) {
          const retry =
            response.status === 429 ||
            [500, 502, 503, 504].includes(response.status);
          const retryAfter = response.headers.get('retry-after');
          if (retryAfter) {
            const seconds = Number(retryAfter);
            delay = Math.min(
              Math.max(
                0,
                Number.isFinite(seconds)
                  ? seconds * 1000
                  : Date.parse(retryAfter) - Date.now(),
              ),
              5000,
            );
          }
          await response.body?.cancel();
          if (!retry || attempt >= this.retries)
            throw new SyllabusError(
              'UPSTREAM_HTTP',
              `シラバスAPIがHTTP ${response.status}を返しました`,
              { status: response.status },
            );
        } else {
          if (
            !response.headers.get('content-type')?.includes('application/json')
          )
            throw new SyllabusError(
              'UPSTREAM_SCHEMA',
              'シラバスAPIがJSON以外の応答を返しました',
            );
          const reader = response.body?.getReader();
          if (!reader)
            throw new SyllabusError(
              'UPSTREAM_SCHEMA',
              'シラバスAPIの応答が空です',
            );
          const chunks: Uint8Array[] = [];
          let length = 0;
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              length += value.byteLength;
              if (length > 8 * 1024 * 1024) {
                await reader.cancel();
                throw new SyllabusError(
                  'UPSTREAM_SIZE',
                  'シラバスAPIの応答がサイズ上限を超えました',
                );
              }
              chunks.push(value);
            }
          } finally {
            reader.releaseLock();
          }
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const c of chunks) {
            bytes.set(c, offset);
            offset += c.length;
          }
          let json: unknown;
          try {
            json = JSON.parse(new TextDecoder().decode(bytes));
          } catch {
            throw new SyllabusError(
              'UPSTREAM_SCHEMA',
              'シラバスAPIのJSONを解析できません',
            );
          }
          const parsed = responseSchema.safeParse(json);
          if (!parsed.success)
            throw new SyllabusError(
              'UPSTREAM_SCHEMA',
              'シラバスAPIのデータ形式が変更されています',
              parsed.error.issues.map((i) => ({
                path: i.path,
                message: i.message,
              })),
            );
          const fetchedAt = new Date().toISOString();
          return {
            ...parsed.data,
            page: parsed.data.page + 1,
            fetchedAt,
            subjects: parsed.data.subjects.map((s) => ({
              ...s,
              sourceUrl: sourceUrl(s.openingYear, s.numbering),
              fetchedAt,
            })),
          };
        }
      } catch (e) {
        if (e instanceof SyllabusError) throw e;
        if (attempt >= this.retries)
          throw new SyllabusError(
            controller.signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK',
            controller.signal.aborted
              ? 'シラバスAPIの応答がタイムアウトしました'
              : 'シラバスAPIに接続できません',
          );
      } finally {
        clearTimeout(timer);
      }
      await this.sleep(Number.isFinite(delay) ? delay : 500);
    }
  }
  private async rawSearch(input: z.output<typeof searchSchema>) {
    const params = new URLSearchParams();
    const mapping = {
      query: 'freeword',
      year: 'opening_year',
      grade: 'enrollment_grade',
      category: 'subject_category_id',
      tagId: 'tag_id',
      teacherId: 'faculty_member_id',
      quarter: 'quarter',
      method: 'teaching_method',
      credit: 'credit',
      requirement: 'subject_requirement',
      patternId: 'course_pattern_id',
      day: 'day_of_week',
      page: 'page',
      sort: 'sort',
    } as const;
    for (const [key, param] of Object.entries(mapping)) {
      const value = input[key as keyof typeof mapping];
      if (value !== undefined && value !== '') params.set(param, String(value));
    }
    return this.request(params);
  }
  private async resolveTeacher(name: string) {
    const faculty = new Map<number, { id: number; name: string }>();
    let page = 1;
    for (;;) {
      const data = await this.rawSearch(
        searchSchema.parse({ query: name, page }),
      );
      for (const s of data.subjects)
        for (const f of s.faculty)
          if (normalName(f.name).includes(normalName(name)))
            faculty.set(f.id, { id: f.id, name: f.name });
      if (page >= data.totalPages) break;
      if (++page > 1000)
        throw new SyllabusError(
          'UPSTREAM_PAGINATION',
          '教員候補の取得ページ数が上限を超えました',
        );
    }
    const matches = [...faculty.values()];
    const exact = matches.filter(
      (f) => normalName(f.name) === normalName(name),
    );
    const candidates = exact.length ? exact : matches;
    if (candidates.length !== 1)
      throw new SyllabusError(
        candidates.length ? 'AMBIGUOUS_TEACHER' : 'TEACHER_NOT_FOUND',
        candidates.length
          ? '教員候補が複数あります。teacherIdを指定してください'
          : '教員が見つかりません',
        candidates,
      );
    return candidates[0]!.id;
  }
  async search(input: SearchInput = {}) {
    const parsed = searchSchema.parse(input);
    if (parsed.teacher)
      parsed.teacherId = await this.resolveTeacher(parsed.teacher);
    const data = await this.rawSearch(parsed);
    return { ...data, subjects: data.subjects.map(summarize) };
  }
  async getSubject(
    input: z.input<typeof subjectInputSchema>,
  ): Promise<Subject> {
    const { year, numbering } = subjectInputSchema.parse(input);
    const data = await this.request(
      new URLSearchParams({
        opening_year: String(year),
        subject_numbering: numbering,
      }),
    );
    const matches = data.subjects.filter(
      (s) => Number(s.openingYear) === year && s.numbering === numbering,
    );
    if (matches.length !== 1)
      throw new SyllabusError(
        'SUBJECT_NOT_FOUND',
        '指定した年度・科目番号の科目が見つかりません',
        { year, numbering },
      );
    return matches[0]!;
  }
  async compare(input: z.input<typeof compareSchema>) {
    const { year, numberings } = compareSchema.parse(input);
    const results = await Promise.all(
      numberings.map(async (numbering) => {
        try {
          const s = await this.getSubject({ year, numbering });
          return {
            numbering,
            subject: {
              ...summarize(s),
              evaluation: s.metadata.evaluationSystem ?? null,
              relations: relations(s),
            },
          };
        } catch (e) {
          return { numbering, error: errorResult(e) };
        }
      }),
    );
    return { year, results };
  }
  async getRelations(input: z.input<typeof subjectInputSchema>) {
    const s = await this.getSubject(input);
    return {
      numbering: s.numbering,
      year: Number(s.openingYear),
      name: s.name,
      ...relations(s),
      sourceUrl: s.sourceUrl,
      fetchedAt: s.fetchedAt,
    };
  }
  async listFilters(input: z.input<typeof filterInputSchema> = {}) {
    const { kind } = filterInputSchema.parse(input);
    const all: Record<FilterKind, Map<string, string>> = Object.fromEntries(
      [
        'year',
        'grade',
        'category',
        'tag',
        'teacher',
        'quarter',
        'method',
        'credit',
        'requirement',
        'pattern',
        'day',
      ].map((k) => [k, new Map()]),
    ) as Record<FilterKind, Map<string, string>>;
    const add = (key: FilterKind, value: string | number, label: string) =>
      all[key].set(String(value), label);
    const addMapped = (
      key: FilterKind,
      value: string | null | undefined,
      labels: Record<string, string>,
    ) => {
      if (!value) return;
      const entry = Object.entries(labels).find(
        ([id, label]) => value === id || value === label,
      );
      if (entry) add(key, entry[0], entry[1]);
    };
    let page = 1;
    let fetchedAt = '';
    for (;;) {
      const data = await this.rawSearch(searchSchema.parse({ page }));
      fetchedAt = data.fetchedAt;
      for (const t of data.relatedTags) add('tag', t.id, t.name);
      for (const s of data.subjects) {
        add('year', s.openingYear, `${s.openingYear}年度`);
        for (const f of s.faculty)
          if (!isReference(f.name)) add('teacher', f.id, f.name);
        for (const t of s.tags) add('tag', t.id, t.name);
        for (const c of s.subjectCategoryIds)
          addMapped('category', c, categories);
        for (const p of s.coursePatternIds)
          add('pattern', p, `履修パターン ${p}`);
        const m = s.metadata;
        const grade = m.enrollmentGrade?.match(/[1-4]/)?.[0];
        if (grade) add('grade', grade, m.enrollmentGrade!);
        const credit = m.credit?.match(/\d+/)?.[0];
        if (credit) add('credit', credit, m.credit!);
        for (const q of m.quarters ?? []) addMapped('quarter', q, quarters);
        addMapped('method', m.teachingMethod, methods);
        addMapped('requirement', m.subjectRequirement, requirements);
        for (const d of Array.isArray(s.dayOfWeek)
          ? s.dayOfWeek
          : s.dayOfWeek
            ? [s.dayOfWeek]
            : [])
          addMapped('day', d, days);
      }
      if (page >= data.totalPages) break;
      if (++page > 1000)
        throw new SyllabusError(
          'UPSTREAM_PAGINATION',
          '検索条件の取得ページ数が上限を超えました',
        );
    }
    const options = Object.fromEntries(
      Object.entries(all)
        .filter(([k]) => !kind || kind === k)
        .map(([k, values]) => [
          k,
          [...values]
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) =>
              a.value.localeCompare(b.value, 'ja', { numeric: true }),
            ),
        ]),
    );
    return { options, fetchedAt, sourceUrl: 'https://syllabus.zen.ac.jp/' };
  }
}
