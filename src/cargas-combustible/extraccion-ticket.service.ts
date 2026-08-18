import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { consensuar, verificarAritmetica } from './extraccion-consenso';

export const ANTHROPIC_CLIENT = 'ANTHROPIC_CLIENT';

/** Campos que exigen coincidencia entre las dos lecturas para ser aceptados. */
const CAMPOS_CONSENSO = [
  'nroComprobante', 'litros', 'precioLitro', 'monto', 'fecha', 'kilometraje',
  'estacionId', 'movilId', 'tipoCombustibleId', 'cuitEstacion', 'patente',
] as const;

const PROMPT = `Sos un extractor de datos de comprobantes de carga de combustible de estaciones de servicio argentinas (YPF, Shell, Axion, Puma, Gulf, blancas). Recibís UNA foto y devolvés SOLO un objeto JSON, sin markdown, sin comentarios, sin texto antes ni después.

## PASO 1 — Clasificá el comprobante
Determiná "tipoComprobante" con uno de estos valores:
- "REMITO": el comprobante dice REMITO, REM., VALE, ORDEN DE CARGA, CUENTA CORRIENTE o CTA CTE. Es una carga a cuenta corriente de la empresa, NO tiene CAE.
- "FACTURA_A", "FACTURA_B", "FACTURA_C": comprobante fiscal, dice FACTURA seguido de una letra grande en un recuadro, o TIQUE FACTURA A/B/C.
- "TIQUE": tique no fiscal, comprobante X, o ticket de surtidor sin letra fiscal.
- "OTRO": cualquier otra cosa.
Si en la MISMA imagen conviven un remito y una factura, priorizá el REMITO.

## PASO 2 — Extraé el número de comprobante
Buscá en este orden y usá la PRIMERA coincidencia:

A) Si es REMITO: buscá etiquetas REMITO, REMITO Nº, REM., Nº REMITO, VALE Nº.
   Ejemplo: "REMITO : R 0021 - 00059874" → devolvé "R 0021-00059874".
   Conservá la letra (R, X), los ceros a la izquierda y el guion. Eliminá solo los espacios sobrantes alrededor del guion.

B) Si es FACTURA o TIQUE FACTURA: el número SIEMPRE tiene el formato punto de venta (4 dígitos) + número (8 dígitos).
   Etiquetas posibles, todas válidas: "COMP. NRO", "COMP. Nº", "Nro. Comprobante", "FACTURA Nº", "FC A Nº", "TIQUE FACTURA B", "Nº", "N°", "PTO VTA / NRO".
   Formas en que puede aparecer impreso:
     "0003-00012345"      → "0003-00012345"
     "0003 00012345"      → "0003-00012345"
     "00030 0012345"      → normalizá a 4+8
     "P.V. 0003  Nº 12345" → "0003-00012345"  (rellená con ceros hasta 8 dígitos)
     "FACTURA B 3-12345"  → "0003-00012345"
   Si el punto de venta aparece en el encabezado y el número correlativo abajo (típico en controlador fiscal), combinálos.
   Si encontrás el número pero NO el punto de venta, poné puntoVenta en null y nroComprobante con el número tal cual figura.

## NUNCA uses como número de comprobante
- CAE / C.A.E. / CAI / COD. AUTORIZACION: siempre 14 dígitos corridos, casi siempre acompañado de "Vto. CAE". Va en el campo "cae", nunca en nroComprobante.
- CUIT / C.U.I.T. (11 dígitos, formato 30-12345678-9) ni el CUIL del chofer.
- Nº de registro, REG. Nº, MEMORIA FISCAL, Nº DE MAQUINA FISCAL, DGI, INGRESOS BRUTOS.
- Número de surtidor, pico, manguera, turno, cajero, operador, tarjeta, patente, kilometraje.
- Código de barras, número de lote, número de transacción, cupón de tarjeta.
- Un "Nº" suelto del encabezado que NO tenga 8 dígitos ni esté acompañado de punto de venta.

## Resto de los campos
- "litros": cantidad cargada. Etiquetas: LTS, Lts., LITROS, CANT., CANTIDAD, VOLUMEN, L. Suele tener 2 o 3 decimales. NO confundir con el precio por litro (que es un número mucho más grande) ni con el total.
- "precioLitro": precio unitario por litro si figura (PRECIO UNIT., $/L, P.UNIT.). null si no aparece.
- "monto": importe TOTAL en pesos. Etiquetas: TOTAL, IMPORTE TOTAL, TOTAL $, A PAGAR, SON PESOS. Si hay SUBTOTAL y TOTAL, usá TOTAL. Ignorá "Efectivo", "Vuelto", "Su pago", "Saldo".
  Formato argentino de entrada: el punto es separador de miles y la coma es decimal. "45.678,90" → 45678.90. Devolvé número con punto decimal y sin separador de miles.
- "fecha": formato argentino DD/MM/AAAA. "05/03/2026" es 5 de marzo, NUNCA 3 de mayo. Si el año viene con 2 dígitos, expandí a 20XX. Devolvé "YYYY-MM-DD".
- "tipoCombustible": tal como figura impreso (ej: "INFINIA DIESEL", "EURO DIESEL", "SUPER", "V-POWER NAFTA", "GNC"). null si no aparece.
- "estacion": razón social o nombre de fantasía de la estación tal como figura. null si no aparece.
- "cuitEstacion": CUIT del emisor, solo dígitos, sin guiones. null si no aparece.
- "cae": el CAE/CAI si existe, solo dígitos. null si no aparece.
- "lineaOrigenNumero": copiá TEXTUALMENTE la línea completa de la imagen de donde extrajiste el nroComprobante, tal cual la leés (con su etiqueta). Si no encontraste número, null.
- "estacionId": el ID de la estación en el CATÁLOGO DE LA EMPRESA (abajo) que corresponde a lo que leíste. Usá el CUIT como evidencia principal; si no hay CUIT, compará el nombre tolerando errores de lectura, abreviaturas y razón social vs nombre de fantasía. **Si no podés determinarlo con certeza, null.** NUNCA inventes un ID que no esté en la lista.
- "movilId": el ID del móvil en el catálogo cuya patente corresponde a la que leíste, tolerando confusiones típicas de lectura (O/0, I/1, B/8, S/5). **Si no podés determinarlo con certeza, null.** NUNCA inventes un ID.
- "tipoCombustibleId": el ID del tipo de combustible del catálogo que corresponde a lo impreso. Si dudás, null.
- "patente": la patente del vehículo, a veces rotulada DOMINIO, PATENTE o PAT, impresa o manuscrita. Puede venir en formato viejo "AAA 123" o nuevo "AA 123 CD". Devolvela tal como se lee, sin corregir ni reformatear. null si no aparece.
- "kilometraje": el kilometraje del vehículo, suele figurar en REMITOS (rotulado KM, KMS o KILOMETRAJE, a veces manuscrito) y rara vez en FACTURAS. Es un número entero sin separadores de miles. Ante la mínima duda, null: no lo inventes ni lo confundas con otro número (nroComprobante, litros, monto, CUIT).

## Coherencia
Si tenés litros y precioLitro, verificá que litros × precioLitro ≈ monto (tolerancia 5%). Si no cierra, revisá si confundiste litros con precio unitario y corregí.

## Reglas de honestidad
- NO inventes ni completes datos por probabilidad. Ante la mínima duda sobre un campo: null.
- Si un dígito está borroso, cortado, tapado por un dedo, quemado por el flash o el papel térmico está desvanecido, ese campo va en null. Es preferible null a un número equivocado.
- "legible": false SOLO si la imagen no es un comprobante de combustible, o está tan mal que no se puede leer casi nada. Si se lee parcialmente, legible = true y los campos ilegibles en null.
- "confianzaNumero": "alta" si leíste el número nítido y con etiqueta clara; "media" si lo inferiste combinando partes o la etiqueta era ambigua; "baja" si hay dígitos dudosos.

## Formato de salida (exacto, todas las claves siempre presentes)
{"legible": boolean, "tipoComprobante": "REMITO"|"FACTURA_A"|"FACTURA_B"|"FACTURA_C"|"TIQUE"|"OTRO", "nroComprobante": string|null, "puntoVenta": string|null, "numero": string|null, "lineaOrigenNumero": string|null, "confianzaNumero": "alta"|"media"|"baja", "litros": number|null, "precioLitro": number|null, "monto": number|null, "fecha": "YYYY-MM-DD"|null, "tipoCombustible": string|null, "estacion": string|null, "cuitEstacion": string|null, "cae": string|null, "patente": string|null, "kilometraje": number|null, "estacionId": number|null, "movilId": number|null, "tipoCombustibleId": number|null}`;

