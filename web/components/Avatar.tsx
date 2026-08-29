import type { UserRef } from "../../shared/types";
import { initials } from "../lib/format";

export function Avatar(props: { user: UserRef; size?: number; ring?: boolean }): JSX.Element {
  const size = props.size ?? 32;
  return (
    <span
      title={props.user.displayName}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${
        props.ring ? "ring-2 ring-white" : ""
      }`}
      style={{
        backgroundColor: props.user.avatarColor,
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.4),
      }}
    >
      {initials(props.user.displayName)}
    </span>
  );
}

export function AvatarStack(props: { users: UserRef[]; max?: number }): JSX.Element {
  const max = props.max ?? 4;
  const shown = props.users.slice(0, max);
  const overflow = props.users.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size={28} ring />
      ))}
      {overflow > 0 && (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 ring-2 ring-white">
          +{overflow}
        </span>
      )}
    </div>
  );
}
