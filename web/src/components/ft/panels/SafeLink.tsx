import { useRouter } from '@tanstack/react-router'
import type { ComponentProps } from 'react'
import { Link } from '@/lib/router'

export function SafeLink({ to, search, ...props }: Omit<ComponentProps<'a'>, 'href'> & { to: string; search?: Record<string, string> }) {
  const router = useRouter({ warn: false })
  if (router) return <Link to={to} search={search} {...props} />
  const query = search ? `?${new URLSearchParams(search).toString()}` : ''
  return <a href={`${to}${query}`} {...props} />
}
