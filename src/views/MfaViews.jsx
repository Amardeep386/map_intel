// Multi-factor sign-in (P5 · M7): the second sign-in step (a code from the authenticator app, or a
// recovery code), set-up during sign-in when an account requires it, and the Security dialog for
// the signed-in user (turn on / off, new recovery codes).
import React, { useEffect, useState } from "react";
import { Copy, KeyRound, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { api } from "../api/client.js";
import { Field, inputCls, Modal, Note, PrimaryButton, SecondaryButton } from "../ui.jsx";
import { attempt } from "../workspace.js";

const codeCls = `${inputCls} font-mono tracking-[0.3em] text-center text-base h-11`;

/** The QR code and the key to type in, for an authenticator app. */
function ScanStep({ setup }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[176px_1fr] gap-4 items-start">
      <img alt="QR code for your authenticator app" className="w-44 h-44 rounded-lg border border-brand-beige bg-white p-2"
        src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} />
      <div className="text-[13px] space-y-2">
        <p>1. Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…) and scan the code.</p>
        <p className="text-brand-taupe">Can't scan? Add an account by hand with this key:</p>
        <div className="font-mono text-xs break-all bg-surface-2 border border-brand-beige rounded-md px-2 py-1.5">{setup.secret.match(/.{1,4}/g).join(" ")}</div>
        <p>2. Type the six-digit code the app shows.</p>
      </div>
    </div>
  );
}

