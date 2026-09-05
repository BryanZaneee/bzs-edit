/** Scroll the live-preview iframe to a CSS selector on the site ("" = top). */
export function scrollPreview(target: string) {
  document.querySelector<HTMLIFrameElement>("iframe.preview-frame")?.contentWindow?.postMessage({ type: "scrollTo", target }, location.origin);
}

/** `onOpen` helper for a ListEditor whose rows map 1:1 to `${selector}:nth-child(n)` on the site. */
export const rowScroller = (selector: string) => (i: number) => scrollPreview(`${selector}:nth-child(${i + 1})`);
