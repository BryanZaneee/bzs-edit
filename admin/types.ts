/** Responsive image produced by `kind=image` uploads on sites with `image.kind: "picture"`.
 *  `sources` are srcset strings (empty for seed images that were never uploaded). */
export type Picture = {
  sources: { avif?: string; webp?: string; jpeg?: string };
  img: { src: string; w: number; h: number };
};

/** One card on the editor's home screen. `anchor` is a CSS selector on the public
 *  page the live preview scrolls to ("" = top); `page` is the public page to frame
 *  (default "/"), for sites whose content spans more than one page. */
export type Screen<K extends string = string> = {
  key: K;
  title: string;
  blurb: string;
  anchor: string;
  page?: string;
};
