type ScheduleLike = { id: string; team: string; name: string }
type NowLike = { account: { id: string; email: string | null; name: string | null } | null } | undefined

export type Duty = { schedule: string; who: string }

export function dutiesOf(team: string, schedules: readonly ScheduleLike[], now: Readonly<Record<string, NowLike>>): Duty[] {
  return schedules
    .filter((schedule) => schedule.team === team)
    .flatMap((schedule) => {
      const account = now[schedule.id]?.account
      return account ? [{ schedule: schedule.name, who: account.name ?? account.email ?? account.id }] : []
    })
}

export const dutyText = (duties: readonly Duty[]) => duties.map((duty) => `${duty.who} ${duty.schedule}`).join(' ')
