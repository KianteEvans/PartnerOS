/**
 * Tiny event-bus toast API. Server actions run inside the MutationForm client
 * island, which calls `emitToast` on success/failure; a single <Toaster/>
 * mounted in the root layout listens and renders. Using a window CustomEvent
 * (instead of React context) keeps any client component able to fire a toast
 * without prop-drilling a provider through the server layout.
 */
export type ToastTone = "ok" | "danger" | "info";

export const TOAST_EVENT = "partneros:toast";

export interface ToastPayload {
  readonly message: string;
  readonly tone: ToastTone;
}

export function emitToast(message: string, tone: ToastTone = "ok"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: { message, tone } }),
  );
}
