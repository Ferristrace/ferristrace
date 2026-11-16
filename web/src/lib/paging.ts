export const pagesOf = (total: number, size: number) => Math.max(1, Math.ceil(total / size))

export const pageNumbers = (page: number, pages: number): (number | null)[] => {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const near = [page - 1, page, page + 1].filter((n) => n > 1 && n < pages)
  const out: (number | null)[] = [1]
  if (near[0] > 2) out.push(null)
  out.push(...near)
  if (near[near.length - 1] < pages - 1) out.push(null)
  out.push(pages)
  return out
}