/**
 * RAG (plan 2026-08-18): los catálogos de la empresa viajan EN el prompt para
 * que el modelo elija de una lista cerrada en vez de devolver texto libre que
 * después hay que adivinar con comparación de strings. Son ~130 ítems: entran
 * holgados, sin necesidad de embeddings ni base vectorial.
 */
export function bloqueCatalogos(cat: {
  estaciones: { id: number; nombre: string; cuit: string | null; aliases?: { alias: string }[] }[];
  moviles: { id: number; identificador: string }[];
  tipos: { id: number; nombre: string; aliases: { alias: string }[] }[];
}): string {
  const alias = (as?: { alias: string }[]) => (as?.length ? ` (también: ${as.map((a) => a.alias).join(', ')})` : '');
  return `

## CATÁLOGO DE LA EMPRESA — elegí SIEMPRE de estas listas
Devolvé el ID numérico. Si ninguna opción corresponde con certeza, devolvé null: es preferible null a una elección dudosa.

### Estaciones de servicio (id | nombre | CUIT)
${cat.estaciones.map((e) => `${e.id} | ${e.nombre}${alias(e.aliases)} | ${e.cuit ?? 'sin CUIT'}`).join('\n')}

### Móviles de la flota (id | patente)
${cat.moviles.map((m) => `${m.id} | ${m.identificador}`).join('\n')}

### Tipos de combustible (id | nombre)
${cat.tipos.map((t) => `${t.id} | ${t.nombre}${alias(t.aliases)}`).join('\n')}`;
}

