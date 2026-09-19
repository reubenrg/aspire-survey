/** Pure upload rules (no network, no React), so they can be tested directly. */

export type AcceptKind = 'any' | 'images' | 'documents';

export const ACCEPT: Record<AcceptKind, { label: string; mime: string[]; input: string }> = {
  any: {
    label: 'an image, PDF or document',
    mime: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    input: 'image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx',
  },
  images: { label: 'an image', mime: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], input: 'image/*' },
  documents: {
    label: 'a PDF or document',
    mime: ['application/pdf', 'text/plain', 'text/csv', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    input: '.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx',
  },
};

export const MAX_UPLOAD_MB = 10;

/** null when the file is acceptable, otherwise the sentence to show. Pure, so it can be tested. */
export function checkFile(file: { name: string; size: number; type: string }, opts: { maxSizeMb?: number; accept?: AcceptKind }): string | null {
  const limit = Math.min(MAX_UPLOAD_MB, Math.max(1, opts.maxSizeMb ?? 5));
  if (file.size === 0) return 'That file is empty.';
  if (file.size > limit * 1024 * 1024) return `That file is larger than ${limit} MB.`;
  const kind = ACCEPT[opts.accept ?? 'any'];
  if (!kind.mime.includes(file.type)) return `Please choose ${kind.label}.`;
  return null;
}

/** Storage-safe file name: no path separators, no exotic characters, bounded length. */
export function safeFileName(name: string): string {
  const cleaned = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-80);
  return cleaned || 'file';
}

/** The object path for an answer: `<survey slug>/<random id>/<file name>`. The slug prefix is what the bucket policy checks. */
export function uploadPath(slug: string, fileName: string, id: string = crypto.randomUUID()): string {
  return `${slug}/${id}/${safeFileName(fileName)}`;
}


/** The file name part of a stored path, for display. */
export function fileNameOf(path: string): string {
  return path.split('/').pop() ?? path;
}
