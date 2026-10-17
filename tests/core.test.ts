import { describe, it, expect, vi } from 'vitest';
import { SyllabusClient, searchSchema, errorResult } from '@zen-syllabus/core';
import { envelope, subject, numbering } from './fixtures.mjs';

const mock = (data = envelope()) => vi.fn(async () => Response.json(data));
const make = (fetcher: typeof fetch, extra = {}) =>
  new SyllabusClient({ fetch: fetcher, sleep: async () => {}, ...extra });
describe('API client', () => {
  it('encodes Japanese and every filter using the upstream values', async () => {
    const fetcher = mock();
    const client = make(fetcher);
    const result = await client.search({
      query: 'プログラミング',
      year: 2026,
      grade: 1,
      category: 'applied_informatics',
      tagId: 202,
      teacherId: 36,
      quarter: '1Q',
      method: 'on-demand',
      credit: 2,
      requirement: 'elective',
      patternId: 26,
      day: 'monday',
      page: 2,
      sort: 'subject-desc',
    });
    const url = new URL(fetcher.mock.calls[0]![0]);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      freeword: 'プログラミング',
      opening_year: '2026',
      enrollment_grade: '1',
      subject_category_id: 'applied_informatics',
      tag_id: '202',
      faculty_member_id: '36',
      quarter: '1q',
      teaching_method: 'on-demand',
      credit: '2',
      subject_requirement: 'elective',
      course_pattern_id: '26',
      day_of_week: 'monday',
      page: '2',
      sort: 'subject-desc',
    });
    expect(result.page).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.subjects[0]).not.toHaveProperty('coursePlans');
    expect(result.subjects[0].sourceUrl).toContain(`/2026/${numbering}`);
    expect(result.fetchedAt).toMatch(/^\d{4}-/);
  });
  it.each([
    { quarter: '1' },
    { credit: 3 },
    { method: 'video' },
    { page: 0 },
    { teacher: '試験', teacherId: 36 },
    { category: 'unknown' },
    { invalid: true },
  ])('rejects invalid filters %j before network access', async (input) => {
    const fetcher = mock();
    await expect(make(fetcher).search(input)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('converts response page 1 to public page 2 and does not fetch all pages', async () => {
    const fetcher = mock(
      envelope([subject()], { page: 1, totalPages: 4, totalCount: 65 }),
    );
    expect((await make(fetcher).search({ page: 2 })).page).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('returns no subjects for zero results', async () =>
    expect((await make(mock(envelope([]))).search()).subjects).toEqual([]));
  it('requires exact identity, not just a matching search hit', async () => {
    const client = make(
      mock(
        envelope([
          subject({ openingYear: '2027' }),
          subject({ numbering: 'INF-1-C1-1030-002' }),
        ]),
      ),
    );
    await expect(
      client.getSubject({ year: 2026, numbering }),
    ).rejects.toMatchObject({ code: 'SUBJECT_NOT_FOUND' });
  });
  it('preserves detailed data and tolerates missing optional fields', async () => {
    const client = make(
      mock(
        envelope([
          {
            name: '経済科目',
            numbering: 'ECON-1-C1-1030-001',
            openingYear: '2026',
          },
        ]),
      ),
    );
    const s = await client.getSubject({
      year: 2026,
      numbering: 'econ-1-c1-1030-001',
    });
    expect(s.coursePlans).toEqual([]);
    expect(s.metadata).toEqual({});
    expect(
      (await make(mock()).getSubject({ year: 2026, numbering })).coursePlans,
    ).toHaveLength(1);
  });
  it('never treats handbook placeholders as actual prerequisites', async () => {
    const result = await make(mock()).getRelations({ year: 2026, numbering });
    expect(result.recommended[0]).toMatchObject({
      kind: 'reference',
      sourceUrl: null,
    });
    expect(result.stronglyRecommended).toEqual([]);
  });
  it('preserves comparison order and returns individual failures', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const n = new URL(url).searchParams.get('subject_numbering');
      if (n!.endsWith('003')) return Response.json(envelope([]));
      if (n!.endsWith('002')) await new Promise((r) => setTimeout(r, 5));
      return Response.json(envelope([subject({ numbering: n })]));
    });
    const result = await make(fetcher).compare({
      year: 2026,
      numberings: ['INF-1-C1-1030-002', numbering, 'INF-1-C1-1030-003'],
    });
    expect(result.results.map((r) => r.numbering)).toEqual([
      'INF-1-C1-1030-002',
      numbering,
      'INF-1-C1-1030-003',
    ]);
    expect(result.results[2].error?.code).toBe('SUBJECT_NOT_FOUND');
    await expect(
      make(fetcher).compare({ year: 2026, numberings: [numbering, numbering] }),
    ).rejects.toThrow();
    await expect(
      make(fetcher).compare({ year: 2026, numberings: [numbering] }),
    ).rejects.toThrow();
  });
  it('resolves teacher names and searches by ID', async () => {
    const fetcher = mock();
    await make(fetcher).search({ teacher: '試験 太郎', query: '数学' });
    const params = new URL(fetcher.mock.calls[1]![0]).searchParams;
    expect(params.get('faculty_member_id')).toBe('36');
    expect(params.get('freeword')).toBe('数学');
  });
  it('reports ambiguous and unknown teachers', async () => {
    const fetcher = mock(
      envelope([
        subject({
          faculty: [
            { id: 1, name: '試験 太郎' },
            { id: 2, name: '試験 花子' },
          ],
        }),
      ]),
    );
    await expect(
      make(fetcher).search({ teacher: '試験' }),
    ).rejects.toMatchObject({
      code: 'AMBIGUOUS_TEACHER',
      details: [
        { id: 1, name: '試験 太郎' },
        { id: 2, name: '試験 花子' },
      ],
    });
    await expect(
      make(fetcher).search({ teacher: '不明' }),
    ).rejects.toMatchObject({ code: 'TEACHER_NOT_FOUND' });
  });
  it('enumerates option pages, deduplicates, and returns used values', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'));
      return Response.json(
        envelope([subject({ openingYear: String(2025 + page) })], {
          page: page - 1,
          totalPages: 2,
          totalCount: 21,
        }),
      );
    });
    const data = await make(fetcher).listFilters();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(data.options.year).toEqual([
      { value: '2026', label: '2026年度' },
      { value: '2027', label: '2027年度' },
    ]);
    expect(data.options.teacher).toEqual([{ value: '36', label: '試験 太郎' }]);
    expect(data.options.category).toContainEqual({
      value: 'applied_informatics',
      label: '情報',
    });
    expect(data.options.quarter).toContainEqual({ value: '1q', label: '1Q' });
    expect(data.options.day).toContainEqual({ value: 'monday', label: '月' });
  });
  it.each([429, 500, 502, 503, 504])(
    'retries HTTP %s with a bounded retry-after',
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('', { status, headers: { 'Retry-After': '999' } }),
        )
        .mockResolvedValueOnce(Response.json(envelope()));
      const sleep = vi.fn(async () => {});
      await new SyllabusClient({ fetch: fetcher, sleep }).search();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(5000);
    },
  );
  it('limits retries and does not retry permanent errors', async () => {
    const failed = vi.fn(async () => new Response('', { status: 503 }));
    await expect(make(failed).search()).rejects.toMatchObject({
      code: 'UPSTREAM_HTTP',
    });
    expect(failed).toHaveBeenCalledTimes(3);
    const permanent = vi.fn(async () => new Response('', { status: 404 }));
    await expect(make(permanent).search()).rejects.toMatchObject({
      code: 'UPSTREAM_HTTP',
    });
    expect(permanent).toHaveBeenCalledTimes(1);
  });
  it('times out hung requests', async () => {
    const fetcher = vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        ),
    );
    await expect(
      make(fetcher as typeof fetch, { timeoutMs: 5, retries: 0 }).search(),
    ).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
  });
  it('reports network failures', async () => {
    await expect(
      make(
        vi.fn(async () => {
          throw new Error('secret network info');
        }),
        { retries: 0 },
      ).search(),
    ).rejects.toMatchObject({ code: 'UPSTREAM_NETWORK' });
  });
  it.each([
    () => Response.json({ subjects: [] }),
    () => new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }),
    () =>
      new Response('{bad', { headers: { 'Content-Type': 'application/json' } }),
  ])(
    'rejects malformed upstream data without an HTML fallback',
    async (response) => {
      const fetcher = vi.fn(async () => response());
      await expect(make(fetcher).search()).rejects.toMatchObject({
        code: 'UPSTREAM_SCHEMA',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects oversized responses', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(' '.repeat(8 * 1024 * 1024 + 1), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(make(fetcher).search()).rejects.toMatchObject({
      code: 'UPSTREAM_SIZE',
    });
  });
  it('normalizes validation errors and does not leak internal errors', () => {
    const parsed = searchSchema.safeParse({ page: 0 });
    expect(errorResult(parsed.error).code).toBe('INVALID_INPUT');
    expect(errorResult(new Error('secret'))).toEqual({
      code: 'INTERNAL_ERROR',
      message: '処理中にエラーが発生しました',
    });
  });
});