/** Recovery codes, shown once. */
export function RecoveryCodes({ codes, onDone, doneLabel = "I have saved them" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(codes.join("\n")); setCopied(true); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="space-y-3">
      <Note tone="text-amber-900 bg-amber-50 border-amber-200">
        Save these recovery codes somewhere safe (a password manager). Each one signs you in once if you lose your phone. They are shown only now.
      </Note>
      <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-surface-2 border border-brand-beige rounded-lg p-3">
        {codes.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="flex justify-between">
        <SecondaryButton onClick={copy}><Copy className="w-4 h-4" /> {copied ? "Copied" : "Copy"}</SecondaryButton>
        <PrimaryButton onClick={onDone}>{doneLabel}</PrimaryButton>
      </div>
    </div>
  );
}

/** The second sign-in step, on the sign-in page. step = { mfa: "code" | "setup", challenge, user }. */
export function MfaSignInScreen({ step, onSignedIn, onCancel, showToast }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);

  useEffect(() => {
    if (step.mfa !== "setup") return;
    attempt(showToast, async () => setSetup(await api.mfaSetup(step.challenge)));
  }, [step, showToast]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (step.mfa === "code") {
        const r = await api.mfaVerify(step.challenge, code.trim());
        if (r.usedRecoveryCode) showToast("Signed in with a recovery code. It cannot be used again: make new ones under Security.", "info", 8000);
        await onSignedIn();
      } else {
        const r = await api.mfaSetupConfirm(step.challenge, code.trim());
        setCodes(r.recoveryCodes);
      }
    } catch (err) {
      showToast(err.message || "That code is not right.", "info");
      if (err.status === 401 && /expired|sign in again/.test(err.message || "")) onCancel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-ivory font-sans text-brand-charcoal px-6 py-12" style={{ "--color-brand-copper": "#AB5C36", "--accent-coral": "#AB5C36" }}>
      <div className="w-full max-w-[520px] bg-brand-white border border-brand-beige rounded-2xl p-8 shadow-[var(--shadow-3)]">
        <div className="flex items-center gap-3 mb-6">
          <span className="w-10 h-10 rounded-xl bg-brand-ivory border border-brand-beige inline-flex items-center justify-center"><ShieldCheck className="w-5 h-5 text-brand-copper" /></span>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-brand-taupe">Multi-factor sign-in</div>
            <div className="text-sm font-medium">{step.user?.email}</div>
          </div>
        </div>
        {codes ? (
          <>
            <h2 className="text-xl font-semibold tracking-tight mb-3">Multi-factor sign-in is on</h2>
            <RecoveryCodes codes={codes} onDone={() => onSignedIn()} doneLabel="Saved: continue" />
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {step.mfa === "code" ? (
              <>
                <h2 className="text-xl font-semibold tracking-tight">Enter your code</h2>
                <p className="text-sm text-brand-taupe flex items-center gap-2"><Smartphone className="w-4 h-4" /> The six-digit code from your authenticator app, or one of your recovery codes.</p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-semibold tracking-tight">Set up multi-factor sign-in</h2>
                <p className="text-sm text-brand-taupe">An account you work in requires a code from an authenticator app at every sign-in. It takes a minute.</p>
                {setup ? <ScanStep setup={setup} /> : <p className="text-sm text-brand-taupe flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Preparing…</p>}
              </>
            )}
            <input autoFocus autoComplete="one-time-code" inputMode={step.mfa === "code" ? "text" : "numeric"} maxLength={12} value={code} onChange={(e) => setCode(e.target.value)}
              placeholder={step.mfa === "code" ? "123456" : "6-digit code"} className={codeCls} />
            <div className="flex justify-between gap-2">
              <SecondaryButton onClick={onCancel}>Back to sign in</SecondaryButton>
              <PrimaryButton type="submit" disabled={busy || code.trim().length < 6 || (step.mfa === "setup" && !setup)}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} {step.mfa === "code" ? "Verify" : "Turn on"}
              </PrimaryButton>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** The signed-in user's own MFA. onChanged: reload the user (the session may have changed). */
export function SecurityModal({ onClose, onChanged, showToast }) {
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [code, setCode] = useState("");
  const [mode, setMode] = useState(null); // null | "disable" | "codes"
  const [busy, setBusy] = useState(false);

  // Mounted when opened (App.jsx), so every opening starts clean.
  useEffect(() => { attempt(showToast, async () => setStatus(await api.mfaStatus())); }, [showToast]);

  const run = async (fn) => {
    setBusy(true);
    const r = await attempt(showToast, fn);
    setBusy(false);
    return r;
  };
  const start = () => run(async () => setSetup(await api.mfaEnrol()));
  const confirm = () => run(async () => {
    const r = await api.mfaEnrolConfirm(code.trim());
    setCodes(r.recoveryCodes); setSetup(null); setCode("");
    await onChanged();
  });
  const disable = () => run(async () => {
    await api.mfaDisable(code.trim());
    showToast("Multi-factor sign-in is off.", "success");
    setCode(""); setMode(null);
    setStatus(await api.mfaStatus());
    await onChanged();
  });
  const newCodes = () => run(async () => {
    const r = await api.mfaRecoveryCodes(code.trim());
    setCodes(r.recoveryCodes); setCode(""); setMode(null);
  });

  return (
    <Modal open onClose={onClose} title="Security" width="w-[36rem]">
      {!status ? <Loader2 className="w-4 h-4 animate-spin text-brand-taupe" /> : codes ? (
        <RecoveryCodes codes={codes} onDone={async () => { setCodes(null); setStatus(await api.mfaStatus()); }} />
      ) : setup ? (
        <div className="space-y-4">
          <ScanStep setup={setup} />
          <Field label="Code from the app"><input autoFocus inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} className={codeCls} placeholder="123456" /></Field>
          <div className="flex justify-end gap-2">
            <SecondaryButton onClick={() => setSetup(null)}>Cancel</SecondaryButton>
            <PrimaryButton onClick={confirm} disabled={busy || code.trim().length !== 6}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Turn on</PrimaryButton>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-[13px]">
          <div className="flex items-start gap-3">
            <ShieldCheck className={`w-5 h-5 mt-0.5 ${status.enabled ? "text-emerald-600" : "text-brand-taupe"}`} />
            <div>
              <div className="font-semibold">Multi-factor sign-in is {status.enabled ? "on" : "off"}</div>
              <div className="text-brand-taupe">
                {status.enabled
                  ? `Every sign-in asks for a code from your authenticator app. ${status.recoveryCodesLeft} recovery code${status.recoveryCodesLeft === 1 ? "" : "s"} left.`
                  : "Turn it on so a stolen password is not enough to get in."}
                {status.required && ` Required by ${status.requiredBy.join(", ")}.`}
              </div>
            </div>
          </div>
          {status.enabled && status.recoveryCodesLeft <= 3 && <Note tone="text-amber-900 bg-amber-50 border-amber-200">Few recovery codes left: make new ones.</Note>}
          {mode ? (
            <div className="space-y-3">
              <Field label="Code from your app"><input autoFocus inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} className={codeCls} placeholder="123456" /></Field>
              <div className="flex justify-end gap-2">
                <SecondaryButton onClick={() => { setMode(null); setCode(""); }}>Cancel</SecondaryButton>
                <PrimaryButton onClick={mode === "disable" ? disable : newCodes} disabled={busy || code.trim().length !== 6}>
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} {mode === "disable" ? "Turn off" : "Make new codes"}
                </PrimaryButton>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              {status.enabled ? (
                <>
                  <SecondaryButton onClick={() => setMode("codes")}><KeyRound className="w-4 h-4" /> New recovery codes</SecondaryButton>
                  {!status.required && <SecondaryButton onClick={() => setMode("disable")}>Turn off</SecondaryButton>}
                </>
              ) : (
                <PrimaryButton onClick={start} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Turn on</PrimaryButton>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
