export function Toast({ message }: { message: string }) {
  return message ? <div className="app-toast toast-enter" role="status" aria-live="polite">{message}</div> : null;
}