export type TipoComprobante = 'REMITO' | 'FACTURA_A' | 'FACTURA_B' | 'FACTURA_C' | 'TIQUE' | 'OTRO';
export type ExtraccionTicket = {
  legible: boolean;
  sugerencias: null | {
    litros: number | null; monto: number | null; fechaCarga: string | null;
    nroComprobante: string | null; tipoCombustibleId: number | null; estacionId: number | null;
    tipoComprobante: TipoComprobante | null;
    medioPagoSugerido: 'cuenta_corriente' | 'caja' | null;
    confianzaNumero: 'alta' | 'media' | 'baja' | null;
    lineaOrigenNumero: string | null;
    precioLitro: number | null;
    advertenciaCoherencia: string | null;
    patente: string | null;
    km: number | null;
    movilId: number | null;
    tipoCombustibleLeido: string | null;
    cuitEstacionLeido: string | null;
    /** Campos donde las dos lecturas no coincidieron: van en null y la UI los
     * marca para que el operario los complete mirando la foto (plan 2026-08-18). */
    camposInseguros: string[];
    /** Carga previa no anulada con el mismo comprobante en la misma estación. */
    alertaDuplicado: { cargaId: number } | null;
  };
};

const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const normalizarPatente = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const soloDigitos = (s: string) => s.replace(/\D/g, '');

@Injectable()
export class ExtraccionTicketService {
  private readonly logger = new Logger(ExtraccionTicketService.name);
  private readonly cliente?: Anthropic;

  constructor(private prisma: PrismaService, @Optional() @Inject(ANTHROPIC_CLIENT) cliente?: Anthropic) {
    this.cliente = cliente ?? (process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : undefined);
  }

  /**
   * Proveedor explícito (plan 2026-08-18): `IA_PROVEEDOR=openai|anthropic`.
   * Antes bastaba con que existiera ANTHROPIC_API_KEY para cambiar de modelo en
   * silencio; producción usa OpenAI, así que ese es el default.
   */
  private get proveedor(): 'openai' | 'anthropic' {
    const declarado = process.env.IA_PROVEEDOR;
    if (declarado === 'anthropic' || declarado === 'openai') return declarado;
    return this.cliente && !process.env.OPENAI_API_KEY ? 'anthropic' : 'openai';
  }

