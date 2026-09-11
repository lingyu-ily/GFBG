import { useEffect, useState } from "react";

export function PlayerAvatar({
  name,
  src,
  className = "",
  title,
}: {
  name: string;
  src?: string | null;
  className?: string;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={`player-avatar ${className}`.trim()} title={title}>
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        name.trim().slice(0, 1) || "?"
      )}
    </span>
  );
}
