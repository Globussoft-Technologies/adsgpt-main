import { LifestyleShell } from '../LifestyleShell';

export function LifestyleResultsStep({ title, images, taskId, aspectRatio, onBack, onClose }) {
  return (
    <LifestyleShell title={title} onClose={onClose}>
      <div className="w-full max-w-[988px]">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-[18px] font-semibold text-white">
              Generated {images.length} image{images.length === 1 ? '' : 's'}
            </h3>
            {taskId && <p className="text-[11px] text-white/40">task {taskId.slice(0, 12)}…</p>}
          </div>
          <button
            type="button"
            onClick={onBack}
            className="h-[42px] rounded-full bg-white px-7 text-[14px] font-medium text-black hover:opacity-90"
          >
            Generate again
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img, i) => (
            <figure
              key={i}
              className="overflow-hidden rounded-[20px] bg-[#202121] ring-1 ring-white/5"
            >
              <img
                src={img.url}
                alt={`Generated ${aspectRatio}`}
                className="block h-auto w-full"
              />
              <figcaption className="flex items-center justify-between px-4 py-3 text-[11px]">
                <span className="text-white/70">{aspectRatio}</span>
                <a
                  href={img.url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="text-white/60 hover:text-white"
                >
                  Open
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </LifestyleShell>
  );
}
