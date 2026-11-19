export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "data:read"
  | "data:write"
  | "data:delete"
  | "members:manage"
  | "ai:use"
  | "audit:read";

const MATRIX: Record<Role, readonly Permission[]> = {
  owner: ["data:read", "data:write", "data:delete", "members:manage", "ai:use", "audit:read"],
  admin: ["data:read", "data:write", "data:delete", "members:manage", "ai:use", "audit:read"],
  member: ["data:read", "data:write", "ai:use"],
  viewer: ["data:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}
