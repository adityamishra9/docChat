declare module "react-syntax-highlighter" {
  export const Prism: any;
  export const Light: any;
  const Default: any;
  export default Default;
}

declare module "react-syntax-highlighter/*" {
  const anyExport: any;
  export default anyExport;
  export const oneDark: any;
}
