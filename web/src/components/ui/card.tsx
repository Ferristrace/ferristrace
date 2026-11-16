import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const Card = ({ className, ...p }: ComponentProps<'div'>) => <div className={cn('rounded-md border bg-card text-card-foreground', className)} {...p} />
export const CardHeader = ({ className, ...p }: ComponentProps<'div'>) => <div className={cn('flex min-h-10 items-center gap-3 border-b px-3.5 py-2', className)} {...p} />
export const CardTitle = ({ className, ...p }: ComponentProps<'h2'>) => <h2 className={cn('text-[13px] font-semibold leading-5', className)} {...p} />
