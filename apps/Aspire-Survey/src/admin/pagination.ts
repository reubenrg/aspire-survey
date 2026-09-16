/** Pure paging arithmetic for Response Centre, factored out for testing. */

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function hasNextPage(page: number, pageSize: number, total: number): boolean {
  return (page + 1) * pageSize < total;
}

export function hasPreviousPage(page: number): boolean {
  return page > 0;
}
