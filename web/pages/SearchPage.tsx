import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type { Page, SearchHit } from "../../shared/types";
import { apiGet } from "../lib/api";
import { qk } from "../lib/query";
import { formatRelativeTime } from "../lib/format";
import { EmptyState, Spinner, TextInput } from "../components/Form";
import { SearchIcon } from "../components/icons";

export function SearchPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => {
    const handle = setTimeout(() => {
      if (q) setParams({ q });
      else setParams({});
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = params.get("q") ?? "";
  const results = useQuery({
    queryKey: qk.search(query),
    queryFn: () => apiGet<Page<SearchHit>>(`/api/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-black text-slate-900">Search</h1>
      <div className="relative mb-4">
        <SearchIcon width={18} height={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <TextInput
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Properties, notes, work orders, tenants…"
          className="pl-10"
        />
      </div>

      {query.length === 0 && <EmptyState title="Search everything" detail="Notes, work orders, projects, tenants, leases, vendors, specs." />}
      {results.isPending && query.length > 0 && <Spinner label="Searching…" />}
      {results.data && results.data.items.length === 0 && <EmptyState title={`No results for "${query}"`} />}
      {results.data && results.data.items.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {results.data.items.map((hit) => (
            <li key={`${hit.entityType}:${hit.entityId}`}>
              <Link to={hit.url} className="block px-4 py-3 hover:bg-slate-50">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900">{hit.title}</p>
                  <span className="text-xs uppercase text-slate-400">{hit.entityType.replace("_", " ")}</span>
                </div>
                <p className="text-sm text-slate-500" dangerouslySetInnerHTML={{ __html: hit.snippet }} />
                <p className="text-xs text-slate-400">
                  {hit.propertyName ?? "Portfolio-wide"} · {formatRelativeTime(hit.updatedAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
