import { randomBytes } from "node:crypto";
import { toBool } from "../lib/rowmap.js";
import type { User, UserRef } from "../../shared/types.js";

/** Raw `users` row shape as returned by `SELECT *`. */
export interface UserRow {
  id: string;
  email: string;
  handle: string;
  display_name: string;
  role: "owner" | "manager";
  password_hash: string;
  totp_secret: string | null;
  totp_enrolled_at: string | null;
  avatar_color: string;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    handle: row.handle,
    displayName: row.display_name,
    role: row.role,
    avatarColor: row.avatar_color,
    isActive: toBool(row.is_active),
    totpEnrolled: row.totp_enrolled_at !== null,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export function toUserRef(row: UserRow): UserRef {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
  };
}

const AVATAR_PALETTE = [
  "#e15759",
  "#4e79a7",
  "#59a14f",
  "#f28e2b",
  "#b07aa1",
  "#76b7b2",
  "#edc948",
  "#ff9da7",
  "#9c755f",
  "#bab0ac",
] as const;

export function pickAvatarColor(): string {
  const idx = randomBytes(1)[0]! % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx]!;
}
