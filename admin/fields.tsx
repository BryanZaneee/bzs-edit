import { useState, type ReactNode } from "react";
import type { Picture } from "./types";
import { ApiError, uploadFile, uploadImage } from "./api";

/* ---------- text ---------- */

type TextProps = {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  /** Character cap (native maxLength). A counter appears once 80% is used. */
  max?: number;
};

export function TextInput({ label, hint, value, onChange, multiline, placeholder, max }: TextProps) {
  const count = max && value.length >= max * 0.8 ? `${value.length}/${max}` : null;
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {multiline ? (
        <textarea rows={3} value={value} placeholder={placeholder} maxLength={max} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type="text" value={value} placeholder={placeholder} maxLength={max} onChange={(e) => onChange(e.target.value)} />
      )}
      {(hint || count) && (
        <span className="field-hint">
          {hint}
          {count && <span className="field-count">{count}</span>}
        </span>
      )}
    </label>
  );
}

/* ---------- uploads ---------- */

/** Smallest JPEG variant — for 44–112px thumbs, not the 2000w original. */
export function thumbUrl(p: Picture | undefined): string | undefined {
  return p?.sources.jpeg?.split(",")[0].trim().split(" ")[0] || p?.img.src;
}

export function useUpload<T>(run: (file: File) => Promise<T>, onDone: (v: T) => void) {
  const [status, setStatus] = useState<"idle" | "busy" | "error">("idle");
  const [message, setMessage] = useState("");
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setStatus("busy");
    setMessage(file.type.startsWith("video/") ? "Uploading video…" : file.type.startsWith("audio/") ? "Uploading track…" : "Uploading & optimizing…");
    try {
      onDone(await run(file));
      setStatus("idle");
      setMessage("");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof ApiError ? err.message : "Upload failed — please try again.");
    }
  };
  return { status, message, pick };
}

export function UploadButton({
  label,
  accept,
  busy,
  onPick,
}: {
  label: string;
  accept: string;
  busy: boolean;
  onPick: (f: File | undefined) => void;
}) {
  return (
    <label className={`btn btn-upload${busy ? " is-busy" : ""}`}>
      {busy ? "Working…" : label}
      <input
        type="file"
        accept={accept}
        disabled={busy}
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}

type ImageFieldProps = {
  label: string;
  hint?: string;
  value: Picture | undefined;
  onChange: (p: Picture) => void;
};

/** A photo on a picture site. Shows the current image; "Replace photo" uploads through the sharp pipeline. */
export function ImageField({ label, hint, value, onChange }: ImageFieldProps) {
  const up = useUpload(uploadImage, onChange);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="media-row">
        {value ? (
          <img className="media-thumb" src={thumbUrl(value)} alt="" />
        ) : (
          <div className="media-thumb media-thumb--empty">No photo yet</div>
        )}
        <div className="media-actions">
          <UploadButton
            label={value ? "Replace photo" : "Add photo"}
            accept="image/jpeg,image/png,image/webp"
            busy={up.status === "busy"}
            onPick={up.pick}
          />
        </div>
      </div>
      {up.message && <span className={`field-hint${up.status === "error" ? " is-error" : ""}`}>{up.message}</span>}
      {hint && !up.message && <span className="field-hint">{hint}</span>}
    </div>
  );
}

type FileFieldProps = {
  label: string;
  hint?: string;
  value: string | undefined;
  accept: string;
  /** Controls only the thumbnail rendered for the current value. */
  kind: "logo" | "video" | "image" | "audio";
  buttonLabel: string;
  onChange: (url: string) => void;
  onRemove?: () => void;
  /** Defaults to `uploadFile` (kind=file). Pass `uploadJpeg` for photos on single-JPEG sites. */
  upload?: (file: File) => Promise<string>;
};

