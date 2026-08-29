import { useMemo } from "react";
import { encodeQrSvg } from "../lib/qrcode";

export function QrCode(props: { text: string; size?: number }): JSX.Element {
  const svg = useMemo(() => encodeQrSvg(props.text), [props.text]);
  const size = props.size ?? 200;

  if (!svg) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500"
        style={{ width: size, height: size }}
      >
        Code too long to render — use the manual entry link below.
      </div>
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className="overflow-hidden rounded-lg border border-slate-200 bg-white p-2"
      // Content is generated locally from a caller-supplied otpauth URL, never remote HTML.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
