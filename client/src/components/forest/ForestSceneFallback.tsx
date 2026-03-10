export function ForestSceneFallback() {
  return (
    <div
      data-testid="forest-shell-fallback"
      className="absolute inset-0 overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at top, rgba(246,241,206,0.9), rgba(206,231,212,0.96) 42%, rgba(129,175,126,0.98))",
      }}
    >
      <div className="forest-cloud forest-cloud-one" />
      <div className="forest-cloud forest-cloud-two" />

      <div className="absolute inset-0 grid place-items-center">
        <div className="pixel-panel pixel-panel-strong w-[min(420px,calc(100vw-48px))] p-6">
          <div className="pixel-kicker">Loading grove</div>
          <h2 className="pixel-title mt-2 text-[24px]">Preparing the isometric forest</h2>
          <p className="mt-3 text-sm leading-6 text-[#405538]">
            Streaming the first chunk, sketching the tile map, and arranging the developer trees.
          </p>
          <div className="pixel-loader mt-5">
            <div className="pixel-loader-bar" />
          </div>
        </div>
      </div>
    </div>
  );
}
