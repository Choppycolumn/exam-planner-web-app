export function Toast({ message }: { message: string }) {
  return message ? <div className="app-toast toast-enter fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm font-medium">{message}</div> : null;
}
