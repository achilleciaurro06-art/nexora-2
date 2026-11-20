"use client";

import { useEffect, useState } from "react";
import { Label, Select } from "@/components/ui/input";
import { listContactsAction } from "@/modules/clienti/contacts";

/** Selettore del referente: si aggiorna al cambiare del cliente scelto. */
export function ContactSelect({ customerId, defaultValue = "", disabled, name = "contactId" }: { customerId: string; defaultValue?: string; disabled?: boolean; name?: string }) {
  const [loaded, setLoaded] = useState<{ for: string; list: { id: string; name: string }[] } | null>(null);
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    if (!customerId) return;
    let alive = true;
    listContactsAction(customerId).then((list) => { if (alive) setLoaded({ for: customerId, list }); }).catch(() => { if (alive) setLoaded({ for: customerId, list: [] }); });
    return () => { alive = false; };
  }, [customerId]);
  const contacts = loaded?.for === customerId ? loaded.list : [];
  const shown = contacts.some((c) => c.id === value) ? value : "";
  return (
    <div>
      <Label htmlFor={name}>Referente</Label>
      <Select id={name} name={name} value={shown} onChange={(e) => setValue(e.target.value)} disabled={disabled || !customerId}>
        <option value="">{customerId ? (contacts.length ? "—" : "Nessun referente") : "Scegli prima il cliente"}</option>
        {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
    </div>
  );
}
