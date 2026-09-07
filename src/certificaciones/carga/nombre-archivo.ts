/** 'K11' desde "… - K11 - Capex.pdf" o "(K8)"; null si el nombre no trae K. */
export function extraerKDeNombre(nombreArchivo: string): string | null {
  const m = nombreArchivo.toUpperCase().match(/(?:^|[^A-Z0-9])K\s?(\d{1,3})(?![0-9])/);
  return m ? `K${m[1]}` : null;
}
