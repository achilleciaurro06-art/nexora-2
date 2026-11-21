import type { Terms } from "./terms";

export const SECTOR_KEYS = ["generic", "rubinetterie", "serramenti", "edilizia", "impianti", "servizi"] as const;
export type SectorKey = (typeof SECTOR_KEYS)[number];

export type FieldPreset = { entity: "customer" | "quote"; key: string; label: string; field_type: "text" | "number" | "date" | "select" | "boolean"; options?: string[]; required?: boolean };
export type TemplatePreset = { name: string; description: string; title: string; terms: string; items: { description: string; quantity: number; unit_price_cents: number; discount_percent: number; vat_rate: number }[] };
export type SectorPreset = { label: string; description: string; terms: Partial<Terms>; fields: FieldPreset[]; templates: TemplatePreset[]; aiHint: string };

/**
 * Proposte di partenza, NON verità di settore: servono a non partire da una pagina bianca e si modificano a piacere.
 * I prezzi dei modelli sono segnaposto a zero: vanno inseriti dall'azienda.
 */
export const SECTORS: Record<SectorKey, SectorPreset> = {
  generic: { label: "Generico", description: "Nessun adattamento: terminologia e campi standard.", terms: {}, fields: [], templates: [], aiHint: "" },
  rubinetterie: {
    label: "Rubinetterie e idraulica", description: "Rivenditori e produttori di rubinetteria, componenti idraulici, sanitari.",
    terms: {},
    fields: [
      { entity: "customer", key: "tipo_cliente", label: "Tipo di cliente", field_type: "select", options: ["Idraulico", "Rivenditore", "Impresa edile", "Privato"] },
      { entity: "customer", key: "zona_agente", label: "Zona / agente", field_type: "text" },
      { entity: "quote", key: "cantiere", label: "Cantiere / destinazione", field_type: "text" },
      { entity: "quote", key: "consegna_prevista", label: "Consegna prevista", field_type: "date" },
    ],
    templates: [{ name: "Fornitura materiale idraulico", description: "Fornitura standard con trasporto.", title: "Fornitura materiale idraulico", terms: "Pagamento a 30 giorni data fattura. Merce resa franco magazzino salvo diversi accordi.",
      items: [{ description: "Articoli a listino (da dettagliare)", quantity: 1, unit_price_cents: 0, discount_percent: 0, vat_rate: 22 }, { description: "Trasporto", quantity: 1, unit_price_cents: 0, discount_percent: 0, vat_rate: 22 }] }],
    aiHint: "Settore: rubinetterie e idraulica (vendita di componenti, rivenditori, idraulici, imprese).",
  },
  serramenti: {
    label: "Serramenti e infissi", description: "Produzione, vendita e posa di serramenti, finestre, porte, tapparelle.",
    terms: { customer_singular: "Cliente", customer_plural: "Clienti" },
    fields: [
      { entity: "customer", key: "tipo_cliente", label: "Tipo di cliente", field_type: "select", options: ["Privato", "Impresa", "Condominio", "Rivenditore"] },
      { entity: "customer", key: "detrazione_fiscale", label: "Interessato a detrazione fiscale", field_type: "boolean" },
      { entity: "quote", key: "cantiere", label: "Indirizzo del cantiere", field_type: "text" },
      { entity: "quote", key: "materiale", label: "Materiale", field_type: "select", options: ["PVC", "Alluminio", "Legno", "Legno-alluminio"] },
      { entity: "quote", key: "sopralluogo", label: "Data sopralluogo", field_type: "date" },
      { entity: "quote", key: "tempi_posa", label: "Tempi di posa (settimane)", field_type: "number" },
    ],
    templates: [{ name: "Sostituzione serramenti", description: "Fornitura e posa, con smaltimento.", title: "Fornitura e posa di serramenti", terms: "Acconto alla conferma d'ordine, saldo a posa ultimata. Tempi di consegna da definire dopo il rilievo misure.",
      items: [{ description: "Serramento (specificare misure e finitura)", quantity: 1, unit_price_cents: 0, discount_percent: 0, vat_rate: 22 }, { description: "Posa in opera", quantity: 1, unit_price_cents: 0, discount_percent: 0, vat_rate: 22 }, { description: "Smaltimento vecchi infissi", quantity: 1, unit_price_cents: 0, discount_percent: 0, vat_rate: 22 }] }],
    aiHint: "Settore: serramenti e infissi (rilievo misure, fornitura e posa, clienti privati, imprese e condomìni).",
  },
  edilizia: {
    label: "Edilizia e ristrutturazioni", description: "Imprese edili, ristrutturazioni, lavori su commessa.",
    terms: { quote_singular: "Preventivo", quote_plural: "Preventivi" },
    fields: [
      { entity: "customer", key: "tipo_cliente", label: "Tipo di cliente", field_type: "select", options: ["Privato", "Impresa", "Condominio", "Ente"] },
      { entity: "quote", key: "cantiere", label: "Indirizzo del cantiere", field_type: "text" },
      { entity: "quote", key: "inizio_lavori", label: "Inizio lavori previsto", field_type: "date" },
      { entity: "quote", key: "durata_giorni", label: "Durata prevista (giorni)", field_type: "number" },
    ],
    templates: [], aiHint: "Settore: edilizia e ristrutturazioni (lavori su commessa, cantieri).",
  },
  impianti: {
    label: "Impianti e manutenzione", description: "Impiantisti, manutenzioni programmate, assistenza tecnica.",
    terms: {},
    fields: [
      { entity: "customer", key: "contratto_manutenzione", label: "Contratto di manutenzione", field_type: "boolean" },
      { entity: "customer", key: "scadenza_contratto", label: "Scadenza contratto", field_type: "date" },
      { entity: "quote", key: "tipo_intervento", label: "Tipo di intervento", field_type: "select", options: ["Installazione", "Manutenzione", "Riparazione", "Collaudo"] },
    ],
    templates: [], aiHint: "Settore: impianti e manutenzione (interventi, contratti di assistenza).",
  },
  servizi: {
    label: "Servizi e consulenza", description: "Professionisti e aziende di servizi: ore, progetti, canoni.",
    terms: { customer_singular: "Cliente", customer_plural: "Clienti", quote_singular: "Offerta", quote_plural: "Offerte" },
    fields: [
      { entity: "customer", key: "referente_amministrativo", label: "Referente amministrativo", field_type: "text" },
      { entity: "quote", key: "durata_mesi", label: "Durata (mesi)", field_type: "number" },
      { entity: "quote", key: "data_avvio", label: "Data di avvio", field_type: "date" },
    ],
    templates: [], aiHint: "Settore: servizi e consulenza (progetti, ore, canoni ricorrenti).",
  },
};

export const sectorLabel = (k: string) => (SECTORS as Record<string, SectorPreset>)[k]?.label ?? SECTORS.generic.label;
export const isSector = (k: unknown): k is SectorKey => typeof k === "string" && (SECTOR_KEYS as readonly string[]).includes(k);
