import type { ReactNode } from "react";

/**
 * Paper sky: solid pond→paper bands with a 2 px checker dither only at band edges (art bible §3, "no gradients").
 * Pure decoration: hidden from assistive tech and never interactive.
 */
export function PaperSky() {
  return (
    <div className="sp-sky" aria-hidden="true">
      <i className="sp-band sp-band-1" />
      <i className="sp-dither sp-dither-1" />
      <i className="sp-band sp-band-2" />
      <i className="sp-dither sp-dither-2" />
      <i className="sp-band sp-band-3" />
      <i className="sp-dither sp-dither-3" />
      <i className="sp-band sp-band-4" />
      <i className="sp-cloud sp-cloud-a" />
      <i className="sp-cloud sp-cloud-b" />
      <i className="sp-cloud sp-cloud-c" />
    </div>
  );
}

/** The Greenhouse booth on its floating island: awning, inverted marquee, counter slot for the pack. */
export function Booth({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="sp-booth-wrap">
      <div className="sp-booth">
        <div className="sp-awning" aria-hidden="true" />
        <p className="sp-marquee">{label}</p>
        <div className="sp-counter">{children}</div>
      </div>
      <div className="sp-island" aria-hidden="true">
        <i className="sp-island-top" />
        <i className="sp-island-coral" />
        <i className="sp-island-under" />
      </div>
    </div>
  );
}
