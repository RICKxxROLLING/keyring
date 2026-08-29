import { Dialog } from "./Dialog";
import { Button } from "./Button";

/**
 * Renders both copies on a VERSION_CONFLICT (409, design §C5.11 / §C10.5) and lets the user
 * either retry their edit against the server's current version, or discard it.
 */
export function VersionConflictDialog(props: {
  open: boolean;
  onClose: () => void;
  fieldLabel: string;
  yourValue: string;
  serverValue: string;
  changedBy?: string;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}): JSX.Element {
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Someone else changed this" wide>
      <p className="mb-3 text-sm text-slate-600">
        {props.changedBy ? `${props.changedBy} changed` : "This"} {props.fieldLabel.toLowerCase()} while you were
        editing. Choose which version to keep.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-brand-700">Your version</p>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{props.yourValue || "(empty)"}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Current on server</p>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{props.serverValue || "(empty)"}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row">
        <Button variant="secondary" className="flex-1" onClick={props.onTakeTheirs}>
          Take theirs
        </Button>
        <Button className="flex-1" onClick={props.onKeepMine}>
          Keep mine
        </Button>
      </div>
    </Dialog>
  );
}
