export function parseFinancialPage(value?: string): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}

export async function loadFinancialPage<T extends { total: number; pageSize: number }>(
  requestedPage: number,
  load: (page: number) => Promise<T>,
  hasRows: (result: T) => boolean,
): Promise<{ result: T; page: number; pages: number }> {
  let first = await load(1);
  let pages = Math.max(1, Math.ceil(first.total / first.pageSize));
  let page = Math.min(requestedPage, pages);
  let result = page === 1 ? first : await load(page);
  if (page > 1 && !hasRows(result)) {
    first = await load(1);
    pages = Math.max(1, Math.ceil(first.total / first.pageSize));
    page = Math.min(requestedPage, pages);
    result = page === 1 ? first : await load(page);
  }
  return { result, page, pages };
}
