export function Toast({ message }: { message: string }) {
  return message ? <div className="toast-enter fixed bottom-6 right-6 z-50 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 shadow-lg">{message}</div> : null;
}
