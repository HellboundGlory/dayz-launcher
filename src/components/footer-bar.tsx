interface FooterBarProps {
  servers: number;
  populated: number;
  refreshedAt: string | null;
  steamConnected: boolean;
}

export function FooterBar({ servers, populated, refreshedAt, steamConnected }: FooterBarProps) {
  return (
    <div className="flex items-center justify-between border-t border-[#1e293b] bg-[#0b0f17] px-3 py-1">
      {/* Left: Stats */}
      <div className="flex items-center gap-2 text-[10px] text-[#64748b]">
        {steamConnected ? (
          <>
            <span className="font-mono-data">{servers.toLocaleString()} servers</span>
            <span className="text-[#1e293b]">·</span>
            <span className="font-mono-data">{populated.toLocaleString()} populated</span>
          </>
        ) : (
          <span>Steam not connected — server discovery unavailable</span>
        )}
        {refreshedAt && (
          <>
            <span className="text-[#1e293b]">·</span>
            <span>refreshed {refreshedAt}</span>
          </>
        )}
      </div>

      {/* Right: Disclaimer */}
      <div className="text-[10px] text-[#475569]">
        Verify = Steam reports installed & current — not a checksum
      </div>
    </div>
  );
}