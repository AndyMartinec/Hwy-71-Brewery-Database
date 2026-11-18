/**
 * Real fermenter photo (public/tanks/fermenter.jpg) with a tank-number badge.
 * Empty tanks render desaturated.
 */
export default function TankPhoto({
  number,
  filled,
  size = "md",
}: {
  number: number;
  filled: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const dims =
    size === "sm"
      ? "aspect-[3/4]"
      : size === "lg"
        ? "aspect-[3/4] w-52 shrink-0"
        : "aspect-[3/4]";
  return (
    <div className={`relative overflow-hidden rounded-xl bg-stone-200 ${dims}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/tanks/fermenter.jpg"
        alt={`Fermenter ${number}`}
        className={`h-full w-full object-cover ${
          filled ? "" : "opacity-60 grayscale"
        }`}
      />
      <span className="absolute left-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-ink-900/85 text-lg font-extrabold text-white">
        {number}
      </span>
    </div>
  );
}
