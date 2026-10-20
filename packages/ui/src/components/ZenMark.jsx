export default function ZenMark({ variant = "tracking", size = 40 }) {
  return (
    <img
      className="zen-mark"
      src={`/brand/zen-${variant}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}
