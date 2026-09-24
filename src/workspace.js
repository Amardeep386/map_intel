// What every workspace screen needs to know: the open account, the signed-in user's permissions
// there, and the toast function. Provided by App.jsx.
import React from "react";

export const WorkspaceContext = React.createContext({
  client: null,
  actions: [],
  showToast: () => {},
});

export function useWorkspace() {
  const ctx = React.useContext(WorkspaceContext);
  return { ...ctx, can: (action) => ctx.actions.includes(action) };
}

/** Run an async action and show its error as a toast; returns the result or undefined. */
export async function attempt(showToast, fn) {
  try {
    return await fn();
  } catch (err) {
    showToast(err.message || "Something went wrong.", "info");
    return undefined;
  }
}

/** "Sep 24, 10:15" in the viewer's timezone. */
export const formatWhen = (iso) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
