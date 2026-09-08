export function SeatAssistantPage() {
  return (
    <div
      className="overflow-hidden rounded-2xl bg-surface shadow-sm"
      style={{ height: 'calc(100dvh - 88px)', minHeight: 560 }}
    >
      <iframe
        title="座位预约"
        src="/seat/?embed=1"
        className="block h-full w-full border-0"
        loading="eager"
      />
    </div>
  );
}
