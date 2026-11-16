const ALLOWED = /^(?:https?:\/\/|mailto:|\/(?![/\\]))/i

export const isSafeHref = (target: string): boolean => ALLOWED.test(target)
