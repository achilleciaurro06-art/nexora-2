-- NEXORA 2.0 – 13 correzione: un membro che modifica un preventivo in BOZZA duplicava le righe.
-- Causa: save_quote (SECURITY INVOKER) elimina le vecchie righe, ma la policy di DELETE su quote_items è
-- riservata a owner/admin; per un membro la DELETE non eliminava nulla (nessun errore) e le nuove righe si sommavano.
-- Ora i membri possono eliminare righe SOLO di preventivi in bozza (owner/admin restano coperti dalla policy esistente).

create policy quote_items_delete_member_draft on public.quote_items for delete to authenticated
  using (
    private.has_role(organization_id, array['member'])
    and exists (
      select 1 from public.quotes q
      where q.id = quote_items.quote_id and q.organization_id = quote_items.organization_id and q.status = 'draft'
    )
  );
