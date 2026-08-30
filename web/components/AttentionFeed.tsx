import { Link } from "react-router-dom";
import type { AttentionItem } from "../../shared/types";
import { formatDaysOut } from "../lib/format";
import { attentionSeverityDisplay, ATTENTION_KIND_LABEL } from "../lib/status";
import { StatusPill } from "./StatusPill";
import { EmptyState } from "./Form";
import { AlertIcon } from "./icons";
import type { ReactElement } from "react";

/** Renders every AttentionKind (design §C4) — required by the dashboard acceptance criterion. */
export function AttentionFeed(props: { items: AttentionItem[] }): ReactElement {
  if (props.items.length === 0) {
    return <EmptyState title="Nothing needs attention" detail="You're all caught up across every property." />;
  }

  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {props.items.map((item) => {
        const severity = attentionSeverityDisplay(item.severity);
        return (
          <li key={item.id}>
            <Link to={item.url} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
              <span className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true">
                <AlertIcon width={18} height={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold text-slate-900">{item.title}</p>
                  <StatusPill severity={severity} label={ATTENTION_KIND_LABEL[item.kind]} />
                </div>
                <p className="truncate text-sm text-slate-500">
                  {item.propertyName}
                  {item.unitLabel ? ` · ${item.unitLabel}` : ""} · {item.detail}
                </p>
              </div>
              {item.daysOut !== null && (
                <span className="shrink-0 text-xs font-semibold text-slate-500">{formatDaysOut(item.daysOut)}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
