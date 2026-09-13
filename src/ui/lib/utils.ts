/**
 * Re-exports `cn` at the path shadcn's registry expects.
 *
 * Our own components import `cn` from the npm `cn` package (shadcn's compiled
 * clsx + tailwind-merge). Components pulled from the registry -- and from
 * third-party registries like neobrutalism -- are generated against the
 * conventional `@/ui/lib/utils` alias declared in components.json instead.
 *
 * Without this file those imports resolve to nothing, so a `shadcn add` of any
 * external component lands broken. One re-export makes both conventions work
 * and keeps a single implementation behind them.
 */
export { cn } from "cn";
