export function Hero({
  userName = 'User',
  subtitle = 'Create scroll-stopping Image ads with AI that understands your business.',
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="bg-[linear-gradient(331.85deg,#15dcff_-4.85%,#5e66f5_83.82%)] bg-clip-text font-sans text-[clamp(28px,3.2vw,38px)] font-medium leading-[1.15] text-transparent">
        Hello, {userName}
      </h1>
      <p className="mt-1 max-w-[min(90vw,303px)] font-sans text-[clamp(13px,1.2vw,16px)] font-normal leading-[1.3] text-[#bebebe]">
        {subtitle}
      </p>
    </div>
  );
}
