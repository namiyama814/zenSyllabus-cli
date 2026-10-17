import assert from 'node:assert/strict';
import { SyllabusClient } from '@zen-syllabus/core';
const client = new SyllabusClient();
const numbering = 'INF-1-C1-1030-002';
const result = await client.search({ query: 'プログラミング', year: 2026 });
assert(result.totalCount > 0);
assert.equal(result.page, 1);
const detail = await client.getSubject({ year: 2026, numbering });
assert.equal(detail.numbering, numbering);
assert.equal(detail.openingYear, '2026');
assert(detail.coursePlans.length > 0);
assert.equal(
  (await client.search({ query: '__no_such_zen_subject_902318__' })).totalCount,
  0,
);
assert.equal(
  (
    await client.search({ teacher: '折原 ダビデ竜', year: 2026 })
  ).subjects.every((s) => s.faculty.some((f) => f.id === 36)),
  true,
);
const comparison = await client.compare({
  year: 2026,
  numberings: [numbering, 'INF-1-C1-0204-003'],
});
assert(comparison.results.every((r) => r.subject));
const relations = await client.getRelations({ year: 2026, numbering });
assert(relations.recommended.length > 0);
const filters = await client.listFilters();
assert(filters.options.year.length > 0);
assert(filters.options.teacher.length > 0);
console.log(
  JSON.stringify(
    {
      status: 'ok',
      searchCount: result.totalCount,
      lessons: detail.coursePlans.length,
      years: filters.options.year,
      teachers: filters.options.teacher.length,
      source: detail.sourceUrl,
    },
    null,
    2,
  ),
);
