import { envelope, subject, numbering } from './fixtures.mjs';
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (
    url.origin !== 'https://api.syllabus.zen.ac.jp' ||
    url.pathname !== '/search'
  )
    throw new Error('Unexpected network request');
  if (url.searchParams.get('freeword') === '__ERROR__')
    return new Response('', { status: 400 });
  const code = url.searchParams.get('subject_numbering');
  const year = url.searchParams.get('opening_year');
  if (
    (code && ![numbering, 'INF-1-C1-1030-002'].includes(code)) ||
    (year && year !== '2026')
  )
    return Response.json(envelope([]));
  return Response.json(envelope([subject({ numbering: code ?? numbering })]));
};
