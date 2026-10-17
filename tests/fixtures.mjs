export const numbering = 'INF-1-C1-1030-001';
export function subject(overrides = {}) {
  return {
    numbering,
    name: 'テスト科目',
    openingYear: '2026',
    description: 'テスト用の科目概要',
    faculty: [{ id: 36, name: '試験 太郎' }],
    tags: [{ id: 202, name: 'Python' }],
    subjectCategoryIds: ['applied_informatics'],
    coursePatternIds: [26],
    dayOfWeek: ['monday'],
    metadata: {
      enrollmentGrade: '1年次',
      credit: '2単位',
      quarters: ['1Q', '3Q'],
      teachingMethod: 'オンデマンド科目',
      subjectRequirement: '選択',
      evaluationSystem: 'レポート100%',
      objective: 'テストの到達目標',
      textBooks: [{ title: 'テスト教科書' }],
      referenceBooks: [],
      learningOutsideClass: '予習',
      specialNotes: '注記',
      recommendedPrerequisiteSubjects: [
        {
          numbering: 'OPT-1-C1-1030-999',
          openingYear: '2026',
          name: '「学生便覧」カリキュラム・マップを参照',
        },
      ],
      stronglyRecommendedPrerequisiteSubjects: [],
      recommendedNextSubjects: [],
    },
    coursePlans: [
      { title: 'テスト授業', description: 'テスト授業内容', sections: [] },
    ],
    relatedSubjects: [],
    ...overrides,
  };
}
export function envelope(subjects = [subject()], overrides = {}) {
  return {
    totalCount: subjects.length,
    pageSize: 20,
    page: 0,
    totalPages: subjects.length ? 1 : 0,
    relatedTags: [{ id: 202, name: 'Python' }],
    subjects,
    ...overrides,
  };
}
