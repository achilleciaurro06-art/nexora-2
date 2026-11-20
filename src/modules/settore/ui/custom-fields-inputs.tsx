import { Input, Label, Select } from "@/components/ui/input";
import { cfName, type CustomFieldDef, type CustomValues } from "../custom-fields";

/** Campi personalizzati di un modulo (cliente o preventivo). Nomi dei campi: cf_<chiave>. Utilizzabile da server e client component. */
export function CustomFieldsInputs({ defs, values, readOnly }: { defs: CustomFieldDef[]; values?: CustomValues | null; readOnly?: boolean }) {
  if (defs.length === 0) return null;
  return (
    <>
      {defs.map((d) => {
        const id = cfName(d.key);
        const v = values?.[d.key];
        const label = `${d.label}${d.required ? " *" : ""}`;
        if (d.field_type === "boolean") {
          return <label key={d.key} className="flex items-center gap-2 text-sm"><input type="checkbox" id={id} name={id} defaultChecked={v === true} disabled={readOnly} /> {d.label}</label>;
        }
        return (
          <div key={d.key}>
            <Label htmlFor={id}>{label}</Label>
            {d.field_type === "select" ? (
              <Select id={id} name={id} defaultValue={typeof v === "string" ? v : ""} disabled={readOnly} required={d.required}>
                <option value="">—</option>
                {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            ) : (
              <Input id={id} name={id} type={d.field_type === "date" ? "date" : "text"} inputMode={d.field_type === "number" ? "decimal" : undefined}
                defaultValue={v === undefined ? "" : String(v)} disabled={readOnly} required={d.required} />
            )}
          </div>
        );
      })}
    </>
  );
}
