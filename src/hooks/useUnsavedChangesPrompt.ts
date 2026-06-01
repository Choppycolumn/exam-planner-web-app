import { useEffect } from 'react';

export function useUnsavedChangesPrompt(enabled: boolean, message = '当前页面有未保存的编辑内容，确认离开吗？') {
  useEffect(() => {
    if (!enabled) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [enabled, message]);
}
