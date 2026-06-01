export interface ConfirmActionOptions {
  title?: string;
  message: string;
  danger?: boolean;
}

export function confirmAction(options: ConfirmActionOptions | string) {
  const message = typeof options === 'string'
    ? options
    : `${options.title ? `${options.title}\n\n` : ''}${options.message}`;
  return window.confirm(message);
}