  private async llamarModelo(
    foto: { buffer: Buffer; mimetype: 'image/jpeg' | 'image/png' },
    prompt: string,
  ): Promise<string | null> {
    const usarAnthropic = this.cliente && (this.proveedor === 'anthropic' || !process.env.OPENAI_API_KEY);
    if (usarAnthropic && this.cliente) {
      const respuesta = await this.cliente.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: foto.mimetype, data: foto.buffer.toString('base64') } },
          { type: 'text', text: prompt },
        ]}],
      });
      const texto = respuesta.content.find((b) => b.type === 'text');
      return texto && texto.type === 'text' ? texto.text : null;
    }
    if (process.env.OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-5.1',
          max_completion_tokens: 2048,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${foto.mimetype};base64,${foto.buffer.toString('base64')}`, detail: 'high' } },
            { type: 'text', text: prompt },
          ]}],
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : null;
    }
    return null;
  }

  /** Lectura simple: llama al modelo y parsea. null si no hubo respuesta usable. */
  private async leerUnaVez(
    foto: { buffer: Buffer; mimetype: 'image/jpeg' | 'image/png' },
    prompt: string,
  ): Promise<Record<string, any> | null> {
    const texto = await this.llamarModelo(foto, prompt);
    if (!texto) return null;
    return JSON.parse(texto.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  }

  async extraer(foto: { buffer: Buffer; mimetype: 'image/jpeg' | 'image/png' }): Promise<ExtraccionTicket> {
    if (!this.cliente && !process.env.OPENAI_API_KEY) return { legible: false, sugerencias: null };
    try {
      const [estaciones, tipos, moviles] = await Promise.all([
        this.prisma.estacionServicio.findMany({
          where: { activo: true },
          select: {
            id: true, nombre: true, cuit: true,
            // Solo los alias aprobados participan del matcheo y del prompt.
            aliases: { where: { aprobado: true }, select: { alias: true } },
          },
        }),
        this.prisma.tipoCombustible.findMany({ where: { activo: true }, select: { id: true, nombre: true, aliases: { select: { alias: true } } } }),
        this.prisma.movil.findMany({ where: { activo: true }, select: { id: true, identificador: true } }),
      ]);

      // RAG + doble lectura (plan 2026-08-18): el catálogo viaja en el prompt y
      // se lee DOS veces en paralelo; solo se acepta lo que ambas coinciden.
      const prompt = PROMPT + bloqueCatalogos({ estaciones, moviles, tipos });
      const lecturas = await Promise.allSettled([
        this.leerUnaVez(foto, prompt),
        this.leerUnaVez(foto, prompt),
      ]);
      const ok = lecturas
        .filter((r): r is PromiseFulfilledResult<Record<string, any> | null> => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((v): v is Record<string, any> => v !== null);
      if (ok.length === 0) return { legible: false, sugerencias: null };
      if (!ok[0].legible) return { legible: false, sugerencias: null };

      // Con una sola lectura válida se degrada: se usa, pero TODO queda marcado
      // como inseguro (coherente con "máxima precisión").
      const doble = ok.length >= 2 && ok[1].legible;
      const { valores, camposInseguros } = doble
        ? consensuar(ok[0], ok[1], CAMPOS_CONSENSO)
        : { valores: ok[0], camposInseguros: [...CAMPOS_CONSENSO] };
      const json: Record<string, any> = doble ? { ...ok[0], ...valores } : ok[0];
      const matchear = (
        valor: string | null,
        catalogo: { id: number; nombre: string; aliases?: { alias: string }[] }[],
      ) => {
        if (!valor) return null;
        const v = normalizar(valor);
        const hit = catalogo.find((c) => normalizar(c.nombre) === v)
          ?? catalogo.find((c) => c.aliases?.some((a) => normalizar(a.alias) === v))
          ?? catalogo.find((c) => v.includes(normalizar(c.nombre)) || normalizar(c.nombre).includes(v));
        return hit?.id ?? null;
      };
      // Tipo de combustible: nombre exacto → alias exacto → inclusión por nombre → inclusión por alias.
      const matchearTipo = (valor: string | null) => {
        if (!valor) return null;
        const v = normalizar(valor);
        const porNombre = tipos.find((t) => normalizar(t.nombre) === v);
        if (porNombre) return porNombre.id;
        const porAlias = tipos.find((t) => t.aliases.some((a) => normalizar(a.alias) === v));
        if (porAlias) return porAlias.id;
        const porInclusion = tipos.find((t) => v.includes(normalizar(t.nombre)) || normalizar(t.nombre).includes(v))
          ?? tipos.find((t) => t.aliases.some((a) => v.includes(normalizar(a.alias)) || normalizar(a.alias).includes(v)));
        return porInclusion?.id ?? null;
      };
      /** Solo se acepta un id si existe en el catálogo (el modelo no puede inventar). */
      const delCatalogo = (valor: unknown, catalogo: { id: number }[]) =>
        typeof valor === 'number' && catalogo.some((c) => c.id === valor) ? valor : null;

      // Estación, por orden de confianza (plan 2026-08-18):
      // 1) CUIT exacto = dato duro verificable; 2) elección del modelo con el
      // catálogo a la vista (RAG); 3) matcheo por texto como red de respaldo.
      const cuitLeido = typeof json.cuitEstacion === 'string' ? soloDigitos(json.cuitEstacion) : '';
      const porCuit = cuitLeido.length === 11 ? estaciones.find((e) => e.cuit === cuitLeido) : undefined;
      const estacionId =
        porCuit?.id ?? delCatalogo(json.estacionId, estaciones) ?? matchear(json.estacion ?? null, estaciones);
      const TIPOS_COMPROBANTE: TipoComprobante[] = ['REMITO', 'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'TIQUE', 'OTRO'];
      const tipoComprobante = TIPOS_COMPROBANTE.includes(json.tipoComprobante) ? (json.tipoComprobante as TipoComprobante) : null;
      const medioPagoSugerido = tipoComprobante === 'REMITO' ? 'cuenta_corriente'
        : tipoComprobante && tipoComprobante !== 'OTRO' ? 'caja' : null;
      const confianzaNumero = ['alta', 'media', 'baja'].includes(json.confianzaNumero) ? json.confianzaNumero : null;
      const lineaOrigenNumero = typeof json.lineaOrigenNumero === 'string' ? json.lineaOrigenNumero.slice(0, 200) : null;
      const precioLitro = typeof json.precioLitro === 'number' ? json.precioLitro : null;
      const litros = typeof json.litros === 'number' ? json.litros : null;
      const monto = typeof json.monto === 'number' ? json.monto : null;
      // Verificación aritmética: si la cuenta no cierra, los tres números son
      // sospechosos (no sabemos cuál se leyó mal) y se marcan como inseguros.
      const aritmetica = verificarAritmetica(litros, precioLitro, monto);
      const advertenciaCoherencia = aritmetica.mensaje;
      if (!aritmetica.cierra) {
        for (const campo of ['litros', 'precioLitro', 'monto']) {
          if (!camposInseguros.includes(campo)) camposInseguros.push(campo);
        }
      }

      const patente = typeof json.patente === 'string' ? json.patente : null;
      const km = typeof json.kilometraje === 'number' && Number.isInteger(json.kilometraje) && json.kilometraje >= 0
        ? json.kilometraje : null;
      // Móvil: patente exacta (dato duro) → elección del modelo con el catálogo
      // a la vista (tolera O/0, I/1 y demás confusiones de lectura).
      const porPatenteExacta = patente
        ? (moviles.find((m) => normalizarPatente(m.identificador) === normalizarPatente(patente))?.id ?? null)
        : null;
      const movilId = porPatenteExacta ?? delCatalogo(json.movilId, moviles);

      // Aprendizaje con evidencia dura (plan 2026-08-18): si el CUIT del ticket
      // confirma la estación, el nombre impreso ES un alias válido — se guarda
      // aprobado. Sin esa prueba no se aprende solo (un alias errado
      // envenenaría todas las extracciones siguientes).
      const estacionLeida = typeof json.estacion === 'string' ? json.estacion.trim() : null;
      if (porCuit && estacionLeida && normalizar(estacionLeida) !== normalizar(porCuit.nombre)) {
        try {
          await this.prisma.estacionServicioAlias.upsert({
            where: { alias: estacionLeida },
            create: { estacionId: porCuit.id, alias: estacionLeida, aprobado: true },
            update: {},
          });
        } catch (e) {
          this.logger.warn(`No se pudo registrar el alias de estación: ${e instanceof Error ? e.message : e}`);
        }
      }

      const nroComprobante = typeof json.nroComprobante === 'string' ? json.nroComprobante : null;

      // Anti-duplicado: mismo comprobante en la misma estación, no anulado.
      let alertaDuplicado: { cargaId: number } | null = null;
      if (nroComprobante && estacionId) {
        try {
          const previa = await this.prisma.cargaCombustible.findFirst({
            where: { nroComprobante, estacionId, estado: { not: 'anulada' } },
            select: { id: true },
          });
          if (previa) alertaDuplicado = { cargaId: previa.id };
        } catch (e) {
          // La alerta es auxiliar: si la consulta falla, la extracción sigue.
          this.logger.warn(`Chequeo de duplicado falló: ${e instanceof Error ? e.message : e}`);
        }
      }

      return { legible: true, sugerencias: {
        litros,
        monto,
        fechaCarga: typeof json.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.fecha) ? json.fecha : null,
        nroComprobante,
        tipoCombustibleId: delCatalogo(json.tipoCombustibleId, tipos) ?? matchearTipo(json.tipoCombustible ?? null),
        estacionId,
        tipoComprobante,
        medioPagoSugerido,
        confianzaNumero,
        lineaOrigenNumero,
        precioLitro,
        advertenciaCoherencia,
        patente,
        km,
        movilId,
        tipoCombustibleLeido: typeof json.tipoCombustible === 'string' ? json.tipoCombustible : null,
        cuitEstacionLeido: cuitLeido.length === 11 ? cuitLeido : null,
        camposInseguros,
        alertaDuplicado,
      }};
    } catch (e) {
      this.logger.warn(`Extracción de ticket falló: ${e instanceof Error ? e.message : e}`);
      return { legible: false, sugerencias: null };
    }
  }
}
