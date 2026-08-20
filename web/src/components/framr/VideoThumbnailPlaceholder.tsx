export function VideoThumbnailPlaceholder({ scanning = false }: { scanning?: boolean }) {
  return <div aria-hidden="true" className="framr-video-placeholder absolute inset-0">
    {scanning ? <div className="scanline" /> : null}
  </div>;
}
