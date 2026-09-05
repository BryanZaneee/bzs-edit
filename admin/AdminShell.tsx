import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, hasToken, login, verify } from "./api";
import { scrollPreview } from "./preview";
import type { Screen } from "./types";

/**
 * The part of every site editor that is the same: sign-in, the home screen of
 * section cards, the section screen with a back button, the Undo all / Publish
 * bar, the mobile Edit|Preview toggle, toasts, the unsaved-changes guard, and
 * the live preview — a same-origin iframe of the real site at `?preview=1`
 * that receives the whole in-memory draft (debounced) on every edit.
 *
 * A site supplies its draft type `D`, how to load and save it, its screens, and
 * how to render one screen's editor.
 */
export type AdminShellProps<D, K extends string> = {
  brand: string;
  screens: Screen<K>[];
  load: () => Promise<D>;
  save: (draft: D) => Promise<void>;
  /** Editor for one screen. `set` replaces the whole draft. */
  render: (draft: D, key: K, set: (next: D) => void) => ReactNode;
  /** Thumbnail for a home card, if the section has one. */
  thumbFor?: (draft: D, key: K) => string | undefined;
  /** Glyph shown on a home card that has no thumbnail. */
  placeholder?: (key: K) => string;
};

export function AdminShell<D, K extends string>(props: AdminShellProps<D, K>) {
  const [signedIn, setSignedIn] = useState<boolean | null>(hasToken() ? null : false);

  useEffect(() => {
    if (signedIn === null) verify().then(() => setSignedIn(true)).catch(() => setSignedIn(false));
    const out = () => setSignedIn(false);
    window.addEventListener("admin:signed-out", out);
    return () => window.removeEventListener("admin:signed-out", out);
  }, [signedIn]);

  if (signedIn === null) return <div className="center muted">Loading…</div>;
  if (!signedIn) return <SignIn brand={props.brand} onDone={() => setSignedIn(true)} />;
  return <Editor {...props} />;
}

function SignIn({ brand, onDone }: { brand: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(password);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "That password isn't right." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="signin" onSubmit={submit}>
        <div className="brand">{brand}</div>
        <h1>Site editor</h1>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        {error && <p className="field-hint is-error">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="hint">You'll stay signed in on this device for 30 days.</p>
      </form>
    </div>
  );
}

function Editor<D, K extends string>({ brand, screens, load, save, render, thumbFor, placeholder }: AdminShellProps<D, K>) {
  const [draft, setDraft] = useState<D | null>(null);
  const [original, setOriginal] = useState("");
  const [screen, setScreen] = useState<K | "home">("home");
  const [page, setPage] = useState(screens[0]?.page ?? "/");
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [loadError, setLoadError] = useState("");
  const iframe = useRef<HTMLIFrameElement>(null);
  const current = screens.find((s) => s.key === screen);

  useEffect(() => {
    load()
      .then((d) => {
        setDraft(d);
        setOriginal(JSON.stringify(d));
      })
      .catch((err) => setLoadError((err as Error).message));
  }, []);

  // Live preview: push the draft into the iframe (debounced) on every change.
  const post = (msg: unknown) => iframe.current?.contentWindow?.postMessage(msg, location.origin);
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => post({ type: "content", content: draft }), 150);
    return () => clearTimeout(t);
  }, [draft]);
  // Picking a section frames its page (a changed src reloads the iframe; onLoad
  // re-sends the draft and the anchor) and scrolls to its anchor.
  useEffect(() => {
    if (!current) return;
    if (current.page && current.page !== page) setPage(current.page);
    else scrollPreview(current.anchor);
  }, [screen]);
  const onFrameLoad = () => {
    post({ type: "content", content: draft });
    if (current) scrollPreview(current.anchor);
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Warn before closing the tab with unsaved changes.
  const dirty = draft !== null && JSON.stringify(draft) !== original;
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  if (loadError) return <div className="center muted">Couldn't load the site content: {loadError}</div>;
  if (!draft) return <div className="center muted">Loading…</div>;

  const publish = async () => {
    setPublishing(true);
    try {
      await save(draft);
      setOriginal(JSON.stringify(draft));
      setToast({ text: "Published — it's live on the site ✓" });
    } catch (err) {
      setToast({ text: (err as Error).message, error: true });
    } finally {
      setPublishing(false);
    }
  };
  const discard = () => {
    setDraft(JSON.parse(original));
    setToast({ text: "Changes undone" });
  };

  return (
    <div className={`admin admin--${mobileView}`}>
      <div className="editor">
        <header className="topbar">
          {screen === "home" ? (
            <span className="brand">{brand}</span>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => setScreen("home")}>
              ‹ All sections
            </button>
          )}
          <button type="button" className="btn btn-quiet only-mobile" onClick={() => setMobileView("preview")}>
            Preview
          </button>
        </header>

        <main className="screen">
          {screen === "home" || !current ? (
            <>
              <h1>What do you want to change?</h1>
              <p className="hint">Pick a part of the site. Your changes show up in the preview right away and go live when you tap Publish.</p>
              <div className="cards">
                {screens.map((s) => {
                  const t = thumbFor?.(draft, s.key);
                  return (
                    <button key={s.key} type="button" className="card" onClick={() => setScreen(s.key)}>
                      {t ? <img className="card-thumb" src={t} alt="" /> : <span className="card-thumb card-thumb--empty">{placeholder?.(s.key) ?? "@"}</span>}
                      <span className="card-text">
                        <strong>{s.title}</strong>
                        <small>{s.blurb}</small>
                      </span>
                      <span className="row-chevron" aria-hidden="true">›</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <h1>{current.title}</h1>
              {render(draft, current.key, setDraft)}
            </>
          )}
        </main>

        {dirty && (
          <footer className="publish-bar">
            <span>You have unsaved changes</span>
            <div className="publish-actions">
              <button type="button" className="btn btn-quiet" onClick={discard} disabled={publishing}>
                Undo all
              </button>
              <button type="button" className="btn btn-primary" onClick={publish} disabled={publishing}>
                {publishing ? "Publishing…" : "Publish to site"}
              </button>
            </div>
          </footer>
        )}
      </div>

      <div className="preview">
        <div className="preview-bar only-mobile">
          <span className="muted">Preview{dirty ? " — unpublished changes" : ""}</span>
          <button type="button" className="btn btn-primary" onClick={() => setMobileView("edit")}>
            ‹ Back to editing
          </button>
        </div>
        <iframe ref={iframe} className="preview-frame" title="Live preview of the site" src={`${page}${page.includes("?") ? "&" : "?"}preview=1`} onLoad={onFrameLoad} />
      </div>

      {toast && <div className={`toast${toast.error ? " is-error" : ""}`}>{toast.text}</div>}
    </div>
  );
}