/** A file stored as a plain URL string (logo, hero mp4, poster jpg, track audio, or a JPEG photo). */
export function FileField({ label, hint, value, accept, kind, buttonLabel, onChange, onRemove, upload = uploadFile }: FileFieldProps) {
  const up = useUpload(upload, onChange);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="media-row">
        {value ? (
          kind === "video" ? (
            <video className="media-thumb" src={value} muted autoPlay loop playsInline />
          ) : kind === "audio" ? (
            <audio className="media-audio" src={value} controls preload="none" />
          ) : (
            <img className={`media-thumb${kind === "logo" ? " media-thumb--logo" : ""}`} src={value} alt="" />
          )
        ) : (
          <div className="media-thumb media-thumb--empty">{kind === "logo" ? "Text only" : "None yet"}</div>
        )}
        <div className="media-actions">
          <UploadButton label={buttonLabel} accept={accept} busy={up.status === "busy"} onPick={up.pick} />
          {onRemove && value && (
            <button type="button" className="btn btn-quiet" onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      </div>
      {up.message && <span className={`field-hint${up.status === "error" ? " is-error" : ""}`}>{up.message}</span>}
      {hint && !up.message && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/* ---------- lists ---------- */

type ListProps<T> = {
  items: T[];
  onChange: (items: T[]) => void;
  /** Row summary line, e.g. "FILA — Runway". */
  title: (item: T, i: number) => string;
  /** Optional small thumbnail URL for the row header. */
  thumb?: (item: T) => string | undefined;
  /** Optional tag shown next to the title, e.g. "Big tile" for the first highlight. */
  badge?: (item: T, i: number) => string | undefined;
  /** Expanded form for one row. `update` replaces that row. */
  render: (item: T, update: (next: T) => void, i: number) => ReactNode;
  /** New blank row when "+ Add" is tapped. */
  create: () => T;
  addLabel: string;
  /** Singular noun for the delete confirmation ("track", "photo"). */
  noun: string;
  /** Called with the row index when a row is opened or added — used to scroll the live preview to it. */
  onOpen?: (i: number) => void;
};

/**
 * Add / remove / reorder any list. Rows are collapsed to one line; tap to open.
 * Delete is two-tap (inline confirm) — no browser dialogs.
 * ponytail: ▲▼ buttons, not drag-and-drop. Add a drag handler if a client asks.
 */
export function ListEditor<T>({ items, onChange, title, thumb, badge, render, create, addLabel, noun, onOpen }: ListProps<T>) {
  const [open, setOpen] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    if (open === i) setOpen(j);
  };
  const remove = (i: number) => {
    onChange(items.filter((_, k) => k !== i));
    setOpen(null);
    setConfirming(null);
  };
  const add = () => {
    onChange([...items, create()]);
    toggle(items.length);
  };
  const toggle = (i: number) => {
    const next = open === i ? null : i;
    setOpen(next);
    if (next !== null) onOpen?.(next);
  };

  return (
    <div className="list">
      {items.length === 0 && <p className="list-empty">Nothing here yet.</p>}
      {items.map((item, i) => {
        const isOpen = open === i;
        const t = thumb?.(item);
        const b = badge?.(item, i);
        return (
          <div key={i} className={`row${isOpen ? " is-open" : ""}`}>
            <div className="row-head">
              <button type="button" className="row-summary" onClick={() => toggle(i)} aria-expanded={isOpen}>
                {t ? <img className="row-thumb" src={t} alt="" /> : <span className="row-thumb row-thumb--empty" />}
                <span className="row-title">
                  <span className="row-title-text">{title(item, i) || <em>Untitled</em>}</span>
                  {b && <span className="row-badge">{b}</span>}
                </span>
                <span className="row-chevron" aria-hidden="true">
                  {isOpen ? "–" : "+"}
                </span>
              </button>
              <div className="row-order">
                <button type="button" className="btn btn-icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  ▲
                </button>
                <button
                  type="button"
                  className="btn btn-icon"
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1}
                  aria-label="Move down"
                >
                  ▼
                </button>
              </div>
            </div>
            {isOpen && (
              <div className="row-body">
                {render(item, (next) => onChange(items.map((x, k) => (k === i ? next : x))), i)}
                <div className="row-footer">
                  {confirming === i ? (
                    <>
                      <span className="row-confirm">Delete this {noun}?</span>
                      <button type="button" className="btn btn-danger" onClick={() => remove(i)}>
                        Yes, delete
                      </button>
                      <button type="button" className="btn btn-quiet" onClick={() => setConfirming(null)}>
                        Keep it
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-quiet btn-delete" onClick={() => setConfirming(i)}>
                      Delete {noun}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button type="button" className="btn btn-add" onClick={add}>
        + {addLabel}
      </button>
    </div>
  );
}

/** Convenience for lists of plain strings (headline lines, bio paragraphs). */
export function StringList({
  items,
  onChange,
  label,
  addLabel,
  noun,
  multiline,
  max,
  onOpen,
}: {
  items: string[];
  onChange: (v: string[]) => void;
  label: string;
  addLabel: string;
  noun: string;
  multiline?: boolean;
  max?: number;
  onOpen?: (i: number) => void;
}) {
  return (
    <ListEditor
      items={items}
      onChange={onChange}
      title={(s) => s.slice(0, 80)}
      render={(s, update) => <TextInput label={label} value={s} onChange={update} multiline={multiline} max={max} />}
      create={() => ""}
      addLabel={addLabel}
      noun={noun}
      onOpen={onOpen}
    />
  );
}
