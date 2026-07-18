import chalk from "chalk";
import gradient from "gradient-string";
import boxen from "boxen";
import ora, { type Ora } from "ora";

// ── Brand Palette ──────────────────────────────────────────────
export const palette = {
  primary: chalk.cyan,
  accent: chalk.magenta,
  dim: chalk.dim,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  bold: chalk.bold,
  brandCyan: chalk.hex("#00D4FF"),
  brandMag: chalk.hex("#FF00FF"),
} as const;

// ── Gradient ───────────────────────────────────────────────────
export const brandGradient = gradient(["#00D4FF", "#FF00FF"]);

// ── ASCII Logo ─────────────────────────────────────────────────
const LOGO_RAW = `
  ███╗   ███╗ ██████╗██████╗ ██╗  ██╗
  ████╗ ████║██╔════╝██╔══██╗╚██╗██╔╝
  ██╔████╔██║██║     ██████╔╝ ╚███╔╝
  ██║╚██╔╝██║██║     ██╔═══╝  ██╔██╗
  ██║ ╚═╝ ██║╚██████╗██║     ██╔╝ ██╗
  ╚═╝     ╚═╝ ╚═════╝╚═╝     ╚═╝  ╚═╝
`.trimStart();

export function renderLogo(): string {
  return brandGradient.multiline(LOGO_RAW);
}

// ── Tagline ────────────────────────────────────────────────────
export function renderTagline(version: string): string {
  return palette.dim(`  The missing CLI for the MCP ecosystem  v${version}`);
}

// ── Brand Header (logo + tagline, for --help and startup) ─────
export function renderBrandHeader(version: string): string {
  return `${renderLogo()}\n${renderTagline(version)}\n`;
}

// ── Boxed Info Block (for inspect identity, errors, etc.) ─────
export function brandBox(content: string, title?: string): string {
  const options: Record<string, unknown> = {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
    borderStyle: "round",
    borderColor: "cyan",
    titleAlignment: "left",
  };
  
  if (title) {
    options["title"] = palette.bold(title);
  }
  
  return boxen(content, options);
}

// ── Section Header ─────────────────────────────────────────────
export function sectionHeader(text: string): string {
  return `\n${palette.bold(palette.primary(text))}`;
}

// ── Status Dots ────────────────────────────────────────────────
export const statusDot = {
  ok: palette.success("●"),
  warn: palette.warning("●"),
  error: palette.error("●"),
  unknown: palette.dim("●"),
} as const;

// ── Bullet ─────────────────────────────────────────────────────
export function bullet(text: string): string {
  return `  ${palette.primary("›")} ${text}`;
}

// ── Branded Spinner ────────────────────────────────────────────
export function brandSpinner(text: string): Ora {
  return ora({
    text,
    color: "cyan",
    spinner: "dots",
  });
}
