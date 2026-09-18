declare module '@nimiq/identicons/dist/identicons.bundle.min.js' {
  interface IdenticonsApi {
    svg(text: string): Promise<string>
    toDataUrl(text: string): Promise<string>
    render(text: string, element: Element): Promise<void>
  }

  const Identicons: IdenticonsApi
  export default Identicons
}

