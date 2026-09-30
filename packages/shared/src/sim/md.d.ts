/** Vite `?raw` text imports (used by tests to read TUNING.md without Node typings). */
declare module "*.md?raw" {
  const text: string;
  export default text;
}
