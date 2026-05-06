import { AnimatePresence, motion } from 'framer-motion';

export function Toast({ message }: { message: string }) {
  return (
    <AnimatePresence>
      {message ? (
        <motion.div
          className="fixed bottom-6 right-6 z-50 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 shadow-lg"
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
        >
          {message}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
