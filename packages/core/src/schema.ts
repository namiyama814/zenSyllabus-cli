import { z } from 'zod';

export const categories = {
  basic: '導入',
  applied_informatics: '情報',
  mathematical_sciences: '数理',
  multilingual_information_understanding: '多言語情報理解',
  culture_and_thoughts: '文化・思想',
  society_and_networks: '社会・ネットワーク',
  economy_and_markets: '経済・マーケット',
  digital_industry: 'デジタル産業',
  social_connection: '社会接続',
  graduation_project: '卒業プロジェクト',
  free: '自由科目',
} as const;
export const methods = {
  'on-demand': 'オンデマンド科目',
  'live-video': 'ライブ映像科目',
  exercise: '演習科目',
  seminar: 'ゼミ',
} as const;
export const quarters = {
  '1q': '1Q',
  '2q': '2Q',
  '3q': '3Q',
  '4q': '4Q',
  '1-2q': '1-2Q',
  '3-4q': '3-4Q',
  annual: '通期',
} as const;
export const requirements = {
  required: '必修',
  'required-elective': '選択必修',
  elective: '選択',
  free: '自由',
} as const;
export const days = {
  monday: '月',
  tuesday: '火',
  wednesday: '水',
  thursday: '木',
  friday: '金',
  intensive: '集中講義',
} as const;
const keys = <T extends Record<string, string>>(v: T) =>
  Object.keys(v) as [keyof T & string, ...(keyof T & string)[]];
export const yearSchema = z.coerce.number().int().min(2000).max(2100);
export const numberingSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z]{3,4}-\d-[A-Z]\d-\d{4}-\d{3}$/,
    '科目ナンバリングを指定してください',
  );
const id = z.coerce.number().int().positive();
export const searchSchema = z
  .strictObject({
    query: z.string().trim().max(300).optional(),
    year: yearSchema.optional(),
    grade: z.coerce.number().int().min(1).max(4).optional(),
    category: z.enum(keys(categories)).optional(),
    tagId: id.optional(),
    teacherId: id.optional(),
    teacher: z.string().trim().min(1).max(100).optional(),
    quarter: z
      .string()
      .toLowerCase()
      .pipe(z.enum(keys(quarters)))
      .optional(),
    method: z.enum(keys(methods)).optional(),
    credit: z.coerce
      .number()
      .pipe(z.union([z.literal(1), z.literal(2), z.literal(4)]))
      .optional(),
    requirement: z.enum(keys(requirements)).optional(),
    patternId: id.optional(),
    day: z.enum(keys(days)).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    sort: z.enum(['subject-asc', 'subject-desc']).default('subject-asc'),
  })
  .refine((v) => !(v.teacher && v.teacherId), {
    message: 'teacherとteacherIdは同時に指定できません',
  });
export const subjectInputSchema = z.strictObject({
  year: yearSchema,
  numbering: numberingSchema,
});
export const compareSchema = z
  .strictObject({
    year: yearSchema,
    numberings: z.array(numberingSchema).min(2).max(5),
  })
  .refine((v) => new Set(v.numberings).size === v.numberings.length, {
    message: '比較対象に同じ科目を重複指定できません',
  });
export const filterKindSchema = z.enum([
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
]);
export const filterInputSchema = z.strictObject({
  kind: filterKindSchema.optional(),
});

const facultySchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    reading: z.string().optional(),
  })
  .passthrough();
const tagSchema = z
  .object({ id: z.number().int(), name: z.string() })
  .passthrough();
const referenceSchema = z
  .object({ numbering: z.string(), name: z.string(), openingYear: z.string() })
  .passthrough();
const bookSchema = z.object({ title: z.string() }).passthrough();
export const upstreamSubjectSchema = z
  .object({
    numbering: numberingSchema,
    name: z.string(),
    openingYear: z.string().regex(/^\d{4}$/),
    description: z.string().default(''),
    faculty: z.array(facultySchema).default([]),
    tags: z.array(tagSchema).default([]),
    metadata: z
      .object({
        enrollmentGrade: z.string().nullish(),
        teachingMethod: z.string().nullish(),
        credit: z.string().nullish(),
        quarters: z.array(z.string()).nullish(),
        subjectRequirement: z.string().nullish(),
        evaluationSystem: z.string().nullish(),
        objective: z.string().nullish(),
        specialNotes: z.string().nullish(),
        learningOutsideClass: z.string().nullish(),
        textBooks: z.array(bookSchema).nullish(),
        referenceBooks: z.array(bookSchema).nullish(),
        recommendedPrerequisiteSubjects: z.array(referenceSchema).nullish(),
        stronglyRecommendedPrerequisiteSubjects: z
          .array(referenceSchema)
          .nullish(),
        recommendedNextSubjects: z.array(referenceSchema).nullish(),
      })
      .passthrough()
      .default({}),
    coursePlans: z
      .array(
        z
          .object({ title: z.string(), description: z.string().default('') })
          .passthrough(),
      )
      .default([]),
    relatedSubjects: z.array(referenceSchema).default([]),
    subjectCategoryIds: z.array(z.string()).default([]),
    coursePatternIds: z.array(z.union([z.string(), z.number()])).default([]),
    dayOfWeek: z.union([z.string(), z.array(z.string())]).nullish(),
  })
  .passthrough();
export const responseSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  page: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  relatedTags: z.array(tagSchema),
  subjects: z.array(upstreamSubjectSchema),
});
export type SearchInput = z.input<typeof searchSchema>;
export type Subject = z.infer<typeof upstreamSubjectSchema> & {
  sourceUrl: string;
  fetchedAt: string;
};
export type FilterKind = z.infer<typeof filterKindSchema>;
