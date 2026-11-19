export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "data:read"
  | "data:write"
  | "data:delete"
  | "members:manage"
  | "ai:use"
  | "audit:read"
  | "settings:manage";

const MATRIX: Record<Role, readonly Permission[]> = {
  owner: ["data:read", "data:write", "data:delete", "members:manage", "ai:use", "audit:read", "settings:manage"],
  admin: ["data:read", "data:write", "data:delete", "members:manage", "ai:use", "audit:read", "settings:manage"],
  member: ["data:read", "data:write", "ai:use"],
  viewer: ["data:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export const ROLE_LABEL: Record<Role, string> = { owner: "Titolare", admin: "Amministratore", member: "Membro", viewer: "Sola lettura" };
export const PERMISSION_LABEL: Record<Permission, string> = {
  "data:read": "Consultare clienti, preventivi, attività e documenti",
  "data:write": "Creare e modificare clienti, preventivi, attività e documenti",
  "data:delete": "Rimuovere clienti, preventivi, attività e documenti",
  "members:manage": "Invitare e gestire i collaboratori e i loro ruoli",
  "ai:use": "Usare il Copilot e le analisi AI",
  "audit:read": "Consultare il registro completo delle operazioni",
  "settings:manage": "Modificare le impostazioni aziendali",
};
/** Matrice permessi in sola lettura per la schermata Team. */
export function permissionMatrix(): { permission: Permission; label: string; roles: Record<Role, boolean> }[] {
  return (Object.keys(PERMISSION_LABEL) as Permission[]).map((permission) => ({
    permission, label: PERMISSION_LABEL[permission],
    roles: Object.fromEntries(ROLES.map((r) => [r, can(r, permission)])) as Record<Role, boolean>,
  }));
}
