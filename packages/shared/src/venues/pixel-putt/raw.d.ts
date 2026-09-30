/** Vite `?raw` source imports: the determinism test scans this venue's sources without Node typings. */
declare module "*.ts?raw" {
  const text: string;
  export default text;
}
