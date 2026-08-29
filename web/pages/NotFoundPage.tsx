import { Link } from "react-router-dom";

export function NotFoundPage(): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-3xl font-black text-slate-300">404</p>
      <p className="text-lg font-semibold text-slate-800">Page not found</p>
      <Link to="/" className="font-medium text-brand-600 hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
